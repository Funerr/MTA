import type { BoundingBox, ExperienceAction, ExperienceActionType } from '../schema/action';

/**
 * 经验动作 → 原生直接调用入口对应表（任务 1.1）。
 *
 * 核对证据：Promotion 支持矩阵（docs/experience-promotion.md §2）、锁定
 * 1.12.7 的 `@midscene/core` 设备 action space 定义，以及
 * tests/integration/experience-replay-native.test.ts 的最小调用验证：
 * locate 携带 locatedPixelResult 时派发参数无损、定位模型调用为零。
 * 无法证明"直接执行不触发 VLM"的入口不进入本表。
 */
export interface ReplayActionSupport {
  /** @midscene/core Action Space 子类型。 */
  readonly nativeType: string;
  readonly requiresTarget: boolean;
}

export const REPLAY_ACTION_SUPPORT: Readonly<
  Record<ExperienceActionType, ReplayActionSupport>
> = {
  Tap: { nativeType: 'Tap', requiresTarget: true },
  Input: { nativeType: 'Input', requiresTarget: true },
  Scroll: { nativeType: 'Scroll', requiresTarget: true },
  LongPress: { nativeType: 'LongPress', requiresTarget: true },
  Back: { nativeType: 'AndroidBackButton', requiresTarget: false },
  Home: { nativeType: 'AndroidHomeButton', requiresTarget: false },
};

/** 经验 Input 写入模式 → 原生 mode（与 Promotion 的 typeOnly↔append 映射互逆）。 */
export const REPLAY_INPUT_MODE_MAP = {
  replace: 'replace',
  append: 'typeOnly',
} as const;

/** 与 1.12.7 locate.rect/center 结构逐字对齐的预置定位结果。 */
export interface ReplayPixelLocate {
  readonly prompt: string;
  readonly locatedPixelResult: {
    readonly center: [number, number];
    readonly rect: {
      readonly left: number;
      readonly top: number;
      readonly width: number;
      readonly height: number;
    };
  };
}

/** bbox 中心点；与 Promotion 记录的 center 推导一致。 */
export function boxCenterPoint(box: BoundingBox): { x: number; y: number } {
  return {
    x: box.x + Math.floor(box.width / 2),
    y: box.y + Math.floor(box.height / 2),
  };
}

function rectOf(box: BoundingBox) {
  return { left: box.x, top: box.y, width: box.width, height: box.height };
}

/** 用当前帧目标框构造已定位 locate：像素坐标原样进入 center/rect，不经模型。 */
export function replayLocate(prompt: string, box: BoundingBox): ReplayPixelLocate {
  const center = boxCenterPoint(box);
  return {
    prompt,
    locatedPixelResult: {
      center: [center.x, center.y],
      rect: rectOf(box),
    },
  };
}

/** 派发目标的当前定位：box 为当前帧匹配框，center 为实际作用点。 */
export interface ReplayDispatchTarget {
  readonly box: BoundingBox;
  /** Tap/Input/LongPress 为当前框中心；Scroll 为投影后的滚动锚点。 */
  readonly center: { readonly x: number; readonly y: number };
}

/**
 * 构造原生派发参数：与 Promotion 采集到的参数一一对应，不增删字段。
 * locate.prompt 优先历史 textHint，缺省回退动作类型名（仅用于报告展示，
 * 不参与定位）。Back/Home 为无目标系统导航，无 locate 参数。
 */
export function buildReplayDispatchParam(
  action: ExperienceAction,
  target: ReplayDispatchTarget | null,
): Record<string, unknown> {
  if (!('target' in action)) {
    return {};
  }
  if (!target) {
    throw new Error(`${action.type}: 有目标动作缺少当前帧定位`);
  }
  const prompt = action.target.textHint ?? action.type;
  switch (action.type) {
    case 'Tap':
      return { locate: replayLocate(prompt, target.box) };
    case 'Input':
      return {
        locate: replayLocate(prompt, target.box),
        value: action.params.text,
        mode: REPLAY_INPUT_MODE_MAP[action.params.mode],
      };
    case 'Scroll':
      return {
        locate: {
          prompt,
          locatedPixelResult: {
            center: [target.center.x, target.center.y],
            rect: rectOf(target.box),
          },
        },
        scrollType: 'singleAction',
        direction: action.params.direction,
        distance: action.params.distancePx,
      };
    case 'LongPress':
      return {
        locate: replayLocate(prompt, target.box),
        duration: action.params.durationMs,
      };
  }
  return {};
}
