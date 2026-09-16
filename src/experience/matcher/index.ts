/**
 * 本地视觉匹配：用当前截图验证历史页面、目标与上下文，输出当前框或保守拒绝。
 * 不调用 VLM、不发送设备动作、不更新 Store。
 */
export { FROZEN_MATCHER_CONFIG, resolveMatcherConfig } from './config';
export {
  MATCHER_CONFIG_VERSION,
  MATCHER_DATA_VERSION,
  MATCHER_IMAGE_PIPELINE_VERSION,
} from './constants';
export { matchScreen, matchTarget } from './match';
export type {
  CandidateDiagnostic,
  LocalOcrEngine,
  MatchScreenInput,
  MatchTargetInput,
  MatcherConfig,
  ScreenMatchResult,
  ScoreBreakdown,
  VisualMatchResult,
} from './types';
