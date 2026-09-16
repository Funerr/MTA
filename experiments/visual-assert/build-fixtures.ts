import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { BoundingBox } from '../../src/experience/schema/action';
import type { ExperienceEnvironment } from '../../src/experience/schema/environment';
import { defaultImagePipeline, expandBox } from '../../src/experience/promotion/image';
import { executionCompatVersion } from '../../src/experience/promotion/constants';
import { RgbaCanvas, type RGB } from './canvas';
import {
  CONTEXT_PAD,
  DATA_VERSION,
  FIXTURE_HEIGHT,
  FIXTURE_ROOT,
  FIXTURE_WIDTH,
  IMAGE_PIPELINE_VERSION,
  MATCHER_VERSION,
  STATUS_BAR_MASK,
} from './constants';
import { VISUAL_ASSERT_PROTOCOL } from './protocol';
import type { HumanLabel, SampleRecord, SemanticType, SplitGroup } from './types';
import { assertNoCrossGroupVariants, countDataset, parseDatasetFile } from './dataset';

interface Theme {
  readonly header: RGB;
  readonly content: RGB;
  readonly panel: RGB;
  readonly accent: RGB;
}

interface CaptureSpec {
  readonly id: string;
  readonly group: SplitGroup;
  readonly semanticType: Exclude<SemanticType, 'open-semantic'>;
  readonly assertion: string;
  readonly theme: Theme;
  readonly bbox: BoundingBox;
  readonly stateBox?: BoundingBox;
  readonly glyphSeed: number;
  readonly textHint?: string;
}

const ENVIRONMENT: ExperienceEnvironment = {
  platform: 'android',
  model: 'Pixel 8',
  systemBuild: 'AP4A.250105.002',
  resolution: { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT },
  orientation: 'portrait',
  language: 'zh-CN',
  theme: 'light',
  executionCompatVersion: executionCompatVersion(),
};

const OTHER_PAGE_THEME: Theme = {
  header: { r: 230, g: 120, b: 20 },
  content: { r: 36, g: 40, b: 48 },
  panel: { r: 60, g: 64, b: 72 },
  accent: { r: 255, g: 180, b: 60 },
};

const CAPTURES: readonly CaptureSpec[] = [
  {
    id: 'cal-wifi',
    group: 'calibration',
    semanticType: 'binary-control',
    assertion: 'Wi-Fi 开关已开启',
    theme: {
      header: { r: 30, g: 90, b: 180 },
      content: { r: 245, g: 245, b: 248 },
      panel: { r: 255, g: 255, b: 255 },
      accent: { r: 20, g: 60, b: 140 },
    },
    bbox: { x: 48, y: 240, width: 168, height: 48 },
    stateBox: { x: 248, y: 248, width: 56, height: 32 },
    glyphSeed: 0x111111,
  },
  {
    id: 'cal-bluetooth',
    group: 'calibration',
    semanticType: 'binary-control',
    assertion: '蓝牙开关已开启',
    theme: {
      header: { r: 16, g: 140, b: 150 },
      content: { r: 240, g: 248, b: 248 },
      panel: { r: 255, g: 255, b: 255 },
      accent: { r: 10, g: 100, b: 110 },
    },
    bbox: { x: 72, y: 300, width: 168, height: 48 },
    stateBox: { x: 286, y: 308, width: 56, height: 32 },
    glyphSeed: 0x222222,
  },
  {
    id: 'val-wifi',
    group: 'validation',
    semanticType: 'binary-control',
    assertion: 'Wi-Fi 开关已开启',
    theme: {
      header: { r: 90, g: 40, b: 140 },
      content: { r: 248, g: 244, b: 250 },
      panel: { r: 255, g: 250, b: 255 },
      accent: { r: 70, g: 24, b: 110 },
    },
    bbox: { x: 56, y: 220, width: 160, height: 48 },
    stateBox: { x: 250, y: 228, width: 52, height: 32 },
    glyphSeed: 0x333333,
  },
  {
    id: 'val-bluetooth',
    group: 'validation',
    semanticType: 'binary-control',
    assertion: '蓝牙开关已开启',
    theme: {
      header: { r: 160, g: 50, b: 40 },
      content: { r: 250, g: 246, b: 242 },
      panel: { r: 255, g: 255, b: 255 },
      accent: { r: 120, g: 30, b: 24 },
    },
    bbox: { x: 72, y: 310, width: 164, height: 48 },
    stateBox: { x: 286, y: 318, width: 54, height: 32 },
    glyphSeed: 0x444444,
  },
  {
    id: 'cal-settings-title',
    group: 'calibration',
    semanticType: 'explicit-text',
    assertion: '屏幕显示「设置」标题',
    theme: {
      header: { r: 20, g: 80, b: 160 },
      content: { r: 246, g: 247, b: 250 },
      panel: { r: 255, g: 255, b: 255 },
      accent: { r: 16, g: 64, b: 128 },
    },
    bbox: { x: 72, y: 200, width: 216, height: 56 },
    glyphSeed: 0xabcdef,
    textHint: '设置',
  },
  {
    id: 'cal-airplane-label',
    group: 'calibration',
    semanticType: 'explicit-text',
    assertion: '屏幕显示「飞行模式」',
    theme: {
      header: { r: 40, g: 120, b: 80 },
      content: { r: 244, g: 250, b: 246 },
      panel: { r: 255, g: 255, b: 255 },
      accent: { r: 20, g: 90, b: 50 },
    },
    bbox: { x: 60, y: 320, width: 200, height: 48 },
    glyphSeed: 0xb0b0ca,
    textHint: '飞行模式',
  },
  {
    id: 'val-settings-title',
    group: 'validation',
    semanticType: 'explicit-text',
    assertion: '屏幕显示「设置」标题',
    theme: {
      header: { r: 70, g: 70, b: 20 },
      content: { r: 250, g: 250, b: 240 },
      panel: { r: 255, g: 255, b: 248 },
      accent: { r: 90, g: 90, b: 20 },
    },
    bbox: { x: 80, y: 210, width: 200, height: 52 },
    glyphSeed: 0x55aa77,
    textHint: '设置',
  },
  {
    id: 'val-airplane-label',
    group: 'validation',
    semanticType: 'explicit-text',
    assertion: '屏幕显示「飞行模式」',
    theme: {
      header: { r: 120, g: 40, b: 80 },
      content: { r: 250, g: 244, b: 246 },
      panel: { r: 255, g: 252, b: 253 },
      accent: { r: 96, g: 24, b: 60 },
    },
    bbox: { x: 68, y: 300, width: 208, height: 48 },
    glyphSeed: 0x7e7e01,
    textHint: '飞行模式',
  },
];

const OPEN_SEMANTIC_EXTRAS = [
  { captureId: 'cal-wifi', assertion: '布局合理' },
  { captureId: 'val-wifi', assertion: '无明显异常' },
] as const;

function shiftPx(ratio: number, axis: 'x' | 'y', sign: 1 | -1): { x: number; y: number } {
  const span = axis === 'x' ? FIXTURE_WIDTH : FIXTURE_HEIGHT;
  const delta = Math.round(ratio * span) * sign;
  return axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta };
}

function translate(box: BoundingBox, shift: { x: number; y: number }): BoundingBox {
  return { x: box.x + shift.x, y: box.y + shift.y, width: box.width, height: box.height };
}

function paintScene(
  spec: CaptureSpec,
  options: {
    shift: { x: number; y: number };
    positive: boolean;
    hideTarget: boolean;
    occlude: boolean;
    otherPage: boolean;
  },
): RgbaCanvas {
  const theme = options.otherPage ? OTHER_PAGE_THEME : spec.theme;
  const canvas = new RgbaCanvas(FIXTURE_WIDTH, FIXTURE_HEIGHT, theme.content);
  canvas.fill(STATUS_BAR_MASK, { r: 18, g: 18, b: 22 });
  canvas.fill({ x: 0, y: 40, width: FIXTURE_WIDTH, height: 64 }, theme.header);
  canvas.fill({ x: 16, y: 52, width: 72, height: 40 }, theme.accent);
  canvas.fill({ x: 104, y: 58, width: 40, height: 28 }, { r: 255, g: 255, b: 255 });
  canvas.fill({ x: 0, y: 104, width: 16, height: FIXTURE_HEIGHT - 104 }, theme.accent);
  canvas.fill({ x: 40, y: 120, width: 90, height: 28 }, theme.accent);
  canvas.fill({ x: 220, y: 520, width: 100, height: 36 }, theme.accent);

  if (options.hideTarget) return canvas;

  const targetBox = translate(spec.bbox, options.shift);
  const stateBox = spec.stateBox ? translate(spec.stateBox, options.shift) : undefined;
  if (stateBox) {
    const x0 = Math.min(targetBox.x, stateBox.x);
    const y0 = Math.min(targetBox.y, stateBox.y);
    const x1 = Math.max(targetBox.x + targetBox.width, stateBox.x + stateBox.width);
    const y1 = Math.max(targetBox.y + targetBox.height, stateBox.y + stateBox.height);
    canvas.fill({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, theme.panel);
  } else {
    canvas.fill(targetBox, theme.panel);
  }

  if (spec.semanticType === 'binary-control') {
    canvas.glyph(
      {
        x: targetBox.x + 8,
        y: targetBox.y + 8,
        width: Math.max(8, targetBox.width - 16),
        height: targetBox.height - 16,
      },
      spec.glyphSeed,
    );
    if (stateBox) canvas.toggle(stateBox, options.positive);
  } else if (options.positive) {
    canvas.glyph(targetBox, spec.glyphSeed);
  } else {
    // 反例是另一组明确字形，而不是周期性条纹：条纹会在搜索窗内产生过多 ZNCC 峰。
    canvas.glyph(targetBox, spec.glyphSeed ^ 0xa5a5a5);
  }

  if (options.occlude) {
    canvas.fill(
      {
        x: targetBox.x - 4,
        y: targetBox.y - 4,
        width: targetBox.width + 8,
        height: targetBox.height + 8,
      },
      { r: 88, g: 88, b: 92 },
    );
  }
  return canvas;
}

interface VariantDef {
  readonly variant: string;
  readonly shift: { x: number; y: number };
  readonly positive: boolean;
  readonly hideTarget: boolean;
  readonly occlude: boolean;
  readonly otherPage: boolean;
  readonly humanLabel: HumanLabel;
  readonly expectedDecision: SampleRecord['expectedDecision'];
  readonly openSemantic?: string;
  readonly environmentOverride?: Partial<ExperienceEnvironment>;
}

function polarityVariants(): VariantDef[] {
  const shifts = [
    { variant: 'original', shift: { x: 0, y: 0 } },
    { variant: 'shift-x-p1', shift: shiftPx(0.01, 'x', 1) },
    { variant: 'shift-x-m1', shift: shiftPx(0.01, 'x', -1) },
    { variant: 'shift-y-p1', shift: shiftPx(0.01, 'y', 1) },
    { variant: 'shift-y-m1', shift: shiftPx(0.01, 'y', -1) },
  ];
  const variants: VariantDef[] = [];
  for (const item of shifts) {
    variants.push({
      variant: `on-${item.variant}`,
      shift: item.shift,
      positive: true,
      hideTarget: false,
      occlude: false,
      otherPage: false,
      humanLabel: true,
      expectedDecision: 'supported',
    });
    variants.push({
      variant: `off-${item.variant}`,
      shift: item.shift,
      positive: false,
      hideTarget: false,
      occlude: false,
      otherPage: false,
      humanLabel: false,
      expectedDecision: 'contradicted',
    });
  }
  variants.push({
    variant: 'removed',
    shift: { x: 0, y: 0 },
    positive: true,
    hideTarget: true,
    occlude: false,
    otherPage: false,
    humanLabel: 'unknown',
    expectedDecision: 'unknown',
  });
  variants.push({
    variant: 'other-page',
    shift: { x: 0, y: 0 },
    positive: true,
    hideTarget: false,
    occlude: false,
    otherPage: true,
    humanLabel: 'unknown',
    expectedDecision: 'unknown',
  });
  return variants;
}

function annotation() {
  return {
    annotator: 'fixture-author',
    basis: 'synthetic-render-parameters',
    modelJudgement: null,
    source: 'experiments/visual-assert/build-fixtures.ts',
  } as const;
}

export interface BuiltFixture {
  readonly records: SampleRecord[];
  readonly files: Map<string, Uint8Array>;
}

export async function buildVisualAssertFixtures(): Promise<BuiltFixture> {
  const files = new Map<string, Uint8Array>();
  const records: SampleRecord[] = [];
  const openOriginal = new Map<string, string>();

  for (const spec of CAPTURES) {
    const positiveCanonical = await paintScene(spec, {
      shift: { x: 0, y: 0 },
      positive: true,
      hideTarget: false,
      occlude: false,
      otherPage: false,
    }).toPng();
    const negativeCanonical = await paintScene(spec, {
      shift: { x: 0, y: 0 },
      positive: false,
      hideTarget: false,
      occlude: false,
      otherPage: false,
    }).toPng();
    const contextBox = expandBox(
      spec.bbox,
      { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT },
      CONTEXT_PAD,
    );
    const evidence = {
      positive: {
        screenshot: `png/${spec.id}/_historical-on.png`,
        target: `png/${spec.id}/_target-on.png`,
        context: `png/${spec.id}/_context-on.png`,
        state: spec.stateBox ? `png/${spec.id}/_state-on.png` : undefined,
        bbox: spec.bbox,
        stateBox: spec.stateBox,
      },
      negative: {
        screenshot: `png/${spec.id}/_historical-off.png`,
        target: `png/${spec.id}/_target-off.png`,
        context: `png/${spec.id}/_context-off.png`,
        state: spec.stateBox ? `png/${spec.id}/_state-off.png` : undefined,
        bbox: spec.bbox,
        stateBox: spec.stateBox,
      },
    };
    files.set(evidence.positive.screenshot, positiveCanonical);
    files.set(evidence.negative.screenshot, negativeCanonical);
    files.set(evidence.positive.target, await defaultImagePipeline.crop(positiveCanonical, spec.bbox));
    files.set(evidence.negative.target, await defaultImagePipeline.crop(negativeCanonical, spec.bbox));
    files.set(
      evidence.positive.context,
      await defaultImagePipeline.crop(positiveCanonical, contextBox),
    );
    files.set(
      evidence.negative.context,
      await defaultImagePipeline.crop(negativeCanonical, contextBox),
    );
    if (spec.stateBox && evidence.positive.state && evidence.negative.state) {
      files.set(
        evidence.positive.state,
        await defaultImagePipeline.crop(positiveCanonical, spec.stateBox),
      );
      files.set(
        evidence.negative.state,
        await defaultImagePipeline.crop(negativeCanonical, spec.stateBox),
      );
    }

    for (const variant of polarityVariants()) {
      const png = await paintScene(spec, {
        shift: variant.shift,
        positive: variant.positive,
        hideTarget: variant.hideTarget,
        occlude: variant.occlude,
        otherPage: variant.otherPage,
      }).toPng();
      const relative = `png/${spec.id}/${variant.variant}.png`;
      files.set(relative, png);
      if (variant.variant === 'on-original') openOriginal.set(spec.id, relative);
      records.push({
        id: `${spec.id}/${variant.variant}`,
        captureId: spec.id,
        sourceImageId: spec.id,
        group: spec.group,
        semanticType: spec.semanticType,
        assertion: spec.assertion,
        claimedState: 'positive',
        humanLabel: variant.humanLabel,
        expectedDecision: variant.expectedDecision,
        environment: ENVIRONMENT,
        currentImage: relative,
        variant: variant.variant,
        shift: variant.shift,
        annotation: annotation(),
        evidence,
      });
    }

    records.push({
      id: `${spec.id}/open-semantic`,
      captureId: spec.id,
      sourceImageId: spec.id,
      group: spec.group,
      semanticType: 'open-semantic',
      assertion: '页面正常',
      claimedState: 'positive',
      humanLabel: 'unknown',
      expectedDecision: 'unknown',
      environment: ENVIRONMENT,
      currentImage: openOriginal.get(spec.id) ?? `png/${spec.id}/on-original.png`,
      variant: 'open-semantic',
      shift: { x: 0, y: 0 },
      annotation: annotation(),
    });
  }

  for (const extra of OPEN_SEMANTIC_EXTRAS) {
    const spec = CAPTURES.find((item) => item.id === extra.captureId);
    if (!spec) continue;
    records.push({
      id: `${extra.captureId}/open-semantic-extra`,
      captureId: extra.captureId,
      sourceImageId: extra.captureId,
      group: spec.group,
      semanticType: 'open-semantic',
      assertion: extra.assertion,
      claimedState: 'positive',
      humanLabel: 'unknown',
      expectedDecision: 'unknown',
      environment: ENVIRONMENT,
      currentImage: openOriginal.get(extra.captureId) ?? `png/${extra.captureId}/on-original.png`,
      variant: 'open-semantic-extra',
      shift: { x: 0, y: 0 },
      annotation: annotation(),
    });
  }

  assertNoCrossGroupVariants(records);
  return { records, files };
}

export function renderFixtureSummary(records: readonly SampleRecord[]): string {
  const counted = countDataset(records);
  const lines = [
    '# 视觉断言实验夹具摘要',
    '',
    `- 数据版本：\`${DATA_VERSION}\``,
    `- 图像管线：\`${IMAGE_PIPELINE_VERSION}\``,
    `- 匹配配置：\`${MATCHER_VERSION}\``,
    `- 样本总数：${counted.total}（校准 ${counted.byGroup.calibration} / 验证 ${counted.byGroup.validation}）`,
    '- 分组：同一原始捕获的全部变体进入同一组，不跨校准/验证拆散原图。',
    '- 布局：控件与文本目标需为 context 扩边留出边距，避免位移后框被夹紧导致尺寸不一致。',
    '- 标注：由绘制参数决定正反状态，不是模型标签；`annotation.modelJudgement` 恒为 null。',
    '- 合成位移用于算法边界，不代表真实设备业务页面覆盖率。',
    '',
  ];
  for (const [type, bucket] of Object.entries(counted.byType)) {
    lines.push(
      `- \`${type}\`：正例 ${bucket.true}，反例 ${bucket.false}，unknown ${bucket.unknown}`,
    );
  }
  lines.push('', '## 捕获清单', '');
  const captures = [...new Set(records.map((item) => item.captureId))];
  for (const id of captures) {
    const items = records.filter((item) => item.captureId === id);
    const first = items[0]!;
    lines.push(`### ${id}（${first.group}）`);
    lines.push('');
    lines.push(`- 原图 id：\`${first.sourceImageId}\``);
    lines.push(`- 变体：${items.map((item) => item.variant).join('、')}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export async function persistVisualAssertFixtures(
  root: string = FIXTURE_ROOT,
  built?: BuiltFixture,
): Promise<{ datasetPath: string; summaryPath: string; pngCount: number }> {
  const { records, files } = built ?? (await buildVisualAssertFixtures());
  const dataset = {
    dataVersion: DATA_VERSION,
    matcherConfigVersion: MATCHER_VERSION,
    pipeline: IMAGE_PIPELINE_VERSION,
    protocol: VISUAL_ASSERT_PROTOCOL,
    generation: {
      method: 'synthetic-rgba-blit',
      note: '合成夹具用于有限评估，不代表跨设备统计保证',
    },
    captures: CAPTURES.map((item) => ({
      id: item.id,
      sourceImageId: item.id,
      group: item.group,
      semanticType: item.semanticType,
    })),
    samples: records,
  };
  parseDatasetFile({
    dataVersion: dataset.dataVersion,
    captures: dataset.captures,
    samples: dataset.samples,
  });

  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  for (const [relative, bytes] of files) {
    const absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, bytes);
  }
  const datasetPath = path.join(root, 'dataset.json');
  const summaryPath = path.join(root, 'summary.md');
  const protocolPath = path.join(root, 'protocol.json');
  await fs.writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
  await fs.writeFile(summaryPath, renderFixtureSummary(records));
  await fs.writeFile(protocolPath, `${JSON.stringify(VISUAL_ASSERT_PROTOCOL, null, 2)}\n`);
  return { datasetPath, summaryPath, pngCount: files.size };
}
