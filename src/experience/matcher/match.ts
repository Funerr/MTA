import type { BoundingBox } from '../schema/action';
import { expandBox } from '../promotion/image';
import {
  MATCHER_CONFIG_VERSION,
  MATCHER_DATA_VERSION,
  MATCHER_IMAGE_PIPELINE_VERSION,
  NCC_ALGORITHM,
  NCC_VERSION,
  PHASH_ALGORITHM,
  PHASH_VERSION,
  SSIM_ALGORITHM,
  SSIM_VERSION,
} from './constants';
import { resolveMatcherConfig } from './config';
import { decideMatch, skippedItem } from './confidence';
import { isBoxInside } from './geometry';
import { cropGray, decodePngFrame, type GrayFrame } from './image-ops';
import { assertMasksDoNotCoverTargets, environmentPassed, scoreScreen } from './screen';
import { hitsFromPeaks, searchTargetPeaks } from './target';
import { evaluateTextEvidence } from './text';
import {
  MatcherInputError,
  type MatchScreenInput,
  type MatchTargetInput,
  type MatcherConfig,
  type ScreenMatchResult,
  type ScoreBreakdown,
  type VisualMatchError,
  type VisualMatchResult,
} from './types';

function algorithmStamp() {
  return {
    pipeline: MATCHER_IMAGE_PIPELINE_VERSION,
    phash: `${PHASH_ALGORITHM}@${PHASH_VERSION}`,
    ncc: `${NCC_ALGORITHM}@${NCC_VERSION}`,
    ssim: `${SSIM_ALGORITHM}@${SSIM_VERSION}`,
  };
}

function timedStart(): number {
  return performance.now();
}

function elapsed(start: number): number {
  return Math.max(0, performance.now() - start);
}

function emptyScores(): ScoreBreakdown {
  const zero = { value: 0, threshold: 1, passed: false };
  return {
    environment: zero,
    screen: zero,
    target: zero,
    context: zero,
    state: skippedItem(),
    text: skippedItem(),
    top1Top2Gap: { value: 1, threshold: 0, passed: true, skipped: true },
  };
}

function toError(start: number, error: unknown, configVersion: string): VisualMatchError {
  if (error instanceof MatcherInputError) {
    return {
      decision: 'error',
      code: error.code,
      reason: error.message,
      timingMs: elapsed(start),
      configVersion,
      dataVersion: MATCHER_DATA_VERSION,
      algorithm: algorithmStamp(),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    decision: 'error',
    code: 'invalid-image',
    reason: message,
    timingMs: elapsed(start),
    configVersion,
    dataVersion: MATCHER_DATA_VERSION,
    algorithm: algorithmStamp(),
  };
}

function assertResolution(
  frame: GrayFrame,
  width: number,
  height: number,
  label: string,
): void {
  if (frame.width !== width || frame.height !== height) {
    throw new MatcherInputError(
      'invalid-image',
      `${label} 尺寸 ${frame.width}x${frame.height} 与环境分辨率 ${width}x${height} 不一致`,
    );
  }
}

function assertSameOrientationSize(
  current: GrayFrame,
  historical: GrayFrame,
): void {
  if (current.width !== historical.width || current.height !== historical.height) {
    throw new MatcherInputError(
      'invalid-image',
      `当前截图 ${current.width}x${current.height} 与历史截图 ${historical.width}x${historical.height} 尺寸不同；首期不支持缩放/旋转匹配`,
    );
  }
}

async function decodePair(
  currentPng: Uint8Array,
  historicalPng: Uint8Array,
  config: MatcherConfig,
): Promise<{ current: GrayFrame; historical: GrayFrame }> {
  const limits = { maxBytes: config.maxImageBytes, maxPixels: config.maxImagePixels };
  const current = await decodePngFrame(currentPng, '当前截图', limits);
  const historical = await decodePngFrame(historicalPng, '历史截图', limits);
  return { current, historical };
}

/**
 * 仅做环境与页面筛选。不搜索目标、不输出可执行坐标。
 */
export async function matchScreen(input: MatchScreenInput): Promise<ScreenMatchResult> {
  const start = timedStart();
  let configVersion = MATCHER_CONFIG_VERSION;
  try {
    const config = resolveMatcherConfig(input.config);
    configVersion = config.version;
    const { current, historical } = await decodePair(
      input.currentScreenshot,
      input.historicalScreenshot,
      config,
    );
    assertResolution(
      current,
      input.currentEnvironment.resolution.width,
      input.currentEnvironment.resolution.height,
      '当前截图',
    );
    assertResolution(
      historical,
      input.historicalEnvironment.resolution.width,
      input.historicalEnvironment.resolution.height,
      '历史截图',
    );
    assertSameOrientationSize(current, historical);
    const environment = environmentPassed(input.currentEnvironment, input.historicalEnvironment);
    const screen = scoreScreen(current, historical, input.masks ?? [], config);
    const base = {
      timingMs: elapsed(start),
      configVersion,
      dataVersion: MATCHER_DATA_VERSION,
      algorithm: algorithmStamp(),
      scores: { environment, screen },
    };
    if (!environment.passed) {
      return {
        ...base,
        decision: 'no-match',
        code: 'environment-incompatible',
        reason: '环境不兼容（分辨率/方向/型号/语言/主题等必需字段不一致）',
      };
    }
    if (!screen.passed) {
      return {
        ...base,
        decision: 'no-match',
        code: 'page-mismatch',
        reason: '页面筛选失败：当前画面与历史页不兼容',
      };
    }
    return { ...base, decision: 'match', reason: '环境与页面筛选通过' };
  } catch (error) {
    return toError(start, error, configVersion);
  }
}

/**
 * 完整目标匹配：环境 → 页面 → 有限模板搜索 → 上下文/状态/可选文本。
 * 命中时输出当前截图中的目标框，绝不直接返回历史坐标。
 */
export async function matchTarget(input: MatchTargetInput): Promise<VisualMatchResult> {
  const start = timedStart();
  let configVersion = MATCHER_CONFIG_VERSION;
  try {
    const config = resolveMatcherConfig(input.config);
    configVersion = config.version;
    if (config.ocrEnabled && !input.ocrEngine) {
      throw new MatcherInputError(
        'ocr-unavailable',
        'OCR 已开启但未提供本地引擎；v1 默认关闭 OCR，不内置模型',
      );
    }
    const limits = { maxBytes: config.maxImageBytes, maxPixels: config.maxImagePixels };
    const current = await decodePngFrame(input.currentScreenshot, '当前截图', limits);
    const historical = await decodePngFrame(input.historical.screenshot, '历史截图', limits);
    const target = await decodePngFrame(input.historical.targetImage, '目标模板', limits);
    const context = await decodePngFrame(input.historical.contextImage, '上下文图', limits);
    const state = input.historical.stateBefore
      ? await decodePngFrame(input.historical.stateBefore, '局部状态图', limits)
      : undefined;

    assertResolution(
      current,
      input.currentEnvironment.resolution.width,
      input.currentEnvironment.resolution.height,
      '当前截图',
    );
    assertResolution(
      historical,
      input.historical.environment.resolution.width,
      input.historical.environment.resolution.height,
      '历史截图',
    );
    assertSameOrientationSize(current, historical);

    const bbox = input.historical.bbox;
    if (!isBoxInside(bbox, historical.width, historical.height)) {
      throw new MatcherInputError(
        'invalid-config',
        `历史 bbox (${bbox.x},${bbox.y},${bbox.width}x${bbox.height}) 越出历史截图`,
      );
    }
    if (target.width !== bbox.width || target.height !== bbox.height) {
      throw new MatcherInputError(
        'invalid-image',
        `目标图 ${target.width}x${target.height} 与 bbox ${bbox.width}x${bbox.height} 不一致`,
      );
    }

    const padRatio = input.historical.contextPadRatio ?? config.contextPadRatio;
    const expectedContext = expandBox(bbox, historical, padRatio);
    if (context.width !== expectedContext.width || context.height !== expectedContext.height) {
      throw new MatcherInputError(
        'invalid-image',
        `上下文图 ${context.width}x${context.height} 与扩边框 ${expectedContext.width}x${expectedContext.height} 不一致`,
      );
    }

    const stateBox = input.historical.stateBox;
    if (state) {
      if (stateBox) {
        if (!isBoxInside(stateBox, historical.width, historical.height)) {
          throw new MatcherInputError('invalid-config', 'stateBox 越出历史截图');
        }
        if (state.width !== stateBox.width || state.height !== stateBox.height) {
          throw new MatcherInputError('invalid-image', '局部状态图尺寸与 stateBox 不一致');
        }
      } else if (state.width !== bbox.width || state.height !== bbox.height) {
        throw new MatcherInputError(
          'invalid-config',
          '提供了局部状态图但缺少 stateBox，且尺寸与目标 bbox 不同',
        );
      }
    }

    const masks = input.masks ?? [];
    const protectedBoxes: BoundingBox[] = [bbox, expectedContext];
    if (stateBox) protectedBoxes.push(stateBox);
    try {
      assertMasksDoNotCoverTargets(masks, protectedBoxes);
    } catch (error) {
      if (error instanceof MatcherInputError && error.code === 'invalid-config') {
        return {
          decision: 'no-match',
          code: 'mask-covers-target',
          reason: error.message,
          scores: emptyScores(),
          candidates: [],
          timingMs: elapsed(start),
          configVersion,
          dataVersion: MATCHER_DATA_VERSION,
          algorithm: algorithmStamp(),
        };
      }
      throw error;
    }

    const environment = environmentPassed(
      input.currentEnvironment,
      input.historical.environment,
    );
    const screen = scoreScreen(current, historical, masks, config);

    if (!environment.passed || !screen.passed) {
      const decided = decideMatch({
        config,
        environment,
        screen,
        hits: [],
        textByIndex: [],
      });
      return {
        decision: 'no-match',
        code: decided.code ?? 'page-mismatch',
        reason: decided.reason,
        scores: decided.scores,
        candidates: [],
        timingMs: elapsed(start),
        configVersion,
        dataVersion: MATCHER_DATA_VERSION,
        algorithm: algorithmStamp(),
      };
    }

    const { peaks } = searchTargetPeaks(current, target, bbox, config);
    const hits = hitsFromPeaks(
      peaks,
      { width: target.width, height: target.height },
      current,
      context,
      state,
      bbox,
      stateBox,
      padRatio,
      masks,
    );

    const textByIndex = await Promise.all(
      hits.map(async (hit) => {
        const patch = cropGray(current.gray, current.width, current.height, hit.bbox);
        return evaluateTextEvidence({
          enabled: config.ocrEnabled,
          engine: input.ocrEngine,
          textHint: input.historical.textHint,
          gray: patch,
          width: hit.bbox.width,
          height: hit.bbox.height,
        });
      }),
    );

    const decided = decideMatch({
      config,
      environment,
      screen,
      hits,
      textByIndex,
    });
    const base = {
      timingMs: elapsed(start),
      configVersion,
      dataVersion: MATCHER_DATA_VERSION,
      algorithm: algorithmStamp(),
      scores: decided.scores,
      candidates: decided.candidates,
    };
    if (decided.decision === 'match' && decided.targetBox) {
      return {
        ...base,
        decision: 'match',
        reason: decided.reason,
        targetBox: decided.targetBox,
      };
    }
    return {
      ...base,
      decision: 'no-match',
      code: decided.code ?? 'target-missing',
      reason: decided.reason,
    };
  } catch (error) {
    return toError(start, error, configVersion);
  }
}
