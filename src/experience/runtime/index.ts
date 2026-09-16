/**
 * Experience Runtime：把 Lookup、Validator/Replay、原生 AI 与 Promotion
 * 组成单次尝试闭环。使用方注入资格策略（默认空表）；未登记或含判断的
 * 请求直接走原生，不猜测业务幂等性。
 */
export { ACTION_POLICY_VERSION, DEFAULT_EXPERIENCE_STORE_ROOT, EMPTY_ACTION_POLICY } from './constants';
export {
  deriveEligibleRequestKey,
  evaluateActionEligibility,
  normalizeActionPolicy,
  requestKeySourceOf,
} from './eligibility';
export { lookupExperienceCandidate } from './lookup';
export {
  capturePngFromDataUrl,
  classifyDumpModelCalls,
  createDumpModelObserver,
  createRecordToReportReporter,
  unknownModelCounts,
  verifiedZeroModelCounts,
} from './observe';
export { identityFromNodeExecution } from './identity';
export { ExperienceRunError, ExperienceRuntime } from './runtime';
export {
  captureScreenshotFromAgent,
  nativeExecuteFromAgent,
  observerFromAgent,
  reporterFromAgent,
  replayTargetFromExperienceAgent,
  type ExperienceActAgent,
} from './adapters';
export type {
  ActionEligibility,
} from './eligibility';
export type {
  ExperienceActionPolicy,
  ExperienceRuntimeDeps,
  ExperienceRuntimeInput,
  ExperienceRuntimeResult,
  ExperienceRunErrorKind,
  LookupDecision,
  ModelCallCounts,
  ModelCallObserver,
  NativeActExecute,
  NativeActResult,
  RepeatableActionTarget,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeIdentity,
  RuntimeOutcome,
  RuntimeReporter,
  RuntimeRequest,
  SelectedCandidate,
} from './types';
