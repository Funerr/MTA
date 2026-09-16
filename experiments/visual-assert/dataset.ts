import * as fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { boundingBoxSchema } from '../../src/experience/schema/action';
import { environmentSchema } from '../../src/experience/schema/environment';
import { DATA_VERSION, PNG_MAGIC } from './constants';
import { VisualAssertDataError } from './errors';
import type { LoadedEvidence, LoadedSample, SampleRecord, SplitGroup } from './types';

const evidencePathsSchema = z.strictObject({
  screenshot: z.string().min(1),
  target: z.string().min(1),
  context: z.string().min(1),
  state: z.string().min(1).optional(),
  bbox: boundingBoxSchema,
  stateBox: boundingBoxSchema.optional(),
});

const sampleRecordSchema = z.strictObject({
  id: z.string().min(1),
  captureId: z.string().min(1),
  sourceImageId: z.string().min(1),
  group: z.enum(['calibration', 'validation']),
  semanticType: z.enum(['binary-control', 'explicit-text', 'open-semantic']),
  assertion: z.string().min(1),
  claimedState: z.literal('positive'),
  humanLabel: z.union([z.literal(true), z.literal(false), z.literal('unknown')]),
  expectedDecision: z.enum(['supported', 'contradicted', 'unknown']),
  environment: environmentSchema,
  currentImage: z.string().min(1),
  variant: z.string().min(1),
  shift: z.strictObject({ x: z.number().int(), y: z.number().int() }),
  annotation: z.strictObject({
    annotator: z.string().min(1),
    basis: z.string().min(1),
    modelJudgement: z.null(),
    source: z.string().min(1),
  }),
  evidence: z
    .strictObject({
      positive: evidencePathsSchema,
      negative: evidencePathsSchema,
    })
    .optional(),
});

export const datasetFileSchema = z.object({
  dataVersion: z.literal(DATA_VERSION),
  captures: z.array(
    z.strictObject({
      id: z.string().min(1),
      sourceImageId: z.string().min(1),
      group: z.enum(['calibration', 'validation']),
      semanticType: z.enum(['binary-control', 'explicit-text']),
    }),
  ),
  samples: z.array(sampleRecordSchema).min(1),
});

export type DatasetFile = z.infer<typeof datasetFileSchema>;

function hasPngMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= PNG_MAGIC.length &&
    PNG_MAGIC.every((value, index) => bytes[index] === value)
  );
}

async function readPng(root: string, relative: string, sampleId: string): Promise<Uint8Array> {
  const absolute = path.join(root, relative);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await fs.readFile(absolute));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new VisualAssertDataError(
      'missing-image',
      `样本 ${sampleId} 缺少图片 ${relative}：${detail}`,
      sampleId,
    );
  }
  if (!hasPngMagic(bytes)) {
    throw new VisualAssertDataError(
      'invalid-image',
      `样本 ${sampleId} 的图片 ${relative} 不是合法 PNG`,
      sampleId,
    );
  }
  return bytes;
}

async function loadEvidence(
  root: string,
  record: SampleRecord,
  side: 'positive' | 'negative',
): Promise<LoadedEvidence> {
  const paths = record.evidence?.[side];
  if (!paths) {
    throw new VisualAssertDataError(
      'invalid-dataset',
      `支持类型样本 ${record.id} 缺少 ${side} 参考`,
      record.id,
    );
  }
  return {
    screenshot: await readPng(root, paths.screenshot, record.id),
    targetImage: await readPng(root, paths.target, record.id),
    contextImage: await readPng(root, paths.context, record.id),
    stateImage: paths.state ? await readPng(root, paths.state, record.id) : undefined,
    bbox: paths.bbox,
    stateBox: paths.stateBox,
    environment: record.environment,
    textHint: record.semanticType === 'explicit-text' ? extractTextHint(record.assertion) : undefined,
  };
}

function extractTextHint(assertion: string): string | undefined {
  const matched = assertion.match(/「([^」]+)」/);
  return matched?.[1];
}

export function assertNoCrossGroupVariants(samples: readonly SampleRecord[]): void {
  const groupBySource = new Map<string, SplitGroup>();
  for (const sample of samples) {
    const existing = groupBySource.get(sample.sourceImageId);
    if (existing && existing !== sample.group) {
      throw new VisualAssertDataError(
        'invalid-dataset',
        `原图 ${sample.sourceImageId} 的变体同时出现在 ${existing} 与 ${sample.group}`,
        sample.id,
      );
    }
    groupBySource.set(sample.sourceImageId, sample.group);
    if (sample.captureId !== sample.sourceImageId) {
      throw new VisualAssertDataError(
        'invalid-dataset',
        `样本 ${sample.id} 的 captureId 与 sourceImageId 不一致`,
        sample.id,
      );
    }
  }
}

export function parseDatasetFile(raw: unknown): DatasetFile {
  const parsed = datasetFileSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const pathText = issue.path.map(String).join('.');
        return pathText ? `${pathText}: ${issue.message}` : issue.message;
      })
      .join('；');
    throw new VisualAssertDataError('invalid-dataset', `数据集非法：${detail}`);
  }
  for (const sample of parsed.data.samples) {
    if (sample.annotation.modelJudgement !== null) {
      throw new VisualAssertDataError(
        'invalid-label',
        `样本 ${sample.id} 不得以模型判断作为真值`,
        sample.id,
      );
    }
    if (
      sample.semanticType !== 'open-semantic' &&
      sample.humanLabel !== 'unknown' &&
      !sample.evidence
    ) {
      throw new VisualAssertDataError(
        'invalid-dataset',
        `样本 ${sample.id} 缺少正反参考证据`,
        sample.id,
      );
    }
  }
  assertNoCrossGroupVariants(parsed.data.samples);
  return parsed.data;
}

export async function loadDataset(
  root: string,
  split?: SplitGroup,
): Promise<{ file: DatasetFile; samples: LoadedSample[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path.join(root, 'dataset.json'), 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new VisualAssertDataError('invalid-dataset', `无法读取 dataset.json：${detail}`);
  }
  const file = parseDatasetFile(raw);
  const records = split ? file.samples.filter((sample) => sample.group === split) : file.samples;
  const samples: LoadedSample[] = [];
  for (const record of records) {
    const currentPng = await readPng(root, record.currentImage, record.id);
    if (record.semanticType === 'open-semantic') {
      samples.push({ record, currentPng });
      continue;
    }
    samples.push({
      record,
      currentPng,
      positiveEvidence: await loadEvidence(root, record, 'positive'),
      negativeEvidence: await loadEvidence(root, record, 'negative'),
    });
  }
  return { file, samples };
}

export function countDataset(samples: readonly SampleRecord[]): {
  readonly total: number;
  readonly byGroup: Record<SplitGroup, number>;
  readonly byType: Record<string, { true: number; false: number; unknown: number }>;
} {
  const byGroup = { calibration: 0, validation: 0 };
  const byType: Record<string, { true: number; false: number; unknown: number }> = {};
  for (const sample of samples) {
    byGroup[sample.group] += 1;
    const bucket = byType[sample.semanticType] ?? { true: 0, false: 0, unknown: 0 };
    if (sample.humanLabel === true) bucket.true += 1;
    else if (sample.humanLabel === false) bucket.false += 1;
    else bucket.unknown += 1;
    byType[sample.semanticType] = bucket;
  }
  return { total: samples.length, byGroup, byType };
}
