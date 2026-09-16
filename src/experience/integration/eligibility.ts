import type { AiActNodeInput } from '@midscene/test/midscene';
import {
  deriveEligibleRequestKey,
  evaluateActionEligibility,
  normalizeActionPolicy,
  type ExperienceActionPolicy,
} from '../runtime';
import type { RuntimeIdentity, RuntimeRequest } from '../runtime/types';
import { SUPPORTED_AI_ACT_OPTION_KEYS } from './constants';
import type { TransparentAiActAccess } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasImages(prompt: unknown): boolean {
  if (!isPlainObject(prompt)) return false;
  return Array.isArray(prompt.images) && prompt.images.length > 0;
}

function runtimeRequestOf(input: AiActNodeInput): RuntimeRequest {
  return {
    prompt: input.prompt,
    options:
      input.options === undefined ? undefined : { ...(input.options as Record<string, unknown>) },
    node: 'aiAct',
  };
}

function unsupportedOptionKeys(options: Readonly<Record<string, unknown>> | undefined): string[] {
  if (!options) return [];
  return Object.keys(options).filter((key) => !SUPPORTED_AI_ACT_OPTION_KEYS.includes(key));
}

/**
 * 透明接入资格：只允许纯文本 prompt、声明支持的 options、已登记纯动作目标。
 * 图片、未知参数、含判断或 Key 不合格时旁路原生，不裁剪输入再查询。
 */
export function evaluateTransparentAiActAccess(
  input: AiActNodeInput,
  policy: ExperienceActionPolicy,
  identity: Pick<RuntimeIdentity, 'casePath' | 'caseName' | 'stepPath'>,
): TransparentAiActAccess {
  const normalized = normalizeActionPolicy(policy);
  if (typeof input.prompt !== 'string' || hasImages(input.prompt)) {
    return {
      kind: 'bypass',
      code: 'rich-media-prompt',
      reason: 'prompt 不是纯文本，或包含参考图片；原样透传原生，不裁剪后查询经验',
    };
  }

  const unknownOptions = unsupportedOptionKeys(
    input.options as Readonly<Record<string, unknown>> | undefined,
  );
  if (unknownOptions.length > 0) {
    return {
      kind: 'bypass',
      code: 'unsupported-options',
      reason: `options 含未声明支持的键（${unknownOptions.join('、')}）；原样保留全部参数走原生`,
    };
  }

  const request = runtimeRequestOf(input);
  const eligibility = evaluateActionEligibility(request, normalized);
  if (!eligibility.eligible) {
    const judgment = /判断|断言/.test(eligibility.reason);
    return {
      kind: 'bypass',
      code: judgment ? 'embedded-assertion' : 'unregistered-target',
      reason: eligibility.reason,
    };
  }

  const key = deriveEligibleRequestKey(request, identity, normalized.version);
  if (!key.eligible) {
    const contextReason = key.reason.includes('context');
    return {
      kind: 'bypass',
      code: contextReason ? 'unsupported-context' : 'ineligible-request-key',
      reason: key.reason,
    };
  }

  return {
    kind: 'replay-candidate',
    prompt: input.prompt,
    requestKey: key.requestKey,
    target: eligibility.target,
  };
}

export function transparentRuntimeRequestOf(input: AiActNodeInput): RuntimeRequest {
  return runtimeRequestOf(input);
}
