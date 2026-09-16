/**
 * 视觉断言离线评估实验入口。
 * 复用本地 Matcher / Promotion 图像管线，不注册生产 Node，不修改 aiAssert，不写动作 Store。
 */
export { FIXTURE_ROOT, OUTPUT_ROOT, REPRO_COMMAND, EVAL_CONFIG_VERSION, DATA_VERSION } from './constants';
export { VISUAL_ASSERT_PROTOCOL } from './protocol';
export { evaluateAssertion, evaluateSample } from './evaluator';
export { runEvaluation, persistFrozenExperiment, renderReportMarkdown, stripTiming } from './report';
export { loadDataset, countDataset, parseDatasetFile, assertNoCrossGroupVariants } from './dataset';
export { buildVisualAssertFixtures, persistVisualAssertFixtures } from './build-fixtures';
export { computeTypeMetrics, computeAllTypeMetrics, decideGoNoGo } from './metrics';
export { VisualAssertDataError } from './errors';
export type {
  SampleEvaluation,
  ExperimentSummary,
  EvaluateAssertionInput,
  LoadedSample,
} from './types';
