import { FROZEN_MATCHER_CONFIG } from '../../src/experience/matcher/config';
import { cropGray, decodePngFrame } from '../../src/experience/matcher/image-ops';
import { matchTarget } from '../../src/experience/matcher/match';
import { CONTEXT_PAD_RATIO } from '../../src/experience/promotion/constants';
import type { MatchTargetInput, VisualMatchResult } from '../../src/experience/matcher/types';
import {
  OPEN_SEMANTIC_ASSERTIONS,
  STATUS_BAR_MASK,
  SUPPORTED_SEMANTIC_TYPES,
} from './constants';
import { VISUAL_ASSERT_PROTOCOL } from './protocol';
import type {
  AssertDecision,
  EvaluateAssertionInput,
  LoadedEvidence,
  LoadedSample,
  MatcherSnapshot,
  SampleEvaluation,
} from './types';

function isSupportedType(
  type: EvaluateAssertionInput['semanticType'],
): type is (typeof SUPPORTED_SEMANTIC_TYPES)[number] {
  return (SUPPORTED_SEMANTIC_TYPES as readonly string[]).includes(type);
}

function isOpenSemanticAssertion(assertion: string): boolean {
  return (OPEN_SEMANTIC_ASSERTIONS as readonly string[]).includes(assertion.trim());
}

function snapshot(result: VisualMatchResult): MatcherSnapshot {
  if (result.decision === 'error') {
    return {
      decision: result.decision,
      code: result.code,
      reason: result.reason,
      timingMs: result.timingMs,
    };
  }
  return {
    decision: result.decision,
    code: result.decision === 'no-match' ? result.code : undefined,
    reason: result.reason,
    scores: result.scores,
    timingMs: result.timingMs,
  };
}

function toMatchInput(
  currentScreenshot: Uint8Array,
  currentEnvironment: EvaluateAssertionInput['currentEnvironment'],
  evidence: LoadedEvidence,
): MatchTargetInput {
  return {
    currentScreenshot,
    currentEnvironment,
    historical: {
      environment: evidence.environment,
      screenshot: evidence.screenshot,
      targetImage: evidence.targetImage,
      contextImage: evidence.contextImage,
      bbox: evidence.bbox,
      stateBefore: evidence.stateImage,
      stateBox: evidence.stateBox,
      textHint: evidence.textHint,
      contextPadRatio: CONTEXT_PAD_RATIO,
    },
    masks: [STATUS_BAR_MASK],
    config: FROZEN_MATCHER_CONFIG,
  };
}

function winningScores(
  polarity: 'positive' | 'negative' | undefined,
  positive?: MatcherSnapshot,
  negative?: MatcherSnapshot,
) {
  if (polarity === 'positive') return positive?.scores;
  if (polarity === 'negative') return negative?.scores;
  return positive?.scores ?? negative?.scores;
}

function mapObserved(
  claimedState: 'positive',
  observed: 'positive' | 'negative',
): AssertDecision {
  return observed === claimedState ? 'supported' : 'contradicted';
}

/**
 * 对单条已标注断言做离线判断。缺证据、歧义、开放语义、OCR 不可用均输出 unknown，
 * 不默认 true/false。不访问设备、不调用 VLM、不写动作 Store。
 */
export async function evaluateAssertion(
  input: EvaluateAssertionInput,
): Promise<Omit<SampleEvaluation, 'group' | 'humanLabel' | 'expectedDecision'>> {
  const start = performance.now();
  const sampleId = input.sampleId ?? 'anonymous';
  const claimedState = input.claimedState ?? 'positive';
  const ocrMode = input.ocrMode ?? 'disabled';

  const finish = (
    decision: SampleEvaluation['decision'],
    code: string,
    reason: string,
    extra?: Partial<SampleEvaluation>,
  ): Omit<SampleEvaluation, 'group' | 'humanLabel' | 'expectedDecision'> => ({
    sampleId,
    semanticType: input.semanticType,
    assertion: input.assertion,
    decision,
    reason,
    code,
    latencyMs: Math.max(0, performance.now() - start),
    matcher: extra?.matcher ?? {},
    scores: extra?.scores,
    ocr: extra?.ocr,
  });

  if (!isSupportedType(input.semanticType) || isOpenSemanticAssertion(input.assertion)) {
    return finish(
      'unknown',
      'unsupported-semantic',
      '开放语义或未支持断言类型：不使用图像相似度代替语义正确性',
    );
  }

  if (ocrMode === 'required' && input.semanticType === 'explicit-text') {
    const engine = input.ocrEngine;
    const ocrMeta = {
      mode: ocrMode,
      modelVersion: engine?.modelVersion,
      languagePackVersion: engine?.languagePackVersion,
    } as const;
    if (
      !engine ||
      engine.modelVersion.trim().length === 0 ||
      engine.languagePackVersion.trim().length === 0
    ) {
      return finish(
        'unknown',
        'ocr-unavailable',
        '文本评估需要固定版本的本地 OCR 引擎；当前环境不可用，不使用在线 VLM 补标签',
        { ocr: ocrMeta },
      );
    }
  }

  if (!input.positiveEvidence || !input.negativeEvidence) {
    return finish(
      'unknown',
      'insufficient-evidence',
      '缺少完整正反状态参考，缺证据不得默认 true/false',
    );
  }

  const positiveMatch = await matchTarget(
    toMatchInput(input.currentScreenshot, input.currentEnvironment, input.positiveEvidence),
  );
  const negativeMatch = await matchTarget(
    toMatchInput(input.currentScreenshot, input.currentEnvironment, input.negativeEvidence),
  );
  const matcher = {
    positive: snapshot(positiveMatch),
    negative: snapshot(negativeMatch),
  };

  if (positiveMatch.decision === 'error' || negativeMatch.decision === 'error') {
    const failed = positiveMatch.decision === 'error' ? positiveMatch : negativeMatch;
    if (failed.decision === 'error' && failed.code === 'ocr-unavailable') {
      return finish('unknown', 'ocr-unavailable', failed.reason, { matcher });
    }
    return finish(
      'error',
      failed.decision === 'error' ? failed.code : 'execution-error',
      failed.reason,
      { matcher },
    );
  }

  const positiveHit = positiveMatch.decision === 'match';
  const negativeHit = negativeMatch.decision === 'match';

  if (positiveHit && negativeHit) {
    return finish(
      'unknown',
      'ambiguous-evidence',
      '正反状态参考同时命中，无法可靠区分，输出 unknown',
      { matcher },
    );
  }
  if (!positiveHit && !negativeHit) {
    const envFail =
      matcher.positive?.code === 'environment-incompatible' ||
      matcher.negative?.code === 'environment-incompatible';
    return finish(
      'unknown',
      envFail ? 'environment-incompatible' : 'insufficient-evidence',
      envFail
        ? '环境不兼容，不能把缺失当成断言反对'
        : '未找到完整正或反状态证据，缺证据不得默认 true/false',
      { matcher },
    );
  }

  const observed = positiveHit ? 'positive' : 'negative';
  const decision = mapObserved(claimedState, observed);

  if (
    ocrMode === 'required' &&
    input.semanticType === 'explicit-text' &&
    input.ocrEngine &&
    decision === 'supported'
  ) {
    const hint = (input.expectedText ?? input.positiveEvidence.textHint ?? '').trim();
    const box = positiveMatch.decision === 'match' ? positiveMatch.targetBox : undefined;
    if (!box || hint.length === 0) {
      return finish(
        'unknown',
        'ocr-unavailable',
        'OCR 已要求但缺少可识别区域或文本提示，不能默认通过',
        {
          matcher,
          ocr: {
            mode: ocrMode,
            modelVersion: input.ocrEngine.modelVersion,
            languagePackVersion: input.ocrEngine.languagePackVersion,
          },
        },
      );
    }
    const frame = await decodePngFrame(input.currentScreenshot, 'OCR 当前截图', {
      maxBytes: FROZEN_MATCHER_CONFIG.maxImageBytes,
      maxPixels: FROZEN_MATCHER_CONFIG.maxImagePixels,
    });
    const gray = cropGray(frame.gray, frame.width, frame.height, box);
    const recognized = await input.ocrEngine.recognize({
      gray,
      width: box.width,
      height: box.height,
    });
    const normalizedHint = hint.replace(/\s+/g, '').toLowerCase();
    const normalizedText = recognized.text.replace(/\s+/g, '').toLowerCase();
    if (!normalizedText.includes(normalizedHint)) {
      return finish(
        'unknown',
        'ocr-mismatch',
        '本地 OCR 未确认明确文本，保守输出 unknown，不改为 contradicted',
        {
          matcher,
          ocr: {
            mode: ocrMode,
            modelVersion: input.ocrEngine.modelVersion,
            languagePackVersion: input.ocrEngine.languagePackVersion,
            text: recognized.text,
          },
        },
      );
    }
    return finish(decision, `observed-${observed}`, `本地模板与 OCR（${input.ocrEngine.modelVersion}）均支持该断言`, {
      matcher,
      scores: winningScores(observed, matcher.positive, matcher.negative),
      ocr: {
        mode: ocrMode,
        modelVersion: input.ocrEngine.modelVersion,
        languagePackVersion: input.ocrEngine.languagePackVersion,
        text: recognized.text,
      },
    });
  }

  const reason =
    decision === 'supported'
      ? '当前画面与声称状态的完整参考一致'
      : '当前画面与相反状态的完整参考一致，断言被反对';
  return finish(decision, `observed-${observed}`, reason, {
    matcher,
    scores: winningScores(observed, matcher.positive, matcher.negative),
    ocr: { mode: ocrMode },
  });
}

export async function evaluateSample(sample: LoadedSample): Promise<SampleEvaluation> {
  const result = await evaluateAssertion({
    sampleId: sample.record.id,
    semanticType: sample.record.semanticType,
    assertion: sample.record.assertion,
    claimedState: sample.record.claimedState,
    currentScreenshot: sample.currentPng,
    currentEnvironment: sample.record.environment,
    positiveEvidence: sample.positiveEvidence,
    negativeEvidence: sample.negativeEvidence,
    expectedText: sample.positiveEvidence?.textHint,
    ocrMode: VISUAL_ASSERT_PROTOCOL.ocr.enabled ? 'required' : 'disabled',
  });
  return {
    ...result,
    group: sample.record.group,
    humanLabel: sample.record.humanLabel,
    expectedDecision: sample.record.expectedDecision,
  };
}
