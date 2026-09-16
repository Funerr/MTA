import type { AssetRef, ScreenEvidence } from '../schema/assets';
import type { BoundingBox, ExperienceAction, ExperienceActionType } from '../schema/action';
import type { ExperienceEnvironment } from '../schema/environment';

/** 整链结局：success 全链确认；rejected 首动作前拒绝；failed 执行中断言失败；cancelled 取消/超时。 */
export type ReplayStatus = 'success' | 'rejected' | 'failed' | 'cancelled';

/** 停止时所处的阶段；success 时为 done。 */
export type ReplayPhase =
  | 'preflight'
  | 'before-verify'
  | 'dispatch'
  | 'after-verify'
  | 'terminal-check'
  | 'done';

/**
 * 副作用分类：none 未派发任何动作；confirmed-partial 至少一个动作已确认完成
 * （含全部完成）；unknown 某次派发后无法判断动作是否生效。unknown 一旦成立
 * 不再回退，供 Runtime 禁止盲目接续。
 */
export type ReplayEffect = 'none' | 'confirmed-partial' | 'unknown';

export type ReplayFailureKind =
  | 'cancelled'
  | 'timeout'
  | 'action-unsupported'
  | 'invalid-chain'
  | 'asset-unavailable'
  | 'version-incompatible'
  | 'environment-incompatible'
  | 'no-match'
  | 'matcher-error'
  | 'device-error'
  | 'screenshot-error';

/** 失败明细：message 面向调用方，raw 保留原始异常文本供原生报告。 */
export interface ReplayFailure {
  readonly kind: ReplayFailureKind;
  readonly message: string;
  readonly raw?: string;
}

/**
 * 回放输入链：与 Store 查询出的 CandidateChain 同构（也接受等价的
 * Variant 当前修订）。模块只消费本结构，不读取 Store、不更新资产状态。
 */
export interface ReplayChain {
  readonly environment: ExperienceEnvironment;
  readonly entryEvidence: ScreenEvidence;
  readonly terminalEvidence: ScreenEvidence;
  readonly actions: readonly ExperienceAction[];
}

/**
 * 回放动作目标的最小结构面：取新截图 + 原生动作派发入口。
 * 真实 Midscene Agent 通过 replayTargetFromAgent 适配；测试注入受控替身。
 * 派发只允许已定位像素的直接调用，禁止 aiTap 等可能触发定位模型的方法。
 */
export interface ReplayActionTarget {
  screenshotBase64(): Promise<string>;
  callActionInActionSpace(type: string, param?: unknown): Promise<unknown>;
}

/** 资产引用 → PNG 字节。调用方可用 ExperienceStore.readAssetImage 适配。 */
export type ReplayImageLoader = (ref: AssetRef) => Promise<Uint8Array>;

export interface ReplayInput {
  readonly chain: ReplayChain;
  /** 当前执行环境；与链环境指纹不一致时整链拒绝。 */
  readonly environment: ExperienceEnvironment;
  readonly target: ReplayActionTarget;
  readonly loadImage: ReplayImageLoader;
  /** 原生取消信号；动作前、等待中与动作返回后均会检查。 */
  readonly signal?: AbortSignal;
  /** 绝对截止时间（epoch 毫秒）。等待上界取剩余时间，不重置每步预算。 */
  readonly deadlineAtMs?: number;
  /** 传给 matcher 的固定动态区掩码（如状态栏）。 */
  readonly masks?: readonly BoundingBox[];
  /** 缺省使用冻结配置 visual-matcher@1；传入非法配置整链拒绝。 */
  readonly matcherConfig?: unknown;
  /** 动作后等待的轮询间隔；默认 100ms。 */
  readonly waitPollIntervalMs?: number;
  /** 单次动作后等待的绝对上界；默认 5000ms，且始终再被剩余时间收紧。 */
  readonly maxAfterWaitMs?: number;
  /** 逐步事件回调；模块只产出事件，不渲染报告、不写 Store。回调异常直接向上抛出。 */
  readonly onEvent?: (event: ReplayEvent) => void;
}

export interface ReplayResult {
  readonly status: ReplayStatus;
  readonly effect: ReplayEffect;
  /** 后置证据校验通过的动作数；success 时等于 totalActions。 */
  readonly completedActions: number;
  /** 已向设备派发（含返回异常）的动作次数。 */
  readonly dispatchedActions: number;
  readonly totalActions: number;
  /** 失败/取消时所在动作下标；preflight 整链问题或终态检查失败为 null。 */
  readonly failedActionIndex: number | null;
  readonly phase: ReplayPhase;
  readonly reason: string;
  readonly failure?: ReplayFailure;
  /** 停止前最后一张成功取得的截图；连首张截图都失败时缺省。 */
  readonly lastScreenshot?: Uint8Array;
}

export type ReplayEvent =
  | { readonly type: 'replay-started'; readonly totalActions: number }
  | {
      readonly type: 'step-started';
      readonly index: number;
      readonly actionType: ExperienceActionType;
    }
  | {
      readonly type: 'screenshot';
      readonly index: number;
      readonly phase: 'before' | 'after' | 'terminal';
      readonly png: Uint8Array;
    }
  | {
      readonly type: 'verification';
      readonly index: number;
      readonly phase: 'before' | 'after' | 'terminal';
      readonly decision: 'match' | 'no-match' | 'error';
      readonly code?: string;
      readonly reason: string;
      /** 仅 before 目标验证命中时给出当前帧目标框。 */
      readonly targetBox?: BoundingBox;
    }
  | {
      readonly type: 'dispatch';
      readonly index: number;
      readonly nativeType: string;
      readonly param: unknown;
    }
  | {
      readonly type: 'dispatch-return';
      readonly index: number;
      readonly nativeType: string;
    }
  | { readonly type: 'step-completed'; readonly index: number }
  | { readonly type: 'replay-finished'; readonly result: ReplayResult };
