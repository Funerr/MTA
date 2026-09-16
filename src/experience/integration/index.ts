/**
 * 项目 YAML aiAct 的可关闭透明接入：保留官方 schema / 结果 / 报告 / 取消，
 * 合格纯动作才复用 Experience Runtime，其余原样透传原生执行。
 */
export {
  EXPERIENCE_ENABLED_ENV,
  SUPPORTED_AI_ACT_CONTEXT_KEYS,
  SUPPORTED_AI_ACT_OPTION_KEYS,
  TRANSPARENT_AI_ACT_WRAP,
  TRANSPARENT_REPLAY_RESULT_CATEGORY,
} from './constants';
export {
  loadExperienceIntegrationConfig,
  parseExperienceEnabled,
} from './config';
export {
  evaluateTransparentAiActAccess,
  transparentRuntimeRequestOf,
} from './eligibility';
export { isTransparentAiActWrapped, wrapMidsceneNodesWithExperience } from './wrap';
export type {
  ExperienceIntegrationConfig,
  ExperienceIntegrationOptions,
  TransparentAiActAccess,
  TransparentAiActContext,
  TransparentBypassCode,
} from './types';
