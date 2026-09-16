import type { BoundingBox } from '../../src/experience/schema/action';
import type { ExperienceEnvironment } from '../../src/experience/schema/environment';
import type { LocalOcrEngine, ScoreBreakdown, VisualMatchResult } from '../../src/experience/matcher/types';

export type SemanticType = 'binary-control' | 'explicit-text' | 'open-semantic';
export type SplitGroup = 'calibration' | 'validation';
export type HumanLabel = true | false | 'unknown';
export type AssertDecision = 'supported' | 'contradicted' | 'unknown';
export type EvaluationDecision = AssertDecision | 'error';
export type ClaimedState = 'positive';
export type OcrMode = 'disabled' | 'required';

export interface EvidencePaths {
  readonly screenshot: string;
  readonly target: string;
  readonly context: string;
  readonly state?: string;
  readonly bbox: BoundingBox;
  readonly stateBox?: BoundingBox;
}

export interface SampleRecord {
  readonly id: string;
  readonly captureId: string;
  readonly sourceImageId: string;
  readonly group: SplitGroup;
  readonly semanticType: SemanticType;
  readonly assertion: string;
  readonly claimedState: ClaimedState;
  readonly humanLabel: HumanLabel;
  readonly expectedDecision: AssertDecision;
  readonly environment: ExperienceEnvironment;
  readonly currentImage: string;
  readonly variant: string;
  readonly shift: { readonly x: number; readonly y: number };
  readonly annotation: {
    readonly annotator: string;
    readonly basis: string;
    readonly modelJudgement: null;
    readonly source: string;
  };
  readonly evidence?: {
    readonly positive: EvidencePaths;
    readonly negative: EvidencePaths;
  };
}

export interface LoadedEvidence {
  readonly screenshot: Uint8Array;
  readonly targetImage: Uint8Array;
  readonly contextImage: Uint8Array;
  readonly stateImage?: Uint8Array;
  readonly bbox: BoundingBox;
  readonly stateBox?: BoundingBox;
  readonly environment: ExperienceEnvironment;
  readonly textHint?: string;
}

export interface LoadedSample {
  readonly record: SampleRecord;
  readonly currentPng: Uint8Array;
  readonly positiveEvidence?: LoadedEvidence;
  readonly negativeEvidence?: LoadedEvidence;
}

export interface EvaluateAssertionInput {
  readonly sampleId?: string;
  readonly semanticType: SemanticType;
  readonly assertion: string;
  readonly claimedState?: ClaimedState;
  readonly currentScreenshot: Uint8Array;
  readonly currentEnvironment: ExperienceEnvironment;
  readonly positiveEvidence?: LoadedEvidence;
  readonly negativeEvidence?: LoadedEvidence;
  readonly expectedText?: string;
  readonly ocrMode?: OcrMode;
  readonly ocrEngine?: LocalOcrEngine;
}

export interface MatcherSnapshot {
  readonly decision: VisualMatchResult['decision'];
  readonly code?: string;
  readonly reason: string;
  readonly scores?: ScoreBreakdown;
  readonly timingMs: number;
}

export interface SampleEvaluation {
  readonly sampleId: string;
  readonly semanticType: SemanticType;
  readonly assertion: string;
  readonly group: SplitGroup;
  readonly humanLabel: HumanLabel;
  readonly expectedDecision: AssertDecision;
  readonly decision: EvaluationDecision;
  readonly reason: string;
  readonly code: string;
  readonly latencyMs: number;
  readonly scores?: ScoreBreakdown;
  readonly matcher: {
    readonly positive?: MatcherSnapshot;
    readonly negative?: MatcherSnapshot;
  };
  readonly ocr?: {
    readonly mode: OcrMode;
    readonly modelVersion?: string;
    readonly languagePackVersion?: string;
    readonly text?: string;
  };
}

export interface TypeMetrics {
  readonly semanticType: SemanticType | 'all';
  readonly sampleCount: number;
  readonly humanTrue: number;
  readonly humanFalse: number;
  readonly humanUnknown: number;
  readonly supported: number;
  readonly contradicted: number;
  readonly unknown: number;
  readonly errors: number;
  readonly falsePass: number;
  readonly falseReject: number;
  readonly falsePassRate: number | null;
  readonly falseRejectRate: number | null;
  readonly unknownRate: number;
  readonly coverage: number | null;
  readonly totalLatencyMs: number;
}

export interface GoNoGoVerdict {
  readonly conclusion: 'go' | 'no-go';
  readonly reasons: readonly string[];
  readonly checks: {
    readonly noDataOrExecutionErrors: boolean;
    readonly falsePassIsZero: boolean;
    readonly coverageMeetsThreshold: boolean;
    readonly unsupportedAreUnknown: boolean;
    readonly unknownLabelsStayUnknown: boolean;
  };
}

export interface ExperimentSummary {
  readonly evalConfigVersion: string;
  readonly dataVersion: string;
  readonly protocolVersion: string;
  readonly matcherConfigVersion: string;
  readonly split: SplitGroup | 'all';
  readonly sampleCount: number;
  readonly errorCount: number;
  readonly overall: TypeMetrics;
  readonly byType: readonly TypeMetrics[];
  readonly verdict: GoNoGoVerdict;
  readonly ocr: {
    readonly enabled: boolean;
    readonly bundledModel: boolean;
  };
}
