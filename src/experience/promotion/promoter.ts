import type { ExperienceAction } from '../schema/action';
import type { ExperienceSource } from '../schema/experience';
import type { ExperienceEnvironment } from '../schema/environment';
import type { ScreenEvidence } from '../schema/assets';
import { deriveRequestKey, type RequestKeySource } from '../schema/request-key';
import {
  openExperienceStore,
  type ExperienceStore,
  type PublishOutcome,
  type VariantSnapshot,
} from '../store/experience-store';
import { CONTEXT_PAD_RATIO, TRACE_ADAPTER_VERSION } from './constants';
import {
  DEFAULT_ELIGIBILITY_POLICY,
  checkNativeResult,
  checkRequestEligibility,
  checkTracePolicy,
  type EligibilityPolicy,
  type NativeResultCategory,
} from './eligibility';
import {
  defaultImagePipeline,
  expandBox,
  imageEvidenceFromPng,
  screenEvidenceFromPng,
  type ImagePipeline,
} from './image';
import { adaptDump } from './trace-adapter';
import type { NormalizedAction, NormalizedTrace } from './types';

export type PromoteResult =
  | {
      readonly result: 'promoted';
      readonly callId: string;
      readonly snapshot: VariantSnapshot;
      readonly duplicate: boolean;
      readonly contextPadRatio: number;
    }
  | { readonly result: 'skipped'; readonly callId: string; readonly reason: string }
  | { readonly result: 'failed'; readonly callId: string; readonly reason: string };

export interface PromoteInput {
  readonly callId: string;
  /** 单次调用的 ExecutionDump，或含 executions 的 ReportActionDump。 */
  readonly dump: unknown;
  readonly request: RequestKeySource;
  readonly environment: ExperienceEnvironment;
  readonly source: {
    readonly casePath: string;
    readonly caseName: string;
    readonly stepPath: string;
    readonly node: string;
    readonly prompt: string;
  };
  readonly store: ExperienceStore;
  readonly nativeResult?: NativeResultCategory;
  readonly policy?: EligibilityPolicy;
  readonly capturedAt?: string;
  readonly executionId?: string;
  readonly knownExecutionIds?: ReadonlySet<string>;
  readonly midsceneVersion?: string;
  readonly imagePipeline?: ImagePipeline;
}

interface BuiltAssets {
  readonly actions: ExperienceAction[];
  readonly entryEvidence: ScreenEvidence;
  readonly terminalEvidence: ScreenEvidence;
  readonly images: Map<string, Uint8Array>;
}

function putImage(images: Map<string, Uint8Array>, digest: string, png: Uint8Array): void {
  images.set(digest, png);
}

async function evidenceAndStore(
  png: Uint8Array,
  pipeline: ImagePipeline,
  images: Map<string, Uint8Array>,
  extraParams: Record<string, string | number | boolean | null> = {},
): Promise<ScreenEvidence> {
  const built = await screenEvidenceFromPng(png, pipeline, extraParams);
  putImage(images, built.evidence.screenshot.asset.digest, built.png);
  return built.evidence;
}

async function cropEvidence(
  beforePng: Uint8Array,
  box: { x: number; y: number; width: number; height: number },
  pipeline: ImagePipeline,
  images: Map<string, Uint8Array>,
  role: 'target' | 'context',
): Promise<ReturnType<typeof imageEvidenceFromPng>> {
  const png = await pipeline.crop(beforePng, box);
  const decoded = await pipeline.decode(png);
  if (decoded.width <= 0 || decoded.height <= 0) {
    throw new Error(`${role} 裁剪结果为空`);
  }
  const image = imageEvidenceFromPng(decoded.png, decoded.width, decoded.height);
  putImage(images, image.asset.digest, decoded.png);
  return image;
}

async function buildAction(
  action: NormalizedAction,
  pipeline: ImagePipeline,
  images: Map<string, Uint8Array>,
): Promise<ExperienceAction> {
  const before = await evidenceAndStore(action.before.png, pipeline, images, { role: 'before' });
  const after = await evidenceAndStore(action.after.png, pipeline, images, { role: 'after' });
  if (action.type === 'Back' || action.type === 'Home') {
    return { type: action.type, before, after };
  }
  const targetBox = action.target.bbox;
  const contextBox = expandBox(targetBox, action.before, CONTEXT_PAD_RATIO);
  const targetImage = await cropEvidence(
    action.before.png,
    targetBox,
    pipeline,
    images,
    'target',
  );
  const contextImage = await cropEvidence(
    action.before.png,
    contextBox,
    pipeline,
    images,
    'context',
  );
  const target = {
    image: targetImage,
    contextImage,
    bbox: targetBox,
    ...(action.target.textHint ? { textHint: action.target.textHint } : {}),
  };
  if (action.type === 'Tap') return { type: 'Tap', before, after, target };
  if (action.type === 'Input') {
    return { type: 'Input', before, after, target, params: action.params };
  }
  if (action.type === 'Scroll') {
    return { type: 'Scroll', before, after, target, params: action.params };
  }
  return { type: 'LongPress', before, after, target, params: action.params };
}

async function buildAssets(
  trace: NormalizedTrace,
  pipeline: ImagePipeline,
): Promise<BuiltAssets> {
  const images = new Map<string, Uint8Array>();
  const actions: ExperienceAction[] = [];
  for (const action of trace.actions) {
    actions.push(await buildAction(action, pipeline, images));
  }
  const first = trace.actions[0];
  const last = trace.actions[trace.actions.length - 1];
  if (!first || !last) throw new Error('动作链为空');
  const entryEvidence = await evidenceAndStore(first.before.png, pipeline, images, {
    role: 'entry',
    padRatio: CONTEXT_PAD_RATIO,
  });
  const terminalEvidence = await evidenceAndStore(last.after.png, pipeline, images, {
    role: 'terminal',
  });
  return { actions, entryEvidence, terminalEvidence, images };
}

function skipped(callId: string, reason: string): PromoteResult {
  return { result: 'skipped', callId, reason };
}

function failed(callId: string, reason: string): PromoteResult {
  return { result: 'failed', callId, reason };
}

/**
 * 将一次成功 AI 调用的原生轨迹转为 candidate 并原子发布。
 * 不接管原生 aiAct、不二次调用模型、失败不影响原生结果。
 */
export async function promoteExperience(input: PromoteInput): Promise<PromoteResult> {
  const callId = input.callId;
  if (typeof callId !== 'string' || callId.length === 0) {
    return failed('', 'callId 必须是非空字符串');
  }
  const policy = input.policy ?? DEFAULT_ELIGIBILITY_POLICY;
  const nativeResult = input.nativeResult ?? { category: 'undefined' };

  const requestCheck = checkRequestEligibility(input.request);
  if (!requestCheck.ok) return skipped(callId, requestCheck.reason);

  const nativeCheck = checkNativeResult(nativeResult, policy);
  if (!nativeCheck.ok) return skipped(callId, nativeCheck.reason);

  const requestKey = deriveRequestKey(input.request);
  if (!requestKey.eligible) return skipped(callId, requestKey.reason);

  const adapted = await adaptDump(input.dump, {
    executionId: input.executionId,
    knownIds: input.knownExecutionIds,
    midsceneVersion: input.midsceneVersion,
    pipeline: input.imagePipeline,
  });
  if (!adapted.ok) {
    return skipped(callId, adapted.reason);
  }
  const policyCheck = checkTracePolicy(adapted.trace, policy);
  if (!policyCheck.ok) return skipped(callId, policyCheck.reason);

  const pipeline = input.imagePipeline ?? defaultImagePipeline;
  let assets: BuiltAssets;
  try {
    assets = await buildAssets(adapted.trace, pipeline);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failed(callId, `图片裁剪或编码失败：${reason}`);
  }

  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const source: ExperienceSource = {
    casePath: input.source.casePath,
    caseName: input.source.caseName,
    stepPath: input.source.stepPath,
    node: 'aiAct',
    prompt: input.source.prompt,
    callId,
    midsceneVersion: adapted.trace.midsceneVersion,
    adapterVersion: TRACE_ADAPTER_VERSION,
    capturedAt,
  };

  let published: { ok: true; value: PublishOutcome } | { ok: false; error: { kind: string; message: string } };
  try {
    published = await input.store.publishCandidate({
      eventId: callId,
      requestKey: requestKey.requestKey,
      source,
      environment: input.environment,
      variant: {
        entryEvidence: assets.entryEvidence,
        terminalEvidence: assets.terminalEvidence,
        actions: assets.actions,
        eligibilityPolicyVersion: policy.version,
      },
      images: assets.images,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failed(callId, `Store 发布抛出异常：${reason}`);
  }

  if (!published.ok) {
    return failed(callId, `Store 拒绝发布：${published.error.message}`);
  }
  return {
    result: 'promoted',
    callId,
    snapshot: published.value.snapshot,
    duplicate: published.value.result === 'duplicate',
    contextPadRatio: CONTEXT_PAD_RATIO,
  };
}

export function openPromotionStore(root: string): ExperienceStore {
  return openExperienceStore(root);
}
