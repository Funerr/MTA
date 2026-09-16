import sharp from 'sharp';
import type {
  BoundingBox,
  ExperienceAction,
  ExperienceActionType,
} from '../../src/experience/schema/action';
import type { ExperienceEnvironment } from '../../src/experience/schema/environment';
import type { AssetRef, ScreenEvidence } from '../../src/experience/schema/assets';
import {
  defaultImagePipeline,
  expandBox,
  imageEvidenceFromPng,
  screenEvidenceFromPng,
} from '../../src/experience/promotion/image';
import { CONTEXT_PAD_RATIO } from '../../src/experience/promotion/constants';
import type { ReplayActionTarget, ReplayChain } from '../../src/experience/replay/types';
import { pngDataUrl } from './promotion-png';

export interface ReplayTheme {
  readonly content: { r: number; g: number; b: number };
  readonly header: { r: number; g: number; b: number };
  readonly accent: { r: number; g: number; b: number };
}

export const REPLAY_THEME_A: ReplayTheme = {
  content: { r: 244, g: 246, b: 250 },
  header: { r: 28, g: 84, b: 176 },
  accent: { r: 22, g: 62, b: 140 },
};

export const REPLAY_THEME_B: ReplayTheme = {
  content: { r: 40, g: 44, b: 52 },
  header: { r: 226, g: 118, b: 24 },
  accent: { r: 250, g: 180, b: 70 },
};

/** 第三页面主题：暗底亮页头，与 A/B 的灰度分布差异足够大（pHash 实测 >16）。 */
export const REPLAY_THEME_C: ReplayTheme = {
  content: { r: 26, g: 30, b: 38 },
  header: { r: 238, g: 240, b: 244 },
  accent: { r: 120, g: 200, b: 90 },
};

/** 在目标内部绘制确定性字形，保证模板可被唯一识别。 */
async function glyphPng(
  width: number,
  height: number,
  seed: number,
): Promise<Buffer> {
  const inner = Math.max(4, width - 4);
  const innerHeight = Math.max(4, height - 4);
  const cells = 4;
  const cellW = Math.max(1, Math.floor(inner / cells));
  const cellH = Math.max(1, Math.floor(innerHeight / cells));
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  let state = seed >>> 0;
  for (let gy = 0; gy < cells; gy += 1) {
    for (let gx = 0; gx < cells; gx += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      if ((state & 3) === 0) continue;
      composites.push({
        input: await sharp({
          create: {
            width: cellW,
            height: cellH,
            channels: 3,
            background: {
              r: 18 + (state & 31),
              g: 30 + ((state >>> 5) & 31),
              b: 200 + ((state >>> 9) & 55),
            },
          },
        })
          .png()
          .toBuffer(),
        left: gx * cellW,
        top: gy * cellH,
      });
    }
  }
  return sharp({
    create: {
      width: inner,
      height: innerHeight,
      channels: 3,
      background: { r: 250, g: 250, b: 255 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * 绘制回放场景帧：内容底 + 页头 + 两个结构块 + 目标面板 + 目标字形。
 * 同一 spec 的帧逐字节一致；不同 spec 在颜色与结构上均有差异。
 */
export async function paintReplayFrame(options: {
  readonly width: number;
  readonly height: number;
  readonly theme: ReplayTheme;
  readonly targetBox: BoundingBox;
  readonly seed: number;
  /** true 时使用镜像布局，生成"另一页"。 */
  readonly altLayout?: boolean;
}): Promise<Uint8Array> {
  const { width, height, theme, targetBox, seed, altLayout = false } = options;
  const headerHeight = Math.max(10, Math.round(height * 0.1));
  const blockW = Math.round(width * 0.22);
  const blocks: Array<{ left: number; top: number; width: number; height: number }> = [
    { left: 0, top: 0, width, height: headerHeight },
    altLayout
      ? { left: width - blockW - 8, top: headerHeight + 10, width: blockW, height: 20 }
      : { left: 8, top: headerHeight + 10, width: blockW, height: 20 },
    altLayout
      ? { left: 8, top: height - 56, width: blockW, height: 40 }
      : { left: width - blockW - 8, top: height - 56, width: blockW, height: 40 },
  ];
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  for (const block of blocks) {
    composites.push({
      input: await sharp({
        create: {
          width: block.width,
          height: block.height,
          channels: 3,
          background: theme.header,
        },
      })
        .png()
        .toBuffer(),
      left: block.left,
      top: block.top,
    });
  }
  composites.push({
    input: await sharp({
      create: {
        width: targetBox.width,
        height: targetBox.height,
        channels: 3,
        background: theme.accent,
      },
    })
      .png()
      .toBuffer(),
    left: targetBox.x,
    top: targetBox.y,
  });
  composites.push({
    input: await glyphPng(targetBox.width, targetBox.height, seed),
    left: targetBox.x,
    top: targetBox.y,
  });
  const png = await sharp({
    create: { width, height, channels: 3, background: theme.content },
  })
    .composite(composites)
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

export interface ReplayChainActionSpec {
  readonly type: ExperienceActionType;
  readonly beforeFrame: number;
  readonly afterFrame: number;
  /** 有目标动作必填：目标在 before 帧中的框。 */
  readonly targetBox?: BoundingBox;
  readonly textHint?: string;
  readonly input?: { readonly text: string; readonly mode: 'append' | 'replace' };
  readonly scroll?: {
    readonly direction: 'up' | 'down' | 'left' | 'right';
    readonly distancePx: number;
    readonly anchor?: { readonly x: number; readonly y: number };
  };
  readonly longPress?: { readonly durationMs: number };
}

export interface ReplayChainFixture {
  /** 绘制好的全部帧；测试把它交给受控截图替身。 */
  readonly frames: Uint8Array[];
  readonly chain: ReplayChain;
  readonly imageBytes: ReadonlyMap<string, Uint8Array>;
  /** 按内容摘要取图的加载器；缺失摘要时抛错（供缺图用例复用）。 */
  readonly loadImage: (ref: AssetRef) => Promise<Uint8Array>;
}

/**
 * 构建合法回放链：页面帧 → 证据（含内容签名与摘要）→ 动作（含按
 * CONTEXT_PAD_RATIO 裁剪的目标/上下文图）。入口证据带 padRatio 参数，
 * 与 Promotion 发布的 candidate 结构一致。
 */
export async function buildReplayChainFixture(options: {
  readonly width: number;
  readonly height: number;
  readonly environment: ExperienceEnvironment;
  readonly pages: ReadonlyArray<{
    readonly theme: ReplayTheme;
    readonly targetBox: BoundingBox;
    readonly seed: number;
    readonly altLayout?: boolean;
  }>;
  readonly entryFrame: number;
  readonly terminalFrame: number;
  readonly actions: readonly ReplayChainActionSpec[];
}): Promise<ReplayChainFixture> {
  const { width, height, environment } = options;
  const frames: Uint8Array[] = [];
  for (const page of options.pages) {
    frames.push(
      await paintReplayFrame({
        width,
        height,
        theme: page.theme,
        targetBox: page.targetBox,
        seed: page.seed,
        altLayout: page.altLayout,
      }),
    );
  }

  const imageBytes = new Map<string, Uint8Array>();
  const evidenceCache = new Map<number, ScreenEvidence>();
  const evidenceOf = async (frameIndex: number): Promise<ScreenEvidence> => {
    const cached = evidenceCache.get(frameIndex);
    if (cached) return cached;
    const png = frames[frameIndex]!;
    const built = await screenEvidenceFromPng(png, defaultImagePipeline);
    imageBytes.set(built.evidence.screenshot.asset.digest, built.png);
    evidenceCache.set(frameIndex, built.evidence);
    return built.evidence;
  };

  const actions: ExperienceAction[] = [];
  for (const spec of options.actions) {
    const before = await evidenceOf(spec.beforeFrame);
    const after = await evidenceOf(spec.afterFrame);
    if (spec.type === 'Back' || spec.type === 'Home') {
      actions.push({ type: spec.type, before, after });
      continue;
    }
    if (!spec.targetBox) {
      throw new Error(`${spec.type}: 测试规格缺少 targetBox`);
    }
    const beforePng = frames[spec.beforeFrame]!;
    const targetPng = await defaultImagePipeline.crop(beforePng, spec.targetBox);
    const contextBox = expandBox(spec.targetBox, { width, height }, CONTEXT_PAD_RATIO);
    const contextPng = await defaultImagePipeline.crop(beforePng, contextBox);
    const target = {
      image: imageEvidenceFromPng(targetPng, spec.targetBox.width, spec.targetBox.height),
      contextImage: imageEvidenceFromPng(contextPng, contextBox.width, contextBox.height),
      bbox: { ...spec.targetBox },
      ...(spec.textHint ? { textHint: spec.textHint } : {}),
    };
    imageBytes.set(target.image.asset.digest, targetPng);
    imageBytes.set(target.contextImage.asset.digest, contextPng);
    if (spec.type === 'Tap') {
      actions.push({ type: 'Tap', before, after, target });
    } else if (spec.type === 'Input') {
      if (!spec.input) throw new Error('Input: 测试规格缺少 input 参数');
      actions.push({ type: 'Input', before, after, target, params: { ...spec.input } });
    } else if (spec.type === 'Scroll') {
      if (!spec.scroll) throw new Error('Scroll: 测试规格缺少 scroll 参数');
      const center = {
        x: spec.targetBox.x + Math.floor(spec.targetBox.width / 2),
        y: spec.targetBox.y + Math.floor(spec.targetBox.height / 2),
      };
      actions.push({
        type: 'Scroll',
        before,
        after,
        target,
        params: {
          direction: spec.scroll.direction,
          distancePx: spec.scroll.distancePx,
          anchor: spec.scroll.anchor ?? center,
        },
      });
    } else {
      if (!spec.longPress) throw new Error('LongPress: 测试规格缺少 longPress 参数');
      actions.push({
        type: 'LongPress',
        before,
        after,
        target,
        params: { durationMs: spec.longPress.durationMs },
      });
    }
  }

  const entryBuilt = await screenEvidenceFromPng(frames[options.entryFrame]!, defaultImagePipeline, {
    role: 'entry',
    padRatio: CONTEXT_PAD_RATIO,
  });
  const terminalBuilt = await screenEvidenceFromPng(
    frames[options.terminalFrame]!,
    defaultImagePipeline,
    { role: 'terminal' },
  );
  imageBytes.set(entryBuilt.evidence.screenshot.asset.digest, entryBuilt.png);
  imageBytes.set(terminalBuilt.evidence.screenshot.asset.digest, terminalBuilt.png);

  return {
    frames,
    chain: {
      environment,
      entryEvidence: entryBuilt.evidence,
      terminalEvidence: terminalBuilt.evidence,
      actions,
    },
    imageBytes,
    loadImage: async (ref) => {
      const png = imageBytes.get(ref.digest);
      if (!png) throw new Error(`夹具中不存在摘要为 ${ref.digest.slice(0, 12)}… 的图片`);
      return png;
    },
  };
}

/**
 * 受控截图替身：按"截图序号"取帧，精确对齐回放状态机的取证顺序；
 * 派发记录保留 captureIndex，用于证明坐标来自对应当前帧。
 */
export class ScriptedReplayTarget implements ReplayActionTarget {
  readonly dispatches: Array<{
    readonly nativeType: string;
    readonly param: unknown;
    readonly captureIndex: number;
  }> = [];
  captureCount = 0;

  constructor(
    private readonly frameForCapture: (captureIndex: number) => Uint8Array | undefined,
    private readonly onDispatch?: (nativeType: string, callCount: number) => void | Promise<void>,
  ) {}

  async screenshotBase64(): Promise<string> {
    const png = this.frameForCapture(this.captureCount);
    if (!png) {
      throw new Error(`无截图可用（capture ${this.captureCount}）`);
    }
    this.captureCount += 1;
    return pngDataUrl(png);
  }

  async callActionInActionSpace(type: string, param?: unknown): Promise<unknown> {
    this.dispatches.push({ nativeType: type, param, captureIndex: this.captureCount });
    await this.onDispatch?.(type, this.dispatches.length);
    return undefined;
  }
}

/** 帧序列超出后重复最后一帧，模拟"画面停在终态"。 */
export function frameTable(frames: readonly Uint8Array[]) {
  return (captureIndex: number): Uint8Array | undefined =>
    captureIndex < frames.length ? frames[captureIndex]! : frames[frames.length - 1];
}

/** 恒定单帧，模拟"画面从未变化"。 */
export function staticFrame(frame: Uint8Array) {
  return (_captureIndex: number): Uint8Array => frame;
}

/** bbox 中心点（与派发 center 推导一致）。 */
export function boxCenterOf(box: BoundingBox) {
  return { x: box.x + Math.floor(box.width / 2), y: box.y + Math.floor(box.height / 2) };
}
