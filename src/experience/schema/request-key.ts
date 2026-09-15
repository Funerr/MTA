import { canonicalJsonStringify, sha256Hex, type JsonScalar } from './json';

/** 请求 Key 算法标识参与哈希，算法演进时 Key 自然隔离。 */
export const REQUEST_KEY_ALGORITHM = 'experience-request-key-v1';

/**
 * 逻辑节点别名归一化：外部调用名（experienceAct/aiAct）不进入逻辑 Key，
 * 便于阶段 7 迁移。v1 仅登记 aiAct。
 */
export const LOGICAL_NODE_ALIASES: Readonly<Record<string, 'aiAct'>> = {
  aiAct: 'aiAct',
  experienceAct: 'aiAct',
};
export type LogicalNode = 'aiAct';

export function normalizeLogicalNode(node: string): LogicalNode | undefined {
  return LOGICAL_NODE_ALIASES[node];
}

/**
 * 已登记的纯文本请求参数键。首期登记集合为空：v1 的 aiAct 原生输入
 * 契约就是严格 `{ prompt }`，任何 options/context 键都使请求不合格
 * （直接走原生路径），不做未知字段通配。
 */
export interface RequestParamRegistry {
  readonly optionKeys: readonly string[];
  readonly contextKeys: readonly string[];
}
export const DEFAULT_REQUEST_PARAM_REGISTRY: RequestParamRegistry = {
  optionKeys: [],
  contextKeys: [],
};

/** 请求 Key 来源。字符串内容不 trim、不改写；运行 ID、取消信号不进入 Key。 */
export interface RequestKeySource {
  readonly caseIdentity: {
    readonly casePath: string;
    readonly caseName: string;
  };
  readonly stepPath: string;
  readonly node: string;
  readonly prompt: unknown;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly eligibilityPolicyVersion: string;
}

export type RequestKeyOutcome =
  | { eligible: true; requestKey: string; normalizedNode: LogicalNode }
  | { eligible: false; reason: string };

function isPlainJsonScalar(value: unknown): value is JsonScalar {
  if (value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' || typeof value === 'boolean';
}

function collectRegisteredParams(
  label: string,
  params: Readonly<Record<string, unknown>> | undefined,
  registeredKeys: readonly string[],
  reasons: string[],
): Record<string, JsonScalar> | undefined {
  if (params === undefined) return {};
  const collected: Record<string, JsonScalar> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key.length === 0 || !registeredKeys.includes(key)) {
      reasons.push(
        `${label} 含未登记键 "${key}"；首期只缓存已登记纯文本请求，未知语义参数不通配`,
      );
      continue;
    }
    if (!isPlainJsonScalar(value)) {
      reasons.push(
        `${label}.${key} 的值不是纯 JSON 标量；图片或结构化参数使请求不合格`,
      );
      continue;
    }
    collected[key] = value;
  }
  return collected;
}

/**
 * 派生精确请求 Key：case 身份、stepPath、归一化逻辑节点、原始 prompt、
 * 有效 options/context 与资格策略版本的规范化 JSON 哈希。
 * 不合格请求返回具体原因（预期控制流，不抛错）。
 */
export function deriveRequestKey(
  source: RequestKeySource,
  registry: RequestParamRegistry = DEFAULT_REQUEST_PARAM_REGISTRY,
): RequestKeyOutcome {
  const reasons: string[] = [];
  const requireText = (label: string, value: unknown): string | undefined => {
    if (typeof value !== 'string' || value.length === 0) {
      reasons.push(`${label} 必须是非空字符串`);
      return undefined;
    }
    return value;
  };

  const casePath = requireText('caseIdentity.casePath', source.caseIdentity?.casePath);
  const caseName = requireText('caseIdentity.caseName', source.caseIdentity?.caseName);
  const stepPath = requireText('stepPath', source.stepPath);
  const policyVersion = requireText(
    'eligibilityPolicyVersion',
    source.eligibilityPolicyVersion,
  );
  const prompt =
    typeof source.prompt === 'string' && source.prompt.length > 0
      ? source.prompt
      : undefined;
  if (prompt === undefined) reasons.push('prompt 必须是非空字符串');

  const normalizedNode = normalizeLogicalNode(
    typeof source.node === 'string' ? source.node : '',
  );
  if (!normalizedNode) {
    reasons.push(
      `逻辑节点 "${String(source.node)}" 未登记；v1 仅支持 aiAct/experienceAct（归一化为 aiAct）`,
    );
  }

  const options = collectRegisteredParams('options', source.options, registry.optionKeys, reasons);
  const context = collectRegisteredParams('context', source.context, registry.contextKeys, reasons);

  if (
    reasons.length > 0 ||
    !casePath ||
    !caseName ||
    !stepPath ||
    !policyVersion ||
    !prompt ||
    !normalizedNode
  ) {
    return { eligible: false, reason: reasons.join('；') };
  }

  const requestKey = sha256Hex(
    canonicalJsonStringify({
      keyAlgorithm: REQUEST_KEY_ALGORITHM,
      casePath,
      caseName,
      stepPath,
      node: normalizedNode,
      prompt,
      options: options ?? {},
      context: context ?? {},
      eligibilityPolicyVersion: policyVersion,
    }),
  );
  return { eligible: true, requestKey, normalizedNode };
}
