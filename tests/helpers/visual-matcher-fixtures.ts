import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { BoundingBox } from '../../src/experience/schema/action';
import type { ExperienceEnvironment } from '../../src/experience/schema/environment';
import {
  CONTEXT_PAD_RATIO,
  executionCompatVersion,
} from '../../src/experience/promotion/constants';
import { defaultImagePipeline, expandBox } from '../../src/experience/promotion/image';
import {
  MATCHER_DATA_VERSION,
  MATCHER_IMAGE_PIPELINE_VERSION,
} from '../../src/experience/matcher/constants';
import { FROZEN_MATCHER_CONFIG } from '../../src/experience/matcher/config';
import type { MatchTargetInput } from '../../src/experience/matcher/types';

export const FIXTURE_WIDTH = 360;
export const FIXTURE_HEIGHT = 640;
export const STATUS_BAR_MASK: BoundingBox = {
  x: 0,
  y: 0,
  width: FIXTURE_WIDTH,
  height: 40,
};

export const MATCHER_FIXTURE_ENVIRONMENT: ExperienceEnvironment = {
  platform: 'android',
  model: 'Pixel 8',
  systemBuild: 'AP4A.250105.002',
  resolution: { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT },
  orientation: 'portrait',
  language: 'zh-CN',
  theme: 'light',
  executionCompatVersion: executionCompatVersion(),
};

export const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/visual-matcher',
);

type RGB = { r: number; g: number; b: number };

interface Theme {
  readonly header: RGB;
  readonly content: RGB;
  readonly panel: RGB;
  readonly accent: RGB;
}

interface CaptureSpec {
  readonly id: string;
  readonly group: 'calibration' | 'validation';
  readonly kind: 'row' | 'icon';
  readonly theme: Theme;
  readonly bbox: BoundingBox;
  readonly stateBox?: BoundingBox;
  readonly glyphSeed: number;
}

export interface FixtureCase {
  readonly captureId: string;
  readonly group: 'calibration' | 'validation';
  readonly kind: 'row' | 'icon';
  readonly caseId: string;
  readonly expect: 'accept' | 'reject';
  readonly rejectCode?: string;
  readonly shift: { readonly x: number; readonly y: number };
  readonly currentPng: Uint8Array;
  readonly historicalPng: Uint8Array;
  readonly targetPng: Uint8Array;
  readonly contextPng: Uint8Array;
  readonly statePng?: Uint8Array;
  readonly bbox: BoundingBox;
  readonly expectedBox: BoundingBox;
  readonly stateBox?: BoundingBox;
  readonly masks: readonly BoundingBox[];
  readonly environment: ExperienceEnvironment;
  readonly textHint?: string;
}

class RgbaCanvas {
  readonly data: Buffer;

  constructor(
    readonly width: number,
    readonly height: number,
    background: RGB,
  ) {
    this.data = Buffer.alloc(width * height * 4, 255);
    this.fill({ x: 0, y: 0, width, height }, background);
  }

  fill(box: BoundingBox, rgb: RGB): void {
    const x0 = Math.max(0, box.x);
    const y0 = Math.max(0, box.y);
    const x1 = Math.min(this.width, box.x + box.width);
    const y1 = Math.min(this.height, box.y + box.height);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * this.width + x) * 4;
        this.data[i] = rgb.r;
        this.data[i + 1] = rgb.g;
        this.data[i + 2] = rgb.b;
        this.data[i + 3] = 255;
      }
    }
  }

  glyph(box: BoundingBox, seed: number): void {
    const cols = 6;
    const rows = 6;
    const cellW = Math.max(1, Math.floor(box.width / cols));
    const cellH = Math.max(1, Math.floor(box.height / rows));
    let state = seed >>> 0;
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const on = (state & 3) !== 0;
        const x = box.x + gx * cellW;
        const y = box.y + gy * cellH;
        const width = gx === cols - 1 ? box.width - gx * cellW : cellW;
        const height = gy === rows - 1 ? box.height - gy * cellH : cellH;
        const rgb = on
          ? {
              r: 12 + (state & 47),
              g: 20 + ((state >>> 8) & 47),
              b: 180 + ((state >>> 16) & 47),
            }
          : { r: 252, g: 252, b: 255 };
        this.fill({ x, y, width, height }, rgb);
      }
    }
  }

  toggle(box: BoundingBox, on: boolean): void {
    this.fill(box, on ? { r: 46, g: 170, b: 80 } : { r: 168, g: 170, b: 176 });
    const knob = Math.max(8, Math.floor(box.height * 0.72));
    const pad = Math.floor((box.height - knob) / 2);
    const kx = on ? box.x + box.width - pad - knob : box.x + pad;
    this.fill(
      { x: kx, y: box.y + pad, width: knob, height: knob },
      { r: 255, g: 255, b: 255 },
    );
  }

  async toPng(): Promise<Uint8Array> {
    const buffer = await sharp(this.data, {
      raw: { width: this.width, height: this.height, channels: 4 },
    })
      .png({ compressionLevel: 6 })
      .toBuffer();
    return new Uint8Array(buffer);
  }
}

const THEMES: Record<string, Theme> = {
  'cal-row': {
    header: { r: 30, g: 90, b: 180 },
    content: { r: 245, g: 245, b: 248 },
    panel: { r: 255, g: 255, b: 255 },
    accent: { r: 20, g: 60, b: 140 },
  },
  'cal-icon': {
    header: { r: 160, g: 40, b: 40 },
    content: { r: 250, g: 248, b: 240 },
    panel: { r: 255, g: 252, b: 245 },
    accent: { r: 120, g: 24, b: 24 },
  },
  'val-row': {
    header: { r: 20, g: 130, b: 90 },
    content: { r: 242, g: 246, b: 242 },
    panel: { r: 255, g: 255, b: 255 },
    accent: { r: 12, g: 90, b: 60 },
  },
  'val-icon': {
    header: { r: 90, g: 40, b: 140 },
    content: { r: 248, g: 244, b: 250 },
    panel: { r: 255, g: 250, b: 255 },
    accent: { r: 70, g: 24, b: 110 },
  },
};

const OTHER_PAGE_THEME: Theme = {
  header: { r: 230, g: 120, b: 20 },
  content: { r: 36, g: 40, b: 48 },
  panel: { r: 60, g: 64, b: 72 },
  accent: { r: 255, g: 180, b: 60 },
};

/** 图标边长须小于搜索半径，才能在 ±3% 窗口内放下两个不重叠的重复目标。 */
const CAPTURES: readonly CaptureSpec[] = [
  {
    id: 'cal-row',
    group: 'calibration',
    kind: 'row',
    theme: THEMES['cal-row']!,
    bbox: { x: 72, y: 240, width: 120, height: 56 },
    stateBox: { x: 248, y: 252, width: 52, height: 32 },
    glyphSeed: 0xc0ffee,
  },
  {
    id: 'cal-icon',
    group: 'calibration',
    kind: 'icon',
    theme: THEMES['cal-icon']!,
    bbox: { x: 168, y: 300, width: 8, height: 8 },
    glyphSeed: 0xa11ce,
  },
  {
    id: 'val-row',
    group: 'validation',
    kind: 'row',
    theme: THEMES['val-row']!,
    bbox: { x: 80, y: 268, width: 112, height: 52 },
    stateBox: { x: 252, y: 278, width: 48, height: 32 },
    glyphSeed: 0xbeef01,
  },
  {
    id: 'val-icon',
    group: 'validation',
    kind: 'icon',
    theme: THEMES['val-icon']!,
    bbox: { x: 150, y: 310, width: 8, height: 8 },
    glyphSeed: 0x5eed02,
  },
];

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
    toggleOn: boolean;
    clockSeed: number;
    hideTarget: boolean;
    occlude: boolean;
    extraIcon: boolean;
    structural: boolean;
    otherPage: boolean;
  },
): RgbaCanvas {
  const theme = options.otherPage ? OTHER_PAGE_THEME : spec.theme;
  const canvas = new RgbaCanvas(FIXTURE_WIDTH, FIXTURE_HEIGHT, theme.content);

  canvas.fill(STATUS_BAR_MASK, { r: 18, g: 18, b: 22 });
  let clock = options.clockSeed >>> 0;
  for (let i = 0; i < 7; i += 1) {
    clock = (Math.imul(clock, 1103515245) + 12345) >>> 0;
    canvas.fill(
      { x: 10 + i * 20, y: 8, width: 14, height: 22 },
      { r: 180 + (clock & 31), g: 190 + ((clock >>> 5) & 31), b: 200 },
    );
  }

  if (options.structural) {
    canvas.fill({ x: 0, y: 560, width: FIXTURE_WIDTH, height: 80 }, theme.header);
    canvas.fill({ x: 24, y: 120, width: 120, height: 80 }, theme.accent);
    canvas.fill({ x: 200, y: 430, width: 130, height: 70 }, { r: 90, g: 90, b: 20 });
  } else {
    canvas.fill({ x: 0, y: 40, width: FIXTURE_WIDTH, height: 64 }, theme.header);
    canvas.fill({ x: 16, y: 52, width: 72, height: 40 }, theme.accent);
    canvas.fill({ x: 104, y: 58, width: 40, height: 28 }, { r: 255, g: 255, b: 255 });
    canvas.fill({ x: 0, y: 104, width: 16, height: FIXTURE_HEIGHT - 104 }, theme.accent);
    canvas.fill({ x: 40, y: 120, width: 90, height: 28 }, theme.accent);
    canvas.fill({ x: 220, y: 520, width: 100, height: 36 }, theme.accent);
  }

  const targetBox = translate(spec.bbox, options.shift);
  const stateBox = spec.stateBox ? translate(spec.stateBox, options.shift) : undefined;

  if (!options.hideTarget) {
    if (spec.kind === 'row') {
      if (stateBox) {
        const x0 = Math.min(targetBox.x, stateBox.x);
        const y0 = Math.min(targetBox.y, stateBox.y);
        const x1 = Math.max(targetBox.x + targetBox.width, stateBox.x + stateBox.width);
        const y1 = Math.max(targetBox.y + targetBox.height, stateBox.y + stateBox.height);
        canvas.fill({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, theme.panel);
      } else {
        canvas.fill(targetBox, theme.panel);
      }
      canvas.glyph(
        {
          x: targetBox.x + 8,
          y: targetBox.y + 8,
          width: Math.max(8, targetBox.width - 16),
          height: targetBox.height - 16,
        },
        spec.glyphSeed,
      );
      if (stateBox) canvas.toggle(stateBox, options.toggleOn);
    } else {
      canvas.glyph(targetBox, spec.glyphSeed);
    }
    if (options.extraIcon) {
      canvas.glyph(translate(spec.bbox, { x: 10, y: 0 }), spec.glyphSeed);
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
  }

  return canvas;
}

interface VariantDef {
  readonly caseId: string;
  readonly expect: 'accept' | 'reject';
  readonly rejectCode?: string;
  readonly shift: { x: number; y: number };
  readonly toggleOn?: boolean;
  readonly clockSeed?: number;
  readonly hideTarget?: boolean;
  readonly occlude?: boolean;
  readonly extraIcon?: boolean;
  readonly structural?: boolean;
  readonly otherPage?: boolean;
}

function variantsFor(spec: CaptureSpec): VariantDef[] {
  const variants: VariantDef[] = [
    { caseId: 'original', expect: 'accept', shift: { x: 0, y: 0 } },
    { caseId: 'shift-x-p1', expect: 'accept', shift: shiftPx(0.01, 'x', 1) },
    { caseId: 'shift-x-m1', expect: 'accept', shift: shiftPx(0.01, 'x', -1) },
    { caseId: 'shift-y-p1', expect: 'accept', shift: shiftPx(0.01, 'y', 1) },
    { caseId: 'shift-y-m1', expect: 'accept', shift: shiftPx(0.01, 'y', -1) },
    { caseId: 'shift-x-p3', expect: 'accept', shift: shiftPx(0.03, 'x', 1) },
    { caseId: 'shift-x-m3', expect: 'accept', shift: shiftPx(0.03, 'x', -1) },
    { caseId: 'shift-y-p3', expect: 'accept', shift: shiftPx(0.03, 'y', 1) },
    { caseId: 'shift-y-m3', expect: 'accept', shift: shiftPx(0.03, 'y', -1) },
    { caseId: 'status-bar-changed', expect: 'accept', shift: { x: 0, y: 0 }, clockSeed: 99 },
    {
      caseId: 'other-page-same-icon',
      expect: 'reject',
      rejectCode: 'page-mismatch',
      shift: { x: 0, y: 0 },
      otherPage: true,
    },
    {
      caseId: 'target-removed',
      expect: 'reject',
      rejectCode: 'target-missing',
      shift: { x: 0, y: 0 },
      hideTarget: true,
    },
    {
      caseId: 'occluded',
      expect: 'reject',
      rejectCode: 'target-missing',
      shift: { x: 0, y: 0 },
      occlude: true,
    },
    {
      caseId: 'structural-change',
      expect: 'reject',
      rejectCode: 'page-mismatch',
      shift: { x: 0, y: 0 },
      structural: true,
    },
  ];
  if (spec.kind === 'row') {
    variants.push({
      caseId: 'state-inverted',
      expect: 'reject',
      rejectCode: 'state-mismatch',
      shift: { x: 0, y: 0 },
      toggleOn: true,
    });
  } else {
    variants.push({
      caseId: 'ambiguous-duplicate',
      expect: 'reject',
      rejectCode: 'ambiguous',
      shift: { x: 0, y: 0 },
      extraIcon: true,
    });
  }
  return variants;
}

export async function buildVisualMatcherFixtures(): Promise<{
  readonly cases: FixtureCase[];
}> {
  const cases: FixtureCase[] = [];

  for (const spec of CAPTURES) {
    const original = await paintScene(spec, {
      shift: { x: 0, y: 0 },
      toggleOn: false,
      clockSeed: 1,
      hideTarget: false,
      occlude: false,
      extraIcon: false,
      structural: false,
      otherPage: false,
    }).toPng();
    const contextBox = expandBox(
      spec.bbox,
      { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT },
      CONTEXT_PAD_RATIO,
    );
    const target = await defaultImagePipeline.crop(original, spec.bbox);
    const context = await defaultImagePipeline.crop(original, contextBox);
    const state = spec.stateBox
      ? await defaultImagePipeline.crop(original, spec.stateBox)
      : undefined;

    for (const variant of variantsFor(spec)) {
      const currentPng = await paintScene(spec, {
        shift: variant.shift,
        toggleOn: variant.toggleOn ?? false,
        clockSeed: variant.clockSeed ?? 1,
        hideTarget: variant.hideTarget ?? false,
        occlude: variant.occlude ?? false,
        extraIcon: variant.extraIcon ?? false,
        structural: variant.structural ?? false,
        otherPage: variant.otherPage ?? false,
      }).toPng();
      cases.push({
        captureId: spec.id,
        group: spec.group,
        kind: spec.kind,
        caseId: variant.caseId,
        expect: variant.expect,
        rejectCode: variant.rejectCode,
        shift: variant.shift,
        currentPng,
        historicalPng: original,
        targetPng: target,
        contextPng: context,
        statePng: state,
        bbox: spec.bbox,
        expectedBox: translate(spec.bbox, variant.shift),
        stateBox: spec.stateBox,
        masks: [STATUS_BAR_MASK],
        environment: MATCHER_FIXTURE_ENVIRONMENT,
        textHint: spec.kind === 'row' ? '亮度' : '图标',
      });
    }
  }

  return { cases };
}

export function toMatchTargetInput(fixture: FixtureCase): MatchTargetInput {
  return {
    currentScreenshot: fixture.currentPng,
    currentEnvironment: fixture.environment,
    historical: {
      environment: fixture.environment,
      screenshot: fixture.historicalPng,
      targetImage: fixture.targetPng,
      contextImage: fixture.contextPng,
      bbox: fixture.bbox,
      stateBefore: fixture.statePng,
      stateBox: fixture.stateBox,
      textHint: fixture.textHint,
      contextPadRatio: CONTEXT_PAD_RATIO,
    },
    masks: fixture.masks,
  };
}

export function fixtureKey(fixture: FixtureCase): string {
  return `${fixture.captureId}/${fixture.caseId}`;
}

export interface FixtureManifest {
  readonly dataVersion: string;
  readonly pipeline: string;
  readonly matcherConfigVersion: string;
  readonly screen: { width: number; height: number };
  readonly statusBarMask: BoundingBox;
  readonly generation: {
    readonly method: string;
    readonly shifts: string;
    readonly note: string;
  };
  readonly captures: Array<{
    id: string;
    group: 'calibration' | 'validation';
    kind: 'row' | 'icon';
    historicalBbox: BoundingBox;
    stateBox?: BoundingBox;
    cases: Array<{
      id: string;
      file: string;
      expect: 'accept' | 'reject';
      rejectCode?: string;
      shift: { x: number; y: number };
      targetBbox: BoundingBox;
    }>;
  }>;
}

export function buildManifest(cases: readonly FixtureCase[]): FixtureManifest {
  const byCapture = new Map<string, FixtureCase[]>();
  for (const item of cases) {
    const list = byCapture.get(item.captureId) ?? [];
    list.push(item);
    byCapture.set(item.captureId, list);
  }
  return {
    dataVersion: MATCHER_DATA_VERSION,
    pipeline: MATCHER_IMAGE_PIPELINE_VERSION,
    matcherConfigVersion: FROZEN_MATCHER_CONFIG.version,
    screen: { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT },
    statusBarMask: STATUS_BAR_MASK,
    generation: {
      method: 'synthetic-rgba-blit',
      shifts: 'delta = round(ratio * dimension) on a single axis; historical bbox unchanged',
      note: '合成位移用于算法边界，不代表真实设备业务页面覆盖率',
    },
    captures: [...byCapture.entries()].map(([id, items]) => {
      const first = items[0]!;
      return {
        id,
        group: first.group,
        kind: first.kind,
        historicalBbox: first.bbox,
        stateBox: first.stateBox,
        cases: items.map((item) => ({
          id: item.caseId,
          file: `png/${item.captureId}/${item.caseId}.png`,
          expect: item.expect,
          rejectCode: item.rejectCode,
          shift: item.shift,
          targetBbox: item.expectedBox,
        })),
      };
    }),
  };
}

export function renderSummaryMarkdown(manifest: FixtureManifest): string {
  const lines = [
    '# 视觉匹配夹具摘要',
    '',
    `- 数据版本：\`${manifest.dataVersion}\``,
    `- 图像管线：\`${manifest.pipeline}\``,
    `- 匹配配置：\`${manifest.matcherConfigVersion}\``,
    `- 画面：${manifest.screen.width}×${manifest.screen.height}，状态栏掩码 ${manifest.statusBarMask.width}×${manifest.statusBarMask.height}`,
    `- 生成：${manifest.generation.method}；${manifest.generation.shifts}`,
    `- 分组：同一原始捕获的全部变体进入同一组（校准/验证不拆散原图）。`,
    `- ${manifest.generation.note}`,
    '',
  ];
  for (const capture of manifest.captures) {
    lines.push(`## ${capture.id}（${capture.group} / ${capture.kind}）`);
    lines.push('');
    lines.push(
      `- 历史目标框：(${capture.historicalBbox.x}, ${capture.historicalBbox.y}, ${capture.historicalBbox.width}×${capture.historicalBbox.height})`,
    );
    if (capture.stateBox) {
      lines.push(
        `- 状态框：(${capture.stateBox.x}, ${capture.stateBox.y}, ${capture.stateBox.width}×${capture.stateBox.height})`,
      );
    }
    lines.push('');
    lines.push('| 用例 | 期望 | 位移 | 标注目标框 |');
    lines.push('| --- | --- | --- | --- |');
    for (const item of capture.cases) {
      lines.push(
        `| ${item.id} | ${item.expect}${item.rejectCode ? ` / ${item.rejectCode}` : ''} | (${item.shift.x}, ${item.shift.y}) | (${item.targetBbox.x}, ${item.targetBbox.y}, ${item.targetBbox.width}×${item.targetBbox.height}) |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export async function persistVisualMatcherFixtures(
  root: string = FIXTURE_ROOT,
  built?: { cases: FixtureCase[] },
): Promise<{ manifestPath: string; summaryPath: string; pngCount: number }> {
  const { cases } = built ?? (await buildVisualMatcherFixtures());
  const manifest = buildManifest(cases);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  let pngCount = 0;
  for (const item of cases) {
    const dir = path.join(root, 'png', item.captureId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${item.caseId}.png`), item.currentPng);
    pngCount += 1;
    if (item.caseId === 'original') {
      await fs.writeFile(path.join(dir, '_historical.png'), item.historicalPng);
      await fs.writeFile(path.join(dir, '_target.png'), item.targetPng);
      await fs.writeFile(path.join(dir, '_context.png'), item.contextPng);
      if (item.statePng) await fs.writeFile(path.join(dir, '_state.png'), item.statePng);
      pngCount += item.statePng ? 4 : 3;
    }
  }
  const manifestPath = path.join(root, 'manifest.json');
  const summaryPath = path.join(root, 'summary.md');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(summaryPath, renderSummaryMarkdown(manifest));
  return { manifestPath, summaryPath, pngCount };
}
