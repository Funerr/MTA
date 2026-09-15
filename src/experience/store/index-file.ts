import { z } from 'zod/v4';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  experienceSchema,
  EXPERIENCE_SCHEMA_VERSION,
  describeZodIssues,
  validateExperienceAsset,
} from '../schema/experience';
import { ISO_DATETIME_PATTERN, SHA256_HEX_PATTERN } from '../schema/patterns';
import { storeError, storeValue, type StoreOutcome } from './errors';

export const INDEX_FILENAME = 'index.json';
export const ASSETS_DIRNAME = 'assets';
export const INDEX_FORMAT = 'mta-experience-index';

/** 已处理的运行事件记录（eventId → 记录）；保证重复事件幂等。 */
export const STORE_EVENT_KINDS = [
  'publish',
  'replay-succeeded',
  'replay-failed',
  'marked-stale',
] as const;
export type StoreEventKind = (typeof STORE_EVENT_KINDS)[number];

const eventRecordSchema = z.strictObject({
  requestKey: z.string().regex(SHA256_HEX_PATTERN),
  variantId: z.string().regex(SHA256_HEX_PATTERN),
  revision: z.number().int().positive(),
  kind: z.enum(STORE_EVENT_KINDS),
  at: z.string().regex(ISO_DATETIME_PATTERN, '时间必须是 ISO 8601 日期时间'),
});
export type StoreEventRecord = z.infer<typeof eventRecordSchema>;

export const storeIndexSchema = z.strictObject({
  format: z.literal(INDEX_FORMAT),
  schemaVersion: z.literal(EXPERIENCE_SCHEMA_VERSION),
  generatedAt: z.string().regex(ISO_DATETIME_PATTERN, '时间必须是 ISO 8601 日期时间'),
  experiences: z.array(experienceSchema),
  events: z.record(z.string().min(1), eventRecordSchema),
});
export type StoreIndex = z.infer<typeof storeIndexSchema>;

export function emptyStoreIndex(): StoreIndex {
  return {
    format: INDEX_FORMAT,
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    experiences: [],
    events: {},
  };
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

export function indexPath(root: string): string {
  return path.join(root, INDEX_FILENAME);
}

/**
 * 读取索引快照：根目录或索引缺失代表空 Store（非错误）；
 * 索引损坏/校验失败 → invalid-asset；版本不识别 → unsupported-version；
 * 其余 I/O 失败 → io-error。
 */
export async function loadStoreIndex(
  root: string,
): Promise<StoreOutcome<StoreIndex>> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath(root), 'utf8');
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return storeValue(emptyStoreIndex());
    return storeError(
      'io-error',
      `读取索引 ${indexPath(root)} 失败`,
      error,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return storeError(
      'invalid-asset',
      `索引 ${INDEX_FILENAME} 不是合法 JSON，Store 不可用（可诊断的损坏结果）`,
      error,
    );
  }

  const header = parsed as { format?: unknown; schemaVersion?: unknown } | null;
  if (header?.format !== INDEX_FORMAT) {
    return storeError(
      'invalid-asset',
      `索引 ${INDEX_FILENAME} 的 format 字段不识别（期望 "${INDEX_FORMAT}"）`,
    );
  }
  if (header?.schemaVersion !== EXPERIENCE_SCHEMA_VERSION) {
    return storeError(
      'unsupported-version',
      `索引 schemaVersion 为 ${String(header?.schemaVersion)}，本实现仅支持 ${EXPERIENCE_SCHEMA_VERSION}；拒绝读取，不做静默迁移`,
    );
  }

  const index = storeIndexSchema.safeParse(parsed);
  if (!index.success) {
    return storeError(
      'invalid-asset',
      `索引 ${INDEX_FILENAME} 结构校验失败：${describeZodIssues(index.error).join('；')}`,
    );
  }

  for (const experience of index.data.experiences) {
    const validation = validateExperienceAsset(experience);
    if (!validation.ok) {
      return storeError(
        'invalid-asset',
        `Experience(${experience.requestKey.slice(0, 12)}…) 校验失败：${validation.reasons.join('；')}`,
      );
    }
  }

  const requestKeys = new Set<string>();
  for (const experience of index.data.experiences) {
    if (requestKeys.has(experience.requestKey)) {
      return storeError(
        'invalid-asset',
        `索引内 requestKey ${experience.requestKey} 重复`,
      );
    }
    requestKeys.add(experience.requestKey);
  }
  return storeValue(index.data);
}

/**
 * 原子索引发布：同目录写临时文件 → fsync → rename 原子替换 → 同步目录。
 * 任一步失败时保留旧索引；未提交的临时文件不算经验（读者只读 index.json）。
 */
export async function writeStoreIndexAtomic(
  root: string,
  index: StoreIndex,
): Promise<void> {
  const assetsDir = path.join(root, ASSETS_DIRNAME);
  await fs.mkdir(assetsDir, { recursive: true });

  const data = `${JSON.stringify(index, null, 2)}\n`;
  const tmpPath = path.join(
    root,
    `${INDEX_FILENAME}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
  );
  try {
    const handle = await fs.open(tmpPath, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, indexPath(root));
    const dirHandle = await fs.open(root, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}
