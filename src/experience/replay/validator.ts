import type { AssetRef, ScreenEvidence } from '../schema/assets';
import { screenEvidenceSchema } from '../schema/assets';
import {
  EXPERIENCE_ACTION_TYPES,
  experienceActionSchema,
  validateActionChain,
} from '../schema/action';
import {
  computeEnvironmentFingerprint,
  environmentSchema,
  type ExperienceEnvironment,
} from '../schema/environment';
import { PNG_MAGIC } from '../matcher/constants';
import { resolveMatcherConfig } from '../matcher/config';
import {
  IMAGE_PIPELINE_VERSION,
  IMAGE_SIGNATURE_ALGORITHM,
} from '../promotion/constants';
import type { ReplayChain, ReplayFailure, ReplayImageLoader } from './types';

/**
 * 整链预检（任务 1.2）：在首动作派发前完成格式、动作支持集、参数语义、
 * 环境与版本兼容、以及全部历史证据图片的可用性校验。任一后续动作不支持
 * 或证据缺失时整链拒绝，绝不先派发前几步再失败。
 */
export interface ReplayPreflightInput {
  readonly chain: ReplayChain;
  readonly currentEnvironment: ExperienceEnvironment;
  readonly loadImage: ReplayImageLoader;
  readonly matcherConfig?: unknown;
  readonly signal?: AbortSignal;
}

export interface ReplayActionImages {
  readonly before: Uint8Array;
  readonly after: Uint8Array;
  readonly target?: {
    readonly image: Uint8Array;
    readonly context: Uint8Array;
    readonly state?: Uint8Array;
  };
}

export interface ReplayChainImages {
  readonly entry: Uint8Array;
  readonly terminal: Uint8Array;
  readonly actions: readonly ReplayActionImages[];
}

export type ReplayPreflightResult =
  | { readonly ok: true; readonly images: ReplayChainImages }
  | { readonly ok: false; readonly failure: ReplayFailure; readonly actionIndex?: number };

function reject(
  kind: ReplayFailure['kind'],
  message: string,
  actionIndex?: number,
): ReplayPreflightResult {
  return { ok: false, failure: { kind, message }, actionIndex };
}

function assertPng(bytes: Uint8Array, label: string): ReplayFailure | undefined {
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) {
      return { kind: 'asset-unavailable', message: `${label}: 资产内容不是 PNG 图片` };
    }
  }
  return undefined;
}

async function loadAssetImage(
  loadImage: ReplayImageLoader,
  asset: AssetRef,
  label: string,
): Promise<{ ok: true; png: Uint8Array } | { ok: false; failure: ReplayFailure }> {
  let png: Uint8Array;
  try {
    png = await loadImage(asset);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      failure: {
        kind: 'asset-unavailable',
        message: `${label}: 历史证据图片不可用（${reason}）`,
        raw: reason,
      },
    };
  }
  const pngFailure = assertPng(png, label);
  if (pngFailure) return { ok: false, failure: pngFailure };
  return { ok: true, png };
}

/**
 * 证据版本检查：签名算法与图像管线必须与回放所用的锁定实现一致，
 * 跨版本资产不做静默迁移。
 */
function checkEvidenceVersion(evidence: ScreenEvidence, label: string): ReplayFailure | undefined {
  const params = evidence.signature.params;
  if (
    evidence.signature.algorithm !== IMAGE_SIGNATURE_ALGORITHM ||
    params.pipeline !== IMAGE_PIPELINE_VERSION
  ) {
    return {
      kind: 'version-incompatible',
      message: `${label}: 证据签名版本不兼容（algorithm=${evidence.signature.algorithm}, pipeline=${String(
        params.pipeline,
      )}，要求 ${IMAGE_SIGNATURE_ALGORITHM} + ${IMAGE_PIPELINE_VERSION}）`,
    };
  }
  return undefined;
}

/**
 * 逐动作解析：未登记动作类型 → action-unsupported（整链拒绝）；
 * 其余结构问题 → invalid-chain。
 */
function parseActions(
  actions: readonly unknown[],
):
  | { ok: true; parsed: ReturnType<typeof experienceActionSchema.parse>[] }
  | { ok: false; failure: ReplayFailure; actionIndex?: number } {
  const parsed: ReturnType<typeof experienceActionSchema.parse>[] = [];
  for (let index = 0; index < actions.length; index += 1) {
    const result = experienceActionSchema.safeParse(actions[index]);
    if (!result.success) {
      const rawType = (actions[index] as { type?: unknown } | null | undefined)?.type;
      if (typeof rawType === 'string' && !EXPERIENCE_ACTION_TYPES.includes(rawType as never)) {
        return {
          ok: false,
          actionIndex: index,
          failure: {
            kind: 'action-unsupported',
            message: `actions[${index}]: 动作类型 ${rawType} 不在回放支持集（${EXPERIENCE_ACTION_TYPES.join('/')}）；整链拒绝`,
          },
        };
      }
      return {
        ok: false,
        actionIndex: index,
        failure: {
          kind: 'invalid-chain',
          message: `actions[${index}]: 动作结构不合法：${result.error.issues
            .map((issue) => issue.message)
            .join('；')}`,
        },
      };
    }
    parsed.push(result.data);
  }
  return { ok: true, parsed };
}

/**
 * 执行整链预检。通过时返回按证据位置组织好的历史图片字节，供逐步
 * 匹配复用（预检即预热，不重复读盘）。
 */
export async function preflightReplayChain(
  input: ReplayPreflightInput,
): Promise<ReplayPreflightResult> {
  if (input.signal?.aborted) {
    return reject('cancelled', '回放在预检前已被取消');
  }

  const env = environmentSchema.safeParse(input.chain.environment);
  if (!env.success) {
    return reject(
      'invalid-chain',
      `chain.environment 不合法：${env.error.issues.map((issue) => issue.message).join('；')}`,
    );
  }
  const entry = screenEvidenceSchema.safeParse(input.chain.entryEvidence);
  if (!entry.success) {
    return reject(
      'invalid-chain',
      `chain.entryEvidence 不合法：${entry.error.issues.map((issue) => issue.message).join('；')}`,
    );
  }
  const terminal = screenEvidenceSchema.safeParse(input.chain.terminalEvidence);
  if (!terminal.success) {
    return reject(
      'invalid-chain',
      `chain.terminalEvidence 不合法：${terminal.error.issues.map((issue) => issue.message).join('；')}`,
    );
  }

  const parsed = parseActions(input.chain.actions);
  if (!parsed.ok) {
    return reject(parsed.failure.kind, parsed.failure.message, parsed.actionIndex);
  }
  if (parsed.parsed.length === 0) {
    return reject('invalid-chain', 'chain.actions: 动作链为空；回放至少需要一个动作');
  }
  const semanticReasons = validateActionChain(parsed.parsed);
  if (semanticReasons.length > 0) {
    return reject('invalid-chain', `链参数语义校验失败：${semanticReasons.join('；')}`);
  }

  if (
    computeEnvironmentFingerprint(input.currentEnvironment) !==
    computeEnvironmentFingerprint(env.data)
  ) {
    return reject(
      'environment-incompatible',
      '当前环境与链环境指纹不一致；环境变化应走 AI 回退而不是重放',
    );
  }

  try {
    resolveMatcherConfig(input.matcherConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reject('version-incompatible', `匹配配置不可用：${message}`);
  }

  const evidences: Array<{ evidence: ScreenEvidence; label: string }> = [
    { evidence: entry.data, label: 'entryEvidence' },
    { evidence: terminal.data, label: 'terminalEvidence' },
  ];
  parsed.parsed.forEach((action, index) => {
    evidences.push({ evidence: action.before, label: `actions[${index}].before` });
    evidences.push({ evidence: action.after, label: `actions[${index}].after` });
  });
  for (const { evidence, label } of evidences) {
    const versionFailure = checkEvidenceVersion(evidence, label);
    if (versionFailure) return reject(versionFailure.kind, versionFailure.message);
  }

  const entryImage = await loadAssetImage(
    input.loadImage,
    entry.data.screenshot.asset,
    'entryEvidence',
  );
  if (!entryImage.ok) return entryImage;
  const terminalImage = await loadAssetImage(
    input.loadImage,
    terminal.data.screenshot.asset,
    'terminalEvidence',
  );
  if (!terminalImage.ok) return terminalImage;

  const actionImages: ReplayActionImages[] = [];
  for (let index = 0; index < parsed.parsed.length; index += 1) {
    const action = parsed.parsed[index]!;
    const before = await loadAssetImage(
      input.loadImage,
      action.before.screenshot.asset,
      `actions[${index}].before`,
    );
    if (!before.ok) return before;
    const after = await loadAssetImage(
      input.loadImage,
      action.after.screenshot.asset,
      `actions[${index}].after`,
    );
    if (!after.ok) return after;
    let target: ReplayActionImages['target'];
    if ('target' in action && action.target) {
      const image = await loadAssetImage(
        input.loadImage,
        action.target.image.asset,
        `actions[${index}].target.image`,
      );
      if (!image.ok) return image;
      const context = await loadAssetImage(
        input.loadImage,
        action.target.contextImage.asset,
        `actions[${index}].target.contextImage`,
      );
      if (!context.ok) return context;
      let state: Uint8Array | undefined;
      if (action.target.stateBefore) {
        const loaded = await loadAssetImage(
          input.loadImage,
          action.target.stateBefore.asset,
          `actions[${index}].target.stateBefore`,
        );
        if (!loaded.ok) return loaded;
        state = loaded.png;
      }
      target = { image: image.png, context: context.png, state };
    }
    actionImages.push({ before: before.png, after: after.png, target });
  }

  return {
    ok: true,
    images: { entry: entryImage.png, terminal: terminalImage.png, actions: actionImages },
  };
}

/** 资产引用的来源类型（仅用于类型标注，运行期不做结构假设）。 */
export type ReplayAssetRef = AssetRef;
