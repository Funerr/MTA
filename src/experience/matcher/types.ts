import type { BoundingBox } from '../schema/action';
import type { ExperienceEnvironment } from '../schema/environment';

export type MatchDecision = 'match' | 'no-match' | 'error';

export type NoMatchCode =
  | 'environment-incompatible'
  | 'page-mismatch'
  | 'target-missing'
  | 'context-mismatch'
  | 'state-mismatch'
  | 'text-mismatch'
  | 'ambiguous'
  | 'mask-covers-target';

export type MatcherErrorCode =
  | 'invalid-image'
  | 'invalid-config'
  | 'resource-limit'
  | 'ocr-unavailable';

export interface ScoreItem {
  readonly value: number;
  readonly threshold: number;
  readonly passed: boolean;
  readonly skipped?: boolean;
}

export interface ScoreBreakdown {
  readonly environment: ScoreItem;
  readonly screen: ScoreItem;
  readonly target: ScoreItem;
  readonly context: ScoreItem;
  readonly state: ScoreItem;
  readonly text: ScoreItem;
  readonly top1Top2Gap: ScoreItem;
}

export interface CandidateDiagnostic {
  readonly bbox: BoundingBox;
  readonly targetScore: number;
  readonly contextScore: number;
  readonly stateScore: number;
  readonly passed: boolean;
}

export interface VisualMatchBase {
  readonly timingMs: number;
  readonly configVersion: string;
  readonly dataVersion: string;
  readonly algorithm: {
    readonly pipeline: string;
    readonly phash: string;
    readonly ncc: string;
    readonly ssim: string;
  };
}

export interface VisualMatchHit extends VisualMatchBase {
  readonly decision: 'match';
  readonly reason: string;
  readonly targetBox: BoundingBox;
  readonly scores: ScoreBreakdown;
  readonly candidates: readonly CandidateDiagnostic[];
}

export interface VisualNoMatch extends VisualMatchBase {
  readonly decision: 'no-match';
  readonly code: NoMatchCode;
  readonly reason: string;
  readonly scores: ScoreBreakdown;
  readonly candidates: readonly CandidateDiagnostic[];
}

export interface VisualMatchError extends VisualMatchBase {
  readonly decision: 'error';
  readonly code: MatcherErrorCode;
  readonly reason: string;
}

export type VisualMatchResult = VisualMatchHit | VisualNoMatch | VisualMatchError;

export interface ScreenMatchHit extends VisualMatchBase {
  readonly decision: 'match';
  readonly reason: string;
  readonly scores: Pick<ScoreBreakdown, 'environment' | 'screen'>;
}

export interface ScreenNoMatch extends VisualMatchBase {
  readonly decision: 'no-match';
  readonly code: Extract<NoMatchCode, 'environment-incompatible' | 'page-mismatch'>;
  readonly reason: string;
  readonly scores: Pick<ScoreBreakdown, 'environment' | 'screen'>;
}

export type ScreenMatchResult = ScreenMatchHit | ScreenNoMatch | VisualMatchError;

export interface LocalOcrEngine {
  readonly modelVersion: string;
  readonly languagePackVersion: string;
  recognize(input: {
    readonly gray: Uint8Array;
    readonly width: number;
    readonly height: number;
  }): Promise<{ readonly text: string }>;
}

export interface MatcherConfig {
  readonly version: string;
  readonly searchRadiusRatio: number;
  readonly screenPHashMaxHamming: number;
  readonly targetNccMin: number;
  readonly contextSsimMin: number;
  readonly stateSsimMin: number;
  readonly ambiguityGapMin: number;
  readonly nmsRadiusPx: number;
  readonly maxImagePixels: number;
  readonly maxImageBytes: number;
  readonly maxSearchPositions: number;
  readonly maxCandidates: number;
  readonly maxTemplatePixels: number;
  readonly ocrEnabled: boolean;
  readonly contextPadRatio: number;
}

export interface MatchScreenInput {
  readonly currentScreenshot: Uint8Array;
  readonly currentEnvironment: ExperienceEnvironment;
  readonly historicalScreenshot: Uint8Array;
  readonly historicalEnvironment: ExperienceEnvironment;
  readonly masks?: readonly BoundingBox[];
  readonly config?: unknown;
}

export interface MatchTargetInput {
  readonly currentScreenshot: Uint8Array;
  readonly currentEnvironment: ExperienceEnvironment;
  readonly historical: {
    readonly environment: ExperienceEnvironment;
    readonly screenshot: Uint8Array;
    readonly targetImage: Uint8Array;
    readonly contextImage: Uint8Array;
    readonly bbox: BoundingBox;
    readonly stateBefore?: Uint8Array;
    readonly stateBox?: BoundingBox;
    readonly textHint?: string;
    readonly contextPadRatio?: number;
  };
  readonly masks?: readonly BoundingBox[];
  readonly config?: unknown;
  readonly ocrEngine?: LocalOcrEngine;
}

export class MatcherInputError extends Error {
  readonly code: MatcherErrorCode;

  constructor(code: MatcherErrorCode, message: string) {
    super(message);
    this.name = 'MatcherInputError';
    this.code = code;
  }
}
