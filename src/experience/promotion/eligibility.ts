import { deriveRequestKey, type RequestKeySource } from '../schema/request-key';
import { ELIGIBILITY_POLICY_VERSION } from './constants';
import type { NormalizedTrace } from './types';

export interface EligibilityPolicy {
  readonly version: string;
  /** v1 必须为 false：出现 Insight 判断/提取/等待即整链拒绝。 */
  readonly allowSemanticChecks: boolean;
  /** v1 必须为 false：动态原生返回值不作为可重放经验。 */
  readonly allowDynamicOutput: boolean;
}

export const DEFAULT_ELIGIBILITY_POLICY: EligibilityPolicy = {
  version: ELIGIBILITY_POLICY_VERSION,
  allowSemanticChecks: false,
  allowDynamicOutput: false,
};

export type NativeResultCategory =
  | { readonly category: 'undefined' }
  | { readonly category: string };

export function checkRequestEligibility(request: RequestKeySource): { ok: true } | { ok: false; reason: string } {
  const key = deriveRequestKey(request);
  if (!key.eligible) {
    return { ok: false, reason: `请求不合格，不发布经验：${key.reason}` };
  }
  return { ok: true };
}

export function checkNativeResult(
  nativeResult: NativeResultCategory,
  policy: EligibilityPolicy,
): { ok: true } | { ok: false; reason: string } {
  if (nativeResult.category === 'undefined') return { ok: true };
  if (policy.allowDynamicOutput) return { ok: true };
  return {
    ok: false,
    reason: `原生结果类别为 ${nativeResult.category}，v1 只学习纯动作（undefined）调用`,
  };
}

export function checkTracePolicy(
  trace: NormalizedTrace,
  policy: EligibilityPolicy,
): { ok: true } | { ok: false; reason: string } {
  if (trace.actions.length === 0) {
    return { ok: false, reason: '动作链为空，不发布' };
  }
  if (policy.version.length === 0) {
    return { ok: false, reason: '资格策略版本不能为空' };
  }
  return { ok: true };
}
