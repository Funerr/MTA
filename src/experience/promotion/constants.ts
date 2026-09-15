/** 锁定的 Midscene 取数版本；与 package.json 中 @midscene/* 一致。 */
export const LOCKED_MIDSCENE_VERSION = '1.12.7';

/** 轨迹适配层版本；进入 Experience.source.adapterVersion 与执行兼容版本。 */
export const TRACE_ADAPTER_VERSION = 'trace-adapter@1';

/** 纯动作资格策略版本；参与请求 Key。 */
export const ELIGIBILITY_POLICY_VERSION = 'policy@1';

/** 图像解码/裁剪/重编码方案版本。 */
export const IMAGE_PIPELINE_VERSION = 'png-sharp@1';

/** 视觉内容签名（供 matcher 相似性使用），与资产 sha256 摘要职责不同。 */
export const IMAGE_SIGNATURE_ALGORITHM = 'mean-rgb-grid';
export const IMAGE_SIGNATURE_VERSION = '1';
export const IMAGE_SIGNATURE_GRID = 8;

/** context 裁剪相对目标 bbox 的单侧扩边比例，记录在上下文图签名参数中。 */
export const CONTEXT_PAD_RATIO = 0.25;

export function executionCompatVersion(
  midsceneVersion: string = LOCKED_MIDSCENE_VERSION,
  adapterVersion: string = TRACE_ADAPTER_VERSION,
): string {
  return `midscene@${midsceneVersion}+adapter@${adapterVersion}`;
}

/**
 * 原生 Action Space 子类型 → 经验动作类型。
 * Finished 不是设备动作；未列出的类型视为未支持，整链跳过。
 */
export const NATIVE_ACTION_TYPE_MAP = {
  Tap: 'Tap',
  Input: 'Input',
  Scroll: 'Scroll',
  LongPress: 'LongPress',
  AndroidBackButton: 'Back',
  AndroidHomeButton: 'Home',
} as const;

export type NativeActionSubType = keyof typeof NATIVE_ACTION_TYPE_MAP;

export const IGNORED_ACTION_SUBTYPES = new Set(['Finished']);

export const UNMODELED_INSIGHT_SUBTYPES = new Set([
  'Assert',
  'Query',
  'WaitFor',
  'Boolean',
  'Number',
  'String',
]);
