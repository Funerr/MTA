import { z } from 'zod/v4';
import {
  MATCHER_CONFIG_VERSION,
  MAX_CANDIDATES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_SEARCH_POSITIONS,
  MAX_TEMPLATE_PIXELS,
  NMS_RADIUS_PX,
  SEARCH_RADIUS_RATIO,
  DEFAULT_CONTEXT_PAD_RATIO,
} from './constants';
import { MatcherInputError, type MatcherConfig } from './types';

/**
 * 校准集一次确定后冻结的阈值。
 * 来源：tests/fixtures/visual-matcher/calibration-lock.json（任务 3.1）。
 * 正例最小 NCC/SSIM 均远高于下列下限；负例页面 Hamming 远大于上限。
 */
export const FROZEN_MATCHER_CONFIG: MatcherConfig = {
  version: MATCHER_CONFIG_VERSION,
  searchRadiusRatio: SEARCH_RADIUS_RATIO,
  screenPHashMaxHamming: 16,
  targetNccMin: 0.92,
  contextSsimMin: 0.8,
  stateSsimMin: 0.88,
  ambiguityGapMin: 0.05,
  nmsRadiusPx: NMS_RADIUS_PX,
  maxImagePixels: MAX_IMAGE_PIXELS,
  maxImageBytes: MAX_IMAGE_BYTES,
  maxSearchPositions: MAX_SEARCH_POSITIONS,
  maxCandidates: MAX_CANDIDATES,
  maxTemplatePixels: MAX_TEMPLATE_PIXELS,
  ocrEnabled: false,
  contextPadRatio: DEFAULT_CONTEXT_PAD_RATIO,
};

const matcherConfigSchema = z.strictObject({
  version: z.string().min(1),
  searchRadiusRatio: z.number().positive().max(0.2),
  screenPHashMaxHamming: z.number().int().min(0).max(64),
  targetNccMin: z.number().min(0).max(1),
  contextSsimMin: z.number().min(0).max(1),
  stateSsimMin: z.number().min(0).max(1),
  ambiguityGapMin: z.number().min(0).max(1),
  nmsRadiusPx: z.number().int().min(0).max(32),
  maxImagePixels: z.number().int().positive(),
  maxImageBytes: z.number().int().positive(),
  maxSearchPositions: z.number().int().positive(),
  maxCandidates: z.number().int().positive(),
  maxTemplatePixels: z.number().int().positive(),
  ocrEnabled: z.boolean(),
  contextPadRatio: z.number().min(0).max(1),
});

export function resolveMatcherConfig(raw?: unknown): MatcherConfig {
  if (raw === undefined) return FROZEN_MATCHER_CONFIG;
  const parsed = matcherConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const path = issue.path.map(String).join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join('；');
    throw new MatcherInputError('invalid-config', `匹配配置非法：${detail}`);
  }
  return parsed.data;
}
