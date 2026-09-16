import type { SampleEvaluation, TypeMetrics } from './types';
import { VISUAL_ASSERT_PROTOCOL } from './protocol';
import type { GoNoGoVerdict } from './types';
import type { SemanticType } from './types';

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

interface MutableTypeMetrics {
  semanticType: TypeMetrics['semanticType'];
  sampleCount: number;
  humanTrue: number;
  humanFalse: number;
  humanUnknown: number;
  supported: number;
  contradicted: number;
  unknown: number;
  errors: number;
  falsePass: number;
  falseReject: number;
  falsePassRate: number | null;
  falseRejectRate: number | null;
  unknownRate: number;
  coverage: number | null;
  totalLatencyMs: number;
}

function emptyMetrics(semanticType: TypeMetrics['semanticType']): MutableTypeMetrics {
  return {
    semanticType,
    sampleCount: 0,
    humanTrue: 0,
    humanFalse: 0,
    humanUnknown: 0,
    supported: 0,
    contradicted: 0,
    unknown: 0,
    errors: 0,
    falsePass: 0,
    falseReject: 0,
    falsePassRate: null,
    falseRejectRate: null,
    unknownRate: 0,
    coverage: null,
    totalLatencyMs: 0,
  };
}

function accumulate(metrics: MutableTypeMetrics, sample: SampleEvaluation): void {
  metrics.sampleCount += 1;
  metrics.totalLatencyMs += sample.latencyMs;
  if (sample.humanLabel === true) metrics.humanTrue += 1;
  else if (sample.humanLabel === false) metrics.humanFalse += 1;
  else metrics.humanUnknown += 1;

  if (sample.decision === 'supported') metrics.supported += 1;
  else if (sample.decision === 'contradicted') metrics.contradicted += 1;
  else if (sample.decision === 'unknown') metrics.unknown += 1;
  else metrics.errors += 1;

  if (sample.humanLabel === false && sample.decision === 'supported') {
    metrics.falsePass += 1;
  }
  if (sample.humanLabel === true && sample.decision === 'contradicted') {
    metrics.falseReject += 1;
  }
}

function finalize(metrics: MutableTypeMetrics): TypeMetrics {
  return {
    ...metrics,
    falsePassRate: ratio(metrics.falsePass, metrics.humanFalse),
    falseRejectRate: ratio(metrics.falseReject, metrics.humanTrue),
    unknownRate: metrics.sampleCount === 0 ? 0 : metrics.unknown / metrics.sampleCount,
    coverage:
      metrics.semanticType === 'open-semantic'
        ? null
        : ratio(metrics.supported + metrics.contradicted, metrics.sampleCount),
  };
}

export function computeTypeMetrics(
  samples: readonly SampleEvaluation[],
  semanticType: TypeMetrics['semanticType'] = 'all',
): TypeMetrics {
  const metrics = emptyMetrics(semanticType);
  for (const sample of samples) {
    if (semanticType !== 'all' && sample.semanticType !== semanticType) continue;
    accumulate(metrics, sample);
  }
  return finalize(metrics);
}

export function computeAllTypeMetrics(
  samples: readonly SampleEvaluation[],
): readonly TypeMetrics[] {
  const types: SemanticType[] = ['binary-control', 'explicit-text', 'open-semantic'];
  return types.map((type) => computeTypeMetrics(samples, type));
}

export function decideGoNoGo(samples: readonly SampleEvaluation[]): GoNoGoVerdict {
  const protocol = VISUAL_ASSERT_PROTOCOL;
  const reasons: string[] = [];
  const overall = computeTypeMetrics(samples);
  const byType = computeAllTypeMetrics(samples);

  const noDataOrExecutionErrors = overall.errors === 0;
  if (!noDataOrExecutionErrors) {
    reasons.push(`存在 ${overall.errors} 条数据或执行错误，本次不得判为有效通过`);
  }

  const falsePassIsZero = overall.falsePass <= protocol.go.falsePassMax;
  if (!falsePassIsZero) {
    reasons.push(`误通过 ${overall.falsePass} 例（门槛 ${protocol.go.falsePassMax}）`);
  }

  const supportedTypeMetrics = byType.filter(
    (item) => item.semanticType === 'binary-control' || item.semanticType === 'explicit-text',
  );
  const coverageMeetsThreshold = supportedTypeMetrics.every((item) => {
    if (item.sampleCount === 0) return false;
    return (item.coverage ?? 0) >= protocol.go.minCoverageBySupportedType;
  });
  if (!coverageMeetsThreshold) {
    const detail = supportedTypeMetrics
      .map((item) => `${item.semanticType}=${item.coverage ?? 'n/a'}`)
      .join('，');
    reasons.push(
      `支持类型覆盖率未全部达到 ${protocol.go.minCoverageBySupportedType}（${detail}）`,
    );
  }

  const unsupported = samples.filter((sample) => sample.semanticType === 'open-semantic');
  const unsupportedAreUnknown =
    unsupported.length > 0 && unsupported.every((sample) => sample.decision === 'unknown');
  if (unsupported.length === 0) {
    reasons.push('验证集未包含开放语义样本，无法检查 unsupported → unknown 规则');
  } else if (!unsupportedAreUnknown) {
    reasons.push('开放语义或未支持请求未全部输出 unknown');
  }

  const unknownLabeled = samples.filter((sample) => sample.humanLabel === 'unknown');
  const unknownLabelsStayUnknown = unknownLabeled.every((sample) => sample.decision === 'unknown');
  if (!unknownLabelsStayUnknown) {
    reasons.push('人工标签为 unknown 的样本被输出为 supported/contradicted/error');
  }

  const passed =
    noDataOrExecutionErrors &&
    falsePassIsZero &&
    coverageMeetsThreshold &&
    unsupportedAreUnknown &&
    unknownLabelsStayUnknown;

  if (passed) {
    reasons.push('冻结集满足预设 go 条件；仅建议另开生产化 Change，不替代原生 aiAssert');
  }

  return {
    conclusion: passed ? 'go' : 'no-go',
    reasons,
    checks: {
      noDataOrExecutionErrors,
      falsePassIsZero,
      coverageMeetsThreshold,
      unsupportedAreUnknown,
      unknownLabelsStayUnknown,
    },
  };
}
