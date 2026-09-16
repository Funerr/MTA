import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultImagePipeline,
  FROZEN_MATCHER_CONFIG,
  matchTarget,
} from '../../src/experience';
import { frameworkNodes } from '../../src/nodes';
import type { LocalOcrEngine } from '../../src/experience/matcher/types';
import {
  assertNoCrossGroupVariants,
  buildVisualAssertFixtures,
  countDataset,
  DATA_VERSION,
  evaluateAssertion,
  FIXTURE_ROOT,
  loadDataset,
  OUTPUT_ROOT,
  persistFrozenExperiment,
  persistVisualAssertFixtures,
  REPRO_COMMAND,
  runEvaluation,
  stripTiming,
  VISUAL_ASSERT_PROTOCOL,
  computeTypeMetrics,
  decideGoNoGo,
  type LoadedSample,
  type SampleEvaluation,
} from '../../experiments/visual-assert';
import type { BuiltFixture } from '../../experiments/visual-assert/build-fixtures';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadedFrom(built: BuiltFixture, id: string): LoadedSample {
  const record = built.records.find((item) => item.id === id);
  if (!record) throw new Error(`missing ${id}`);
  const currentPng = built.files.get(record.currentImage);
  if (!currentPng) throw new Error(`missing png ${record.currentImage}`);
  if (!record.evidence) return { record, currentPng };
  const side = (key: 'positive' | 'negative') => {
    const paths = record.evidence![key];
    const screenshot = built.files.get(paths.screenshot);
    const targetImage = built.files.get(paths.target);
    const contextImage = built.files.get(paths.context);
    if (!screenshot || !targetImage || !contextImage) {
      throw new Error(`missing evidence for ${id}/${key}`);
    }
    return {
      screenshot,
      targetImage,
      contextImage,
      stateImage: paths.state ? built.files.get(paths.state) : undefined,
      bbox: paths.bbox,
      stateBox: paths.stateBox,
      environment: record.environment,
      textHint: record.assertion.match(/「([^」]+)」/)?.[1],
    };
  };
  return {
    record,
    currentPng,
    positiveEvidence: side('positive'),
    negativeEvidence: side('negative'),
  };
}

const fixturesPromise = buildVisualAssertFixtures();

describe('研究协议与隔离入口（任务 1.1）', () => {
  it('Promotion/Matcher 可复用，实验入口与输出目录独立，且不注册生产断言 Node', async () => {
    expect(FROZEN_MATCHER_CONFIG.version).toBe('visual-matcher@1');
    expect(defaultImagePipeline.version).toBe('png-sharp@1');
    expect(typeof matchTarget).toBe('function');
    await fs.mkdir(OUTPUT_ROOT, { recursive: true });
    const outputStat = await fs.stat(OUTPUT_ROOT);
    expect(outputStat.isDirectory()).toBe(true);
    expect(frameworkNodes.map((node) => node.name)).toEqual([
      'device.prepare',
      'device.recover',
      'experienceAct',
    ]);
    const config = await fs.readFile(path.join(repoRoot, 'midscene.config.ts'), 'utf8');
    expect(config).toContain('aiAssert');
    expect(config).not.toContain('experienceAssert');
    const nodeFiles = await fs.readdir(path.join(repoRoot, 'src/nodes'));
    expect(nodeFiles.some((name) => name.includes('assert'))).toBe(false);
    const evaluatorSource = await fs.readFile(
      path.join(repoRoot, 'experiments/visual-assert/evaluator.ts'),
      'utf8',
    );
    expect(evaluatorSource).not.toMatch(/openExperienceStore|promoteExperience/);
  });
});

describe('标注夹具与分组冻结（任务 1.2）', () => {
  it('两类断言各有 ≥20 正例/反例，含 unknown，且同源变体不跨组', async () => {
    const built = await fixturesPromise;
    const persisted = await persistVisualAssertFixtures(FIXTURE_ROOT, built);
    expect(persisted.pngCount).toBeGreaterThan(0);
    assertNoCrossGroupVariants(built.records);
    const counted = countDataset(built.records);
    expect(counted.byType['binary-control']?.true).toBeGreaterThanOrEqual(20);
    expect(counted.byType['binary-control']?.false).toBeGreaterThanOrEqual(20);
    expect(counted.byType['explicit-text']?.true).toBeGreaterThanOrEqual(20);
    expect(counted.byType['explicit-text']?.false).toBeGreaterThanOrEqual(20);
    expect(
      (counted.byType['binary-control']?.unknown ?? 0) +
        (counted.byType['explicit-text']?.unknown ?? 0) +
        (counted.byType['open-semantic']?.unknown ?? 0),
    ).toBeGreaterThanOrEqual(10);

    const validation = built.records.filter((item) => item.group === 'validation');
    for (const type of ['binary-control', 'explicit-text'] as const) {
      const items = validation.filter((item) => item.semanticType === type);
      expect(items.filter((item) => item.humanLabel === true).length).toBeGreaterThanOrEqual(10);
      expect(items.filter((item) => item.humanLabel === false).length).toBeGreaterThanOrEqual(10);
      expect(items.some((item) => item.humanLabel === 'unknown')).toBe(true);
    }
    expect(validation.some((item) => item.semanticType === 'open-semantic')).toBe(true);
    expect(built.records.every((item) => item.annotation.modelJudgement === null)).toBe(true);

    const summary = await fs.readFile(path.join(FIXTURE_ROOT, 'summary.md'), 'utf8');
    expect(summary).toContain('同一原始捕获的全部变体进入同一组');
    const frozen = JSON.parse(await fs.readFile(path.join(FIXTURE_ROOT, 'dataset.json'), 'utf8')) as {
      dataVersion: string;
      samples: Array<{ id: string; currentImage: string }>;
    };
    expect(frozen.dataVersion).toBe(DATA_VERSION);
    const original = await fs.readFile(path.join(FIXTURE_ROOT, 'png/cal-wifi/on-original.png'));
    expect(original.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});

describe('预设 go/no-go 与指标分母（任务 1.3）', () => {
  it('协议可由结果字段直接判断，且写明分母', async () => {
    await persistVisualAssertFixtures(FIXTURE_ROOT, await fixturesPromise);
    const protocol = JSON.parse(
      await fs.readFile(path.join(FIXTURE_ROOT, 'protocol.json'), 'utf8'),
    ) as typeof VISUAL_ASSERT_PROTOCOL;
    expect(protocol.go.falsePassMax).toBe(0);
    expect(protocol.go.minCoverageBySupportedType).toBe(0.8);
    expect(protocol.go.unsupportedMustBeUnknown).toBe(true);
    expect(protocol.denominators.falsePass).toContain('humanLabel === false');
    expect(protocol.denominators.coverage).toContain('binary-control');
    expect(protocol.openSemanticRule).toContain('unknown');
    expect(protocol.ocr.enabled).toBe(false);
    expect(protocol.nativeBoundary.modifyAiAssert).toBe(false);
  });
});

describe('有限离线评估（任务 2.1–2.3）', () => {
  let built: BuiltFixture;

  beforeAll(async () => {
    built = await fixturesPromise;
    await persistVisualAssertFixtures(FIXTURE_ROOT, built);
  }, 120_000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('二态控件：同状态 supported，相反状态 contradicted，缺失与开放语义 unknown', async () => {
    const on = loadedFrom(built, 'cal-wifi/on-original');
    const supported = await evaluateAssertion({
      sampleId: on.record.id,
      semanticType: on.record.semanticType,
      assertion: on.record.assertion,
      currentScreenshot: on.currentPng,
      currentEnvironment: on.record.environment,
      positiveEvidence: on.positiveEvidence,
      negativeEvidence: on.negativeEvidence,
    });
    expect(supported.decision).toBe('supported');

    const off = loadedFrom(built, 'cal-wifi/off-original');
    const contradicted = await evaluateAssertion({
      sampleId: off.record.id,
      semanticType: off.record.semanticType,
      assertion: off.record.assertion,
      currentScreenshot: off.currentPng,
      currentEnvironment: off.record.environment,
      positiveEvidence: off.positiveEvidence,
      negativeEvidence: off.negativeEvidence,
    });
    expect(contradicted.decision).toBe('contradicted');

    const removed = loadedFrom(built, 'cal-wifi/removed');
    const missing = await evaluateAssertion({
      sampleId: removed.record.id,
      semanticType: removed.record.semanticType,
      assertion: removed.record.assertion,
      currentScreenshot: removed.currentPng,
      currentEnvironment: removed.record.environment,
      positiveEvidence: removed.positiveEvidence,
      negativeEvidence: removed.negativeEvidence,
    });
    expect(missing.decision).toBe('unknown');
    expect(missing.code).toBe('insufficient-evidence');

    const open = await evaluateAssertion({
      sampleId: 'open',
      semanticType: 'open-semantic',
      assertion: '页面正常',
      currentScreenshot: on.currentPng,
      currentEnvironment: on.record.environment,
      positiveEvidence: on.positiveEvidence,
      negativeEvidence: on.negativeEvidence,
    });
    expect(open.decision).toBe('unknown');
    expect(open.code).toBe('unsupported-semantic');
    expect(open.reason).toContain('不使用图像相似度');
  });

  it('缺证据与正反同时命中均 unknown，不得默认 true/false', async () => {
    const on = loadedFrom(built, 'cal-wifi/on-original');
    const noEvidence = await evaluateAssertion({
      sampleId: 'no-evidence',
      semanticType: 'binary-control',
      assertion: on.record.assertion,
      currentScreenshot: on.currentPng,
      currentEnvironment: on.record.environment,
    });
    expect(noEvidence.decision).toBe('unknown');
    expect(noEvidence.code).toBe('insufficient-evidence');

    const ambiguous = await evaluateAssertion({
      sampleId: 'ambiguous',
      semanticType: 'binary-control',
      assertion: on.record.assertion,
      currentScreenshot: on.currentPng,
      currentEnvironment: on.record.environment,
      positiveEvidence: on.positiveEvidence,
      negativeEvidence: on.positiveEvidence,
    });
    expect(ambiguous.decision).toBe('unknown');
    expect(ambiguous.code).toBe('ambiguous-evidence');

    const env = await evaluateAssertion({
      sampleId: 'env',
      semanticType: 'binary-control',
      assertion: on.record.assertion,
      currentScreenshot: on.currentPng,
      currentEnvironment: { ...on.record.environment, theme: 'dark' },
      positiveEvidence: on.positiveEvidence,
      negativeEvidence: on.negativeEvidence,
    });
    expect(env.decision).toBe('unknown');
    expect(env.code).toBe('environment-incompatible');
  });

  it('明确文本正反例可判，OCR 不可用时 unknown 且不走网络 VLM（任务 2.2）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const present = loadedFrom(built, 'cal-settings-title/on-original');
    const absent = loadedFrom(built, 'cal-settings-title/off-original');

    const ok = await evaluateAssertion({
      sampleId: present.record.id,
      semanticType: present.record.semanticType,
      assertion: present.record.assertion,
      currentScreenshot: present.currentPng,
      currentEnvironment: present.record.environment,
      positiveEvidence: present.positiveEvidence,
      negativeEvidence: present.negativeEvidence,
      expectedText: '设置',
    });
    expect(ok.decision).toBe('supported');

    const no = await evaluateAssertion({
      sampleId: absent.record.id,
      semanticType: absent.record.semanticType,
      assertion: absent.record.assertion,
      currentScreenshot: absent.currentPng,
      currentEnvironment: absent.record.environment,
      positiveEvidence: absent.positiveEvidence,
      negativeEvidence: absent.negativeEvidence,
      expectedText: '设置',
    });
    expect(no.decision).toBe('contradicted');

    const missingEngine = await evaluateAssertion({
      sampleId: present.record.id,
      semanticType: 'explicit-text',
      assertion: present.record.assertion,
      currentScreenshot: present.currentPng,
      currentEnvironment: present.record.environment,
      positiveEvidence: present.positiveEvidence,
      negativeEvidence: present.negativeEvidence,
      expectedText: '设置',
      ocrMode: 'required',
    });
    expect(missingEngine.decision).toBe('unknown');
    expect(missingEngine.code).toBe('ocr-unavailable');

    const engine: LocalOcrEngine = {
      modelVersion: 'fixture-glyph-ocr@1',
      languagePackVersion: 'zh-synthetic@1',
      async recognize() {
        return { text: '设置' };
      },
    };
    const withEngine = await evaluateAssertion({
      sampleId: present.record.id,
      semanticType: 'explicit-text',
      assertion: present.record.assertion,
      currentScreenshot: present.currentPng,
      currentEnvironment: present.record.environment,
      positiveEvidence: present.positiveEvidence,
      negativeEvidence: present.negativeEvidence,
      expectedText: '设置',
      ocrMode: 'required',
      ocrEngine: engine,
    });
    expect(withEngine.decision).toBe('supported');
    expect(withEngine.ocr?.modelVersion).toBe('fixture-glyph-ocr@1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('指标分母人工可算；损坏数据显式报错且不得判有效通过（任务 2.3）', async () => {
    const tiny: SampleEvaluation[] = [
      {
        sampleId: 't1',
        semanticType: 'binary-control',
        assertion: 'a',
        group: 'validation',
        humanLabel: true,
        expectedDecision: 'supported',
        decision: 'supported',
        reason: '',
        code: 'observed-positive',
        latencyMs: 10,
        matcher: {},
      },
      {
        sampleId: 't2',
        semanticType: 'binary-control',
        assertion: 'a',
        group: 'validation',
        humanLabel: false,
        expectedDecision: 'contradicted',
        decision: 'supported',
        reason: '',
        code: 'observed-positive',
        latencyMs: 10,
        matcher: {},
      },
      {
        sampleId: 't3',
        semanticType: 'binary-control',
        assertion: 'a',
        group: 'validation',
        humanLabel: true,
        expectedDecision: 'supported',
        decision: 'contradicted',
        reason: '',
        code: 'observed-negative',
        latencyMs: 5,
        matcher: {},
      },
      {
        sampleId: 't4',
        semanticType: 'open-semantic',
        assertion: '页面正常',
        group: 'validation',
        humanLabel: 'unknown',
        expectedDecision: 'unknown',
        decision: 'unknown',
        reason: '',
        code: 'unsupported-semantic',
        latencyMs: 1,
        matcher: {},
      },
    ];
    const binary = computeTypeMetrics(tiny, 'binary-control');
    expect(binary.humanTrue).toBe(2);
    expect(binary.humanFalse).toBe(1);
    expect(binary.falsePass).toBe(1);
    expect(binary.falsePassRate).toBe(1);
    expect(binary.falseReject).toBe(1);
    expect(binary.falseRejectRate).toBe(0.5);
    expect(binary.coverage).toBeCloseTo(1);
    expect(binary.totalLatencyMs).toBe(25);
    const verdict = decideGoNoGo(tiny);
    expect(verdict.conclusion).toBe('no-go');
    expect(verdict.checks.falsePassIsZero).toBe(false);

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-assert-'));
    await persistVisualAssertFixtures(tmp, built);
    await fs.rm(path.join(tmp, 'png/cal-wifi/on-original.png'));
    const broken = await runEvaluation({ datasetDir: tmp, split: 'calibration' });
    expect(broken.errors.length).toBeGreaterThan(0);
    expect(broken.samples.some((sample) => sample.decision === 'error')).toBe(true);
    expect(broken.summary.verdict.conclusion).toBe('no-go');
    expect(broken.summary.verdict.checks.noDataOrExecutionErrors).toBe(false);
  });
});

describe('冻结验证与研究报告（任务 3.1–3.2）', () => {
  it('校准后冻结验证跑两次，决策计数一致，并写出 go/no-go 报告', async () => {
    const built = await fixturesPromise;
    await persistVisualAssertFixtures(FIXTURE_ROOT, built);
    const experiencesBefore = await fs.readdir(path.join(repoRoot, 'experiences')).catch(() => []);
    const result = await persistFrozenExperiment({
      datasetDir: FIXTURE_ROOT,
      outputDir: OUTPUT_ROOT,
    });
    expect(JSON.stringify(stripTiming(result.validation1.samples))).toBe(
      JSON.stringify(stripTiming(result.validation2.samples)),
    );
    expect(result.validation1.summary.overall.supported).toBe(
      result.validation2.summary.overall.supported,
    );
    expect(result.validation1.samples.every((sample) => sample.decision !== 'error')).toBe(true);
    const difficult = result.validation1.samples.filter((sample) =>
      sample.sampleId.includes('removed') ||
      sample.sampleId.includes('other-page') ||
      sample.semanticType === 'open-semantic',
    );
    expect(difficult.length).toBeGreaterThan(0);
    expect(difficult.every((sample) => sample.decision === 'unknown')).toBe(true);

    const report = await fs.readFile(result.reportPath, 'utf8');
    expect(report).toMatch(/\*\*结论：(GO|NO-GO)\*\*/);
    expect(report).toContain('不替换原生');
    expect(report).toContain(REPRO_COMMAND);
    expect(report).toContain('aiAssert');
    const experiencesAfter = await fs.readdir(path.join(repoRoot, 'experiences')).catch(() => []);
    expect(experiencesAfter).toEqual(experiencesBefore);
  }, 180_000);
});
