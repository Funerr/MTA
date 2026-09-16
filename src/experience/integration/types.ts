import type { ExperienceActionPolicy, ExperienceRuntimeDeps } from '../runtime';
import type { ExperienceEnvironment } from '../schema/environment';
import type { RepeatableActionTarget } from '../runtime/types';
import type { ExperienceStore } from '../store/experience-store';

/** 项目级透明接入开关。默认关闭。 */
export interface ExperienceIntegrationConfig {
  readonly enabled: boolean;
}

/** wrap 调用方可覆盖开关、资格策略与 Store 根目录。 */
export interface ExperienceIntegrationOptions extends ExperienceIntegrationConfig {
  readonly policy?: ExperienceActionPolicy;
  readonly storeRoot?: string;
}

export type TransparentBypassCode =
  | 'rich-media-prompt'
  | 'unsupported-options'
  | 'unsupported-context'
  | 'unregistered-target'
  | 'embedded-assertion'
  | 'ineligible-request-key';

export type TransparentAiActAccess =
  | {
      readonly kind: 'replay-candidate';
      readonly prompt: string;
      readonly requestKey: string;
      readonly target: RepeatableActionTarget;
    }
  | {
      readonly kind: 'bypass';
      readonly code: TransparentBypassCode;
      readonly reason: string;
    };

/**
 * 可选项目上下文。生产 setup 不必填写；测试可注入 Store / 策略 / Replay 替身。
 * 缺省时包装层按开关与默认空策略决定是否创建 Runtime。
 */
export interface TransparentAiActContext {
  readonly agent?: unknown;
  readonly experienceEnvironment?: ExperienceEnvironment;
  readonly experienceActionPolicy?: ExperienceActionPolicy;
  readonly experienceStoreRoot?: string;
  readonly experienceStore?: ExperienceStore;
  readonly experienceReplayChain?: ExperienceRuntimeDeps['replayChain'];
  readonly experienceMatchScreen?: ExperienceRuntimeDeps['matchScreen'];
  readonly experiencePromote?: ExperienceRuntimeDeps['promote'];
}
