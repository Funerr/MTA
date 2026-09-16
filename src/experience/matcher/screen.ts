import { isSameEnvironment, type ExperienceEnvironment } from '../schema/environment';
import type { BoundingBox } from '../schema/action';
import { boxesOverlap } from './geometry';
import {
  applyMasks,
  hamming64,
  perceptualHash,
  type GrayFrame,
} from './image-ops';
import type { MatcherConfig, ScoreItem } from './types';
import { MatcherInputError } from './types';

export function environmentPassed(
  current: ExperienceEnvironment,
  historical: ExperienceEnvironment,
): ScoreItem {
  const same = isSameEnvironment(current, historical);
  return { value: same ? 1 : 0, threshold: 1, passed: same };
}

export function assertMasksDoNotCoverTargets(
  masks: readonly BoundingBox[],
  boxes: readonly BoundingBox[],
): void {
  for (const mask of masks) {
    for (const box of boxes) {
      if (boxesOverlap(mask, box)) {
        throw new MatcherInputError(
          'invalid-config',
          `固定掩码 (${mask.x},${mask.y},${mask.width}x${mask.height}) 掩盖了目标或上下文/状态区域 (${box.x},${box.y},${box.width}x${box.height})`,
        );
      }
    }
  }
}

export function scoreScreen(
  current: GrayFrame,
  historical: GrayFrame,
  masks: readonly BoundingBox[],
  config: MatcherConfig,
): ScoreItem & { hamming: number } {
  const currentMasked = applyMasks(current.gray, current.width, current.height, masks);
  const historicalMasked = applyMasks(
    historical.gray,
    historical.width,
    historical.height,
    masks,
  );
  const hamming = hamming64(
    perceptualHash(currentMasked, current.width, current.height),
    perceptualHash(historicalMasked, historical.width, historical.height),
  );
  const value = 1 - hamming / 64;
  return {
    hamming,
    value,
    threshold: 1 - config.screenPHashMaxHamming / 64,
    passed: hamming <= config.screenPHashMaxHamming,
  };
}
