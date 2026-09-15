import type { BoundingBox } from '../schema/action';
import type { ExperienceActionType } from '../schema/action';

/** 从原生 dump 抽出的一帧屏幕（已转为 PNG 字节）。 */
export interface NormalizedScreenshot {
  readonly id: string;
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly capturedAt: number;
}

export interface NormalizedLocateTarget {
  readonly bbox: BoundingBox;
  readonly center: { readonly x: number; readonly y: number };
  readonly textHint?: string;
}

interface NormalizedActionBase {
  readonly taskId: string;
  readonly nativeSubType: string;
  readonly before: NormalizedScreenshot;
  readonly after: NormalizedScreenshot;
}

export type NormalizedAction =
  | (NormalizedActionBase & {
      readonly type: 'Tap';
      readonly target: NormalizedLocateTarget;
    })
  | (NormalizedActionBase & {
      readonly type: 'Input';
      readonly target: NormalizedLocateTarget;
      readonly params: { readonly text: string; readonly mode: 'append' | 'replace' };
    })
  | (NormalizedActionBase & {
      readonly type: 'Scroll';
      readonly target: NormalizedLocateTarget;
      readonly params: {
        readonly direction: 'up' | 'down' | 'left' | 'right';
        readonly distancePx: number;
        readonly anchor: { readonly x: number; readonly y: number };
      };
    })
  | (NormalizedActionBase & {
      readonly type: 'LongPress';
      readonly target: NormalizedLocateTarget;
      readonly params: { readonly durationMs: number };
    })
  | (NormalizedActionBase & { readonly type: 'Back' })
  | (NormalizedActionBase & { readonly type: 'Home' });

export interface NormalizedTrace {
  readonly executionId: string;
  readonly name: string;
  readonly midsceneVersion: string;
  readonly adapterVersion: string;
  readonly actions: readonly NormalizedAction[];
}

export type PromotionSkipKind =
  | 'ineligible-request'
  | 'dynamic-output'
  | 'unmodeled-check'
  | 'empty-chain'
  | 'unsupported-action'
  | 'failed-or-cancelled'
  | 'missing-evidence'
  | 'cross-call-pollution'
  | 'duplicate';

export type AdaptResult =
  | { readonly ok: true; readonly trace: NormalizedTrace }
  | { readonly ok: false; readonly reason: string; readonly kind: PromotionSkipKind };

export type ExperienceActionKind = ExperienceActionType;
