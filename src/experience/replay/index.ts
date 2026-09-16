/**
 * 视觉动作回放：在不调用 AI 定位的前提下逐步重放历史视觉动作链。
 * 每步新截图重新验证，无法确认页面、目标、结果或取消状态时明确停止。
 * 模块不决定选链/回退/学习，不渲染报告，不更新 Store。
 */
export { replayExperienceChain, createStoreImageLoader, replayTargetFromAgent } from './replay';
export { preflightReplayChain, type ReplayChainImages, type ReplayPreflightResult } from './validator';
export {
  REPLAY_ACTION_SUPPORT,
  REPLAY_INPUT_MODE_MAP,
  buildReplayDispatchParam,
  boxCenterPoint,
  replayLocate,
} from './native-actions';
export type { ReplayActionSupport, ReplayDispatchTarget, ReplayPixelLocate } from './native-actions';
export { REPLAY_NATIVE_ENTRY, REPLAY_LOCATE_BYPASS_FIELD } from './constants';
export type {
  ReplayActionTarget,
  ReplayChain,
  ReplayEffect,
  ReplayEvent,
  ReplayFailure,
  ReplayFailureKind,
  ReplayImageLoader,
  ReplayInput,
  ReplayPhase,
  ReplayResult,
  ReplayStatus,
} from './types';
