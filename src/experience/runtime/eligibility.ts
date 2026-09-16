import { deriveRequestKey, type RequestKeySource } from '../schema/request-key';
import { ACTION_POLICY_VERSION, EMPTY_ACTION_POLICY } from './constants';
import type { ExperienceActionPolicy, RepeatableActionTarget, RuntimeRequest } from './types';

function isPlainJsonScalar(value: unknown): value is string | number | boolean | null {
  if (value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' || typeof value === 'boolean';
}

function contextOf(
  record: Readonly<Record<string, unknown>> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (record === undefined) return {};
  const collected: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!isPlainJsonScalar(value)) return undefined;
    collected[key] = value;
  }
  return collected;
}

function sameContext(
  left: Readonly<Record<string, string | number | boolean | null>>,
  right: Readonly<Record<string, string | number | boolean | null>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function looksLikeJudgmentRequest(request: RuntimeRequest): string | undefined {
  if (typeof request.prompt !== 'string' || request.prompt.length === 0) {
    return 'prompt 不是非空字符串；富媒体或非文本请求不能重放';
  }
  if (request.options && Object.keys(request.options).length > 0) {
    return '请求含未登记 options；含判断或未知语义参数的调用不能重放';
  }
  if (request.context) {
    for (const value of Object.values(request.context)) {
      if (!isPlainJsonScalar(value)) {
        return 'context 含非标量值；图片或结构化判断不能作为可重放目标';
      }
    }
  }
  return undefined;
}

/** 丢掉含判断/非纯动作的登记项，避免配置把断言类请求变成可重放目标。 */
export function normalizeActionPolicy(
  policy: ExperienceActionPolicy | undefined,
): ExperienceActionPolicy {
  const source = policy ?? EMPTY_ACTION_POLICY;
  const version = source.version.length > 0 ? source.version : ACTION_POLICY_VERSION;
  const targets: RepeatableActionTarget[] = [];
  for (const target of source.targets) {
    if (typeof target.prompt !== 'string' || target.prompt.length === 0) continue;
    if (typeof target.repeatableFromCurrentState !== 'boolean') continue;
    const context = contextOf(target.context);
    if (context === undefined) continue;
    targets.push({
      prompt: target.prompt,
      context,
      repeatableFromCurrentState: target.repeatableFromCurrentState,
    });
  }
  return { version, targets };
}

export type ActionEligibility =
  | { readonly eligible: true; readonly target: RepeatableActionTarget }
  | { readonly eligible: false; readonly reason: string };

/**
 * 仅当请求精确命中使用方登记的纯动作目标时允许走经验路径。
 * 默认空表、未登记、含判断/富媒体一律交给原生，不猜测幂等性。
 */
export function evaluateActionEligibility(
  request: RuntimeRequest,
  policy: ExperienceActionPolicy,
): ActionEligibility {
  const judgment = looksLikeJudgmentRequest(request);
  if (judgment) return { eligible: false, reason: judgment };
  const prompt = request.prompt as string;
  const requestContext = contextOf(request.context) ?? {};
  const match = policy.targets.find(
    (target) =>
      target.prompt === prompt && sameContext(contextOf(target.context) ?? {}, requestContext),
  );
  if (!match) {
    return {
      eligible: false,
      reason: policy.targets.length === 0
        ? '默认资格策略为空，未登记任何可重放目标'
        : '调用目标未在资格表中登记，或不满足精确 prompt/context 匹配',
    };
  }
  return { eligible: true, target: match };
}

export function requestKeySourceOf(
  request: RuntimeRequest,
  identity: { readonly casePath: string; readonly caseName: string; readonly stepPath: string },
  policyVersion: string,
): RequestKeySource {
  return {
    caseIdentity: { casePath: identity.casePath, caseName: identity.caseName },
    stepPath: identity.stepPath,
    node: typeof request.node === 'string' && request.node.length > 0 ? request.node : 'experienceAct',
    prompt: request.prompt,
    options: request.options,
    context: request.context,
    eligibilityPolicyVersion: policyVersion,
  };
}

export function deriveEligibleRequestKey(
  request: RuntimeRequest,
  identity: { readonly casePath: string; readonly caseName: string; readonly stepPath: string },
  policyVersion: string,
) {
  return deriveRequestKey(requestKeySourceOf(request, identity, policyVersion));
}
