import type { BoundingBox } from '../schema/action';
import type { TargetSearchHit } from './target';
import type {
  CandidateDiagnostic,
  MatcherConfig,
  NoMatchCode,
  ScoreBreakdown,
  ScoreItem,
} from './types';

export interface ConfidenceDecision {
  readonly decision: 'match' | 'no-match';
  readonly code?: NoMatchCode;
  readonly reason: string;
  readonly targetBox?: BoundingBox;
  readonly scores: ScoreBreakdown;
  readonly candidates: readonly CandidateDiagnostic[];
}

function item(value: number, threshold: number, passed: boolean, skipped = false): ScoreItem {
  return skipped ? { value, threshold, passed, skipped } : { value, threshold, passed };
}

export function skippedItem(): ScoreItem {
  return { value: 1, threshold: 1, passed: true, skipped: true };
}

export function decideMatch(input: {
  readonly config: MatcherConfig;
  readonly environment: ScoreItem;
  readonly screen: ScoreItem;
  readonly hits: readonly TargetSearchHit[];
  readonly textByIndex: readonly ScoreItem[];
}): ConfidenceDecision {
  const diagnostics: CandidateDiagnostic[] = input.hits.map((hit, index) => {
    const text = input.textByIndex[index] ?? skippedItem();
    const passed =
      hit.targetScore >= input.config.targetNccMin &&
      hit.contextScore >= input.config.contextSsimMin &&
      (hit.stateSkipped || hit.stateScore >= input.config.stateSsimMin) &&
      text.passed;
    return {
      bbox: hit.bbox,
      targetScore: hit.targetScore,
      contextScore: hit.contextScore,
      stateScore: hit.stateScore,
      passed,
    };
  });

  const ranked = diagnostics
    .map((diagnostic, index) => ({ diagnostic, hit: input.hits[index], text: input.textByIndex[index] ?? skippedItem(), index }))
    .sort(
      (a, b) =>
        b.diagnostic.targetScore - a.diagnostic.targetScore ||
        a.diagnostic.bbox.y - b.diagnostic.bbox.y ||
        a.diagnostic.bbox.x - b.diagnostic.bbox.x,
    );
  const top1 = ranked[0];
  const top2 = ranked[1];
  const gap = top1 && top2 ? top1.diagnostic.targetScore - top2.diagnostic.targetScore : 1;
  const gapItem = item(gap, input.config.ambiguityGapMin, gap >= input.config.ambiguityGapMin);

  const bestHit = top1?.hit;
  const bestText = top1?.text ?? skippedItem();

  const scores: ScoreBreakdown = {
    environment: input.environment,
    screen: input.screen,
    target: item(
      top1?.diagnostic.targetScore ?? 0,
      input.config.targetNccMin,
      (top1?.diagnostic.targetScore ?? 0) >= input.config.targetNccMin,
    ),
    context: item(
      bestHit?.contextScore ?? 0,
      input.config.contextSsimMin,
      (bestHit?.contextScore ?? 0) >= input.config.contextSsimMin,
    ),
    state: item(
      bestHit?.stateScore ?? 1,
      input.config.stateSsimMin,
      bestHit ? bestHit.stateSkipped || bestHit.stateScore >= input.config.stateSsimMin : true,
      bestHit?.stateSkipped ?? true,
    ),
    text: bestText,
    top1Top2Gap: gapItem,
  };

  if (!input.environment.passed) {
    return {
      decision: 'no-match',
      code: 'environment-incompatible',
      reason: '环境不兼容（分辨率/方向/型号/语言/主题等必需字段不一致）',
      scores,
      candidates: diagnostics,
    };
  }
  if (!input.screen.passed) {
    return {
      decision: 'no-match',
      code: 'page-mismatch',
      reason: '页面筛选失败：当前画面与历史页不兼容',
      scores,
      candidates: diagnostics,
    };
  }

  const accepted = ranked.filter((entry) => entry.diagnostic.passed);
  if (accepted.length === 0) {
    const { code, reason } = rejectReason(scores, Boolean(top1));
    return { decision: 'no-match', code, reason, scores, candidates: diagnostics };
  }
  if (accepted.length >= 2 && accepted[0] && accepted[1]) {
    const acceptedGap = accepted[0].diagnostic.targetScore - accepted[1].diagnostic.targetScore;
    if (acceptedGap < input.config.ambiguityGapMin) {
      return {
        decision: 'no-match',
        code: 'ambiguous',
        reason: '多个相似候选无法可靠区分，拒绝输出可执行坐标',
        scores: {
          ...scores,
          top1Top2Gap: item(acceptedGap, input.config.ambiguityGapMin, false),
        },
        candidates: diagnostics,
      };
    }
  }

  const winner = accepted[0]?.diagnostic;
  if (!winner) {
    return {
      decision: 'no-match',
      code: 'target-missing',
      reason: '未找到通过全部硬条件的目标',
      scores,
      candidates: diagnostics,
    };
  }
  return {
    decision: 'match',
    reason: '环境、页面、目标、上下文均通过硬阈值',
    targetBox: winner.bbox,
    scores: {
      ...scores,
      target: item(winner.targetScore, input.config.targetNccMin, true),
    },
    candidates: diagnostics,
  };
}

function rejectReason(scores: ScoreBreakdown, hadPeak: boolean): {
  code: NoMatchCode;
  reason: string;
} {
  if (!hadPeak || !scores.target.passed) {
    return { code: 'target-missing', reason: '有限搜索范围内未找到足够相似的目标模板' };
  }
  if (!scores.context.passed) {
    return { code: 'context-mismatch', reason: '目标上下文不匹配' };
  }
  if (!scores.state.passed && !scores.state.skipped) {
    return { code: 'state-mismatch', reason: '目标操作前局部状态不匹配（例如开关已翻转）' };
  }
  if (!scores.text.passed && !scores.text.skipped) {
    return { code: 'text-mismatch', reason: '文本证据与历史 textHint 不符' };
  }
  return { code: 'target-missing', reason: '候选未通过全部硬条件' };
}
