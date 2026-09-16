import type { CandidateChain, ExperienceStore, VariantSnapshot } from '../store/experience-store';
import type { ExperienceEnvironment } from '../schema/environment';
import type { PromoteInput, PromoteResult } from '../promotion/promoter';
import type {
  ReplayActionTarget,
  ReplayImageLoader,
  ReplayInput,
  ReplayResult,
} from '../replay/types';
import type { ScreenMatchResult } from '../matcher/types';

/** 使用方登记的可重复执行纯动作目标；默认策略集合为空。 */
export interface RepeatableActionTarget {
  readonly prompt: string;
  /** 须与请求 context 精确相等的已登记纯标量上下文；缺省视为空对象。 */
  readonly context?: Readonly<Record<string, string | number | boolean | null>>;
  /** 已确认部分动作完成后，是否允许从当前画面把完整目标交给原生 AI。 */
  readonly repeatableFromCurrentState: boolean;
}

export interface ExperienceActionPolicy {
  readonly version: string;
  readonly targets: readonly RepeatableActionTarget[];
}

export interface RuntimeIdentity {
  readonly runId?: string;
  readonly caseId?: string;
  readonly casePath: string;
  readonly caseName: string;
  readonly stepPath: string;
  readonly attempt?: number;
  readonly projectName?: string;
}

export interface RuntimeRequest {
  readonly prompt: unknown;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly node?: string;
}

export type NativeResultCategory = 'undefined' | string;

export interface NativeActResult {
  readonly category: NativeResultCategory;
  readonly dump: unknown;
  readonly value?: unknown;
}

export interface NativeActExecuteInput {
  readonly prompt: string;
  readonly signal?: AbortSignal;
  readonly deadlineAtMs?: number;
  readonly callId: string;
}

export type NativeActExecute = (input: NativeActExecuteInput) => Promise<NativeActResult>;

export type ModelCountStatus = 'verified' | 'unknown';

/**
 * 本步骤模型调用计数。status=unknown 时各计数字段为 null，
 * 不能写成 0 来“证明”零调用。
 */
export interface ModelCallCounts {
  readonly status: ModelCountStatus;
  readonly locateVlm: number | null;
  readonly otherModel: number | null;
  readonly assertModel: number | null;
  readonly source: string;
  readonly reason: string;
}

export type RuntimeEventType =
  | 'LOOKUP'
  | 'HIT'
  | 'MISS'
  | 'REPLAY'
  | 'FALLBACK'
  | 'PROMOTE';

export interface RuntimeEvent {
  readonly type: RuntimeEventType;
  readonly at: string;
  readonly callId: string;
  readonly runId?: string;
  readonly caseId?: string;
  readonly caseName: string;
  readonly stepPath: string;
  readonly attempt?: number;
  readonly status?: string;
  readonly reason: string;
  readonly revision?: number;
  readonly variantId?: string;
  readonly durationMs?: number;
  readonly counts?: ModelCallCounts;
}

export type RuntimeOutcome = 'replay' | 'native' | 'failed' | 'cancelled';

export interface SelectedCandidate {
  readonly requestKey: string;
  readonly variantId: string;
  readonly revision: number;
  readonly status: 'candidate' | 'active';
  readonly learnedAt: string;
}

export interface ExperienceRuntimeResult {
  readonly outcome: RuntimeOutcome;
  readonly nativeCalled: boolean;
  readonly callId: string;
  readonly events: readonly RuntimeEvent[];
  readonly modelCalls: ModelCallCounts;
  readonly selected?: SelectedCandidate;
  readonly replay?: ReplayResult;
  readonly promote?: PromoteResult;
  readonly snapshot?: VariantSnapshot;
  readonly value?: unknown;
  readonly reason: string;
}

export type LookupDecision =
  | { readonly kind: 'hit'; readonly selected: CandidateChain; readonly found: number }
  | {
      readonly kind: 'miss';
      readonly reason:
        | 'empty'
        | 'no-validated'
        | 'ambiguous'
        | 'store-unavailable'
        | 'invalid-asset'
        | 'ineligible'
        | 'environment-unavailable';
      readonly found: number;
      readonly detail: string;
    };

export type MatchScreenFn = (input: {
  readonly currentScreenshot: Uint8Array;
  readonly currentEnvironment: ExperienceEnvironment;
  readonly historicalScreenshot: Uint8Array;
  readonly historicalEnvironment: ExperienceEnvironment;
}) => Promise<ScreenMatchResult>;

export interface ModelCallObserver {
  begin(callId: string): void;
  /**
   * 结束本步骤观测。未覆盖到调用路径时必须返回 status=unknown，
   * 不得把缺失记录表述为零调用。
   */
  end(callId: string): ModelCallCounts;
}

export interface RuntimeReporter {
  record(result: ExperienceRuntimeResult): Promise<void>;
}

export interface ExperienceRuntimeDeps {
  readonly store: ExperienceStore;
  readonly nativeExecute: NativeActExecute;
  readonly captureScreenshot: () => Promise<Uint8Array>;
  readonly replayTarget: ReplayActionTarget;
  readonly environment?: ExperienceEnvironment;
  readonly policy?: ExperienceActionPolicy;
  readonly loadImage?: ReplayImageLoader;
  readonly matchScreen?: MatchScreenFn;
  readonly replayChain?: (input: ReplayInput) => Promise<ReplayResult>;
  readonly promote?: (input: PromoteInput) => Promise<PromoteResult>;
  readonly reporter?: RuntimeReporter;
  readonly modelObserver?: ModelCallObserver;
  readonly getDump?: () => unknown;
  readonly now?: () => number;
  readonly replayOptions?: {
    readonly waitPollIntervalMs?: number;
    readonly maxAfterWaitMs?: number;
  };
}

export interface ExperienceRuntimeInput {
  readonly request: RuntimeRequest;
  readonly identity: RuntimeIdentity;
  readonly signal?: AbortSignal;
  readonly deadlineAtMs?: number;
  readonly callId?: string;
}

export type ExperienceRunErrorKind =
  | 'cancelled'
  | 'timeout'
  | 'unknown-effect'
  | 'native'
  | 'device'
  | 'budget';
