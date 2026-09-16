import type { BoundingBox } from '../schema/action';
import { expandBox } from '../promotion/image';
import { boxesOverlap, searchOccupancy, translateBox } from './geometry';
import {
  cropGray,
  prepareTemplate,
  searchZnccPeaks,
  ssimGray,
  type GrayFrame,
  type ScorePeak,
} from './image-ops';
import { MatcherInputError, type MatcherConfig } from './types';

export interface TargetSearchHit {
  readonly bbox: BoundingBox;
  readonly targetScore: number;
  readonly contextScore: number;
  readonly stateScore: number;
  readonly stateSkipped: boolean;
}

export function searchRadiusPx(
  width: number,
  height: number,
  ratio: number,
): { rx: number; ry: number } {
  return {
    rx: Math.ceil(ratio * width),
    ry: Math.ceil(ratio * height),
  };
}

export function searchTargetPeaks(
  current: GrayFrame,
  template: GrayFrame,
  historicalBbox: BoundingBox,
  config: MatcherConfig,
): { peaks: ScorePeak[]; positionCount: number; minX: number; minY: number } {
  if (template.width * template.height > config.maxTemplatePixels) {
    throw new MatcherInputError(
      'resource-limit',
      `模板像素 ${template.width * template.height} 超过上界 ${config.maxTemplatePixels}`,
    );
  }
  const { rx, ry } = searchRadiusPx(current.width, current.height, config.searchRadiusRatio);
  const occupancy = searchOccupancy(historicalBbox, current, rx, ry);
  const minX = occupancy.x;
  const maxX = occupancy.x + occupancy.width - template.width;
  const minY = occupancy.y;
  const maxY = occupancy.y + occupancy.height - template.height;
  if (maxX < minX || maxY < minY) {
    throw new MatcherInputError(
      'resource-limit',
      `搜索区无法容纳模板：占用区 ${occupancy.width}x${occupancy.height}，模板 ${template.width}x${template.height}`,
    );
  }
  const positionCount = (maxX - minX + 1) * (maxY - minY + 1);
  if (positionCount > config.maxSearchPositions) {
    throw new MatcherInputError(
      'resource-limit',
      `搜索位置 ${positionCount} 超过上界 ${config.maxSearchPositions}`,
    );
  }
  const prepared = prepareTemplate(template.gray, template.width, template.height);
  const { peaks } = searchZnccPeaks(
    current.gray,
    current.width,
    current.height,
    prepared,
    minX,
    maxX,
    minY,
    maxY,
    config.targetNccMin,
    config.maxCandidates,
    config.nmsRadiusPx,
  );
  return { peaks, positionCount, minX, minY };
}

export function scoreContext(
  current: GrayFrame,
  contextTemplate: GrayFrame,
  found: BoundingBox,
  padRatio: number,
): number {
  const currentBox = expandBox(found, current, padRatio);
  if (currentBox.width !== contextTemplate.width || currentBox.height !== contextTemplate.height) {
    return 0;
  }
  const patch = cropGray(current.gray, current.width, current.height, currentBox);
  return ssimGray(patch, contextTemplate.gray);
}

export function scoreState(
  current: GrayFrame,
  stateTemplate: GrayFrame | undefined,
  historicalBbox: BoundingBox,
  historicalStateBox: BoundingBox | undefined,
  found: BoundingBox,
): { value: number; skipped: boolean } {
  if (!stateTemplate) return { value: 1, skipped: true };
  const referenceBox = historicalStateBox ?? historicalBbox;
  if (
    referenceBox.width !== stateTemplate.width ||
    referenceBox.height !== stateTemplate.height
  ) {
    return { value: 0, skipped: false };
  }
  const dx = found.x - historicalBbox.x;
  const dy = found.y - historicalBbox.y;
  const currentStateBox = translateBox(referenceBox, dx, dy);
  if (
    currentStateBox.x < 0 ||
    currentStateBox.y < 0 ||
    currentStateBox.x + currentStateBox.width > current.width ||
    currentStateBox.y + currentStateBox.height > current.height
  ) {
    return { value: 0, skipped: false };
  }
  const patch = cropGray(current.gray, current.width, current.height, currentStateBox);
  return { value: ssimGray(patch, stateTemplate.gray), skipped: false };
}

export function peakOverlapsMask(peak: BoundingBox, masks: readonly BoundingBox[]): boolean {
  return masks.some((mask) => boxesOverlap(peak, mask));
}

export function hitsFromPeaks(
  peaks: readonly ScorePeak[],
  templateSize: { width: number; height: number },
  current: GrayFrame,
  contextTemplate: GrayFrame,
  stateTemplate: GrayFrame | undefined,
  historicalBbox: BoundingBox,
  historicalStateBox: BoundingBox | undefined,
  padRatio: number,
  masks: readonly BoundingBox[],
): TargetSearchHit[] {
  const hits: TargetSearchHit[] = [];
  for (const peak of peaks) {
    const bbox: BoundingBox = {
      x: peak.x,
      y: peak.y,
      width: templateSize.width,
      height: templateSize.height,
    };
    if (peakOverlapsMask(bbox, masks)) continue;
    const contextScore = scoreContext(current, contextTemplate, bbox, padRatio);
    const state = scoreState(
      current,
      stateTemplate,
      historicalBbox,
      historicalStateBox,
      bbox,
    );
    hits.push({
      bbox,
      targetScore: peak.score,
      contextScore,
      stateScore: state.value,
      stateSkipped: state.skipped,
    });
  }
  return hits;
}
