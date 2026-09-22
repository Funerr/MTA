import type { AuthoringModelConfig } from '../../server/model-config';

/**
 * 编写模型调用边界：OpenAI 兼容 chat/completions，仅此一处封装
 * 提供者差异。支持中止与超时；失败抛 ModelCallError，不产生部分结果。
 * 密钥只出现在请求头，不进入日志与返回值。
 */

export type ModelCallErrorKind =
  | 'timeout'
  | 'http'
  | 'invalid-response'
  | 'aborted'
  | 'not-configured';

export class ModelCallError extends Error {
  readonly kind: ModelCallErrorKind;
  readonly status?: number;
  constructor(kind: ModelCallErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ModelCallError';
    this.kind = kind;
    this.status = status;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatJsonOptions {
  messages: readonly ChatMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * 不支持 response_format: { type: 'json_object' } 的模型系列。
 * 这些模型需要依赖 prompt 指令 + parseJsonContent 提取 JSON。
 */
const NO_JSON_FORMAT_FAMILIES = new Set([
  'zhipu', 'glm', 'deepseek', 'qwen', 'minimax', 'baichuan', 'moonshot',
  'spark', 'hunyuan', 'yi', 'stepfun',
]);

/** 根据 family 或 model 名判断是否应发送 response_format。 */
function shouldUseJsonFormat(endpoint: AuthoringModelConfig): boolean {
  const family = (endpoint.family ?? '').toLowerCase();
  if (family && NO_JSON_FORMAT_FAMILIES.has(family)) return false;
  const model = endpoint.model.toLowerCase();
  for (const tag of NO_JSON_FORMAT_FAMILIES) {
    if (model.includes(tag)) return false;
  }
  return true;
}

export async function chatJson<T>(
  endpoint: AuthoringModelConfig | null,
  options: ChatJsonOptions,
): Promise<T> {
  if (!endpoint) {
    throw new ModelCallError(
      'not-configured',
      '编写模型未配置；请在工作台”模型配置”中填写 baseUrl、模型名称与密钥',
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  if (options.signal?.aborted) throw new ModelCallError('aborted', '模型调用已取消');

  const useJsonFormat = shouldUseJsonFormat(endpoint);
  const body: Record<string, unknown> = {
    model: endpoint.model,
    messages: options.messages,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens,
  };
  if (useJsonFormat) {
    body.response_format = { type: 'json_object' };
  }

  let response: Response;
  try {
    response = await fetch(`${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new ModelCallError('aborted', '模型调用已取消');
    }
    if ((error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError') {
      throw new ModelCallError('timeout', `模型调用超时（${timeoutMs}ms）`);
    }
    throw new ModelCallError(
      'http',
      `模型请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // response_format 不被支持时自动重试：去掉该参数后重发。
  if (!response.ok && response.status === 400 && useJsonFormat) {
    const errBody = await response.text().catch(() => '');
    if (/response_format|json_object|unsupported/i.test(errBody)) {
      delete body.response_format;
      try {
        response = await fetch(`${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        throw new ModelCallError(
          'http',
          `模型请求重试失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new ModelCallError(
      'http',
      `模型服务返回 ${response.status}：${errBody.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json().catch(() => {
    throw new ModelCallError('invalid-response', '模型响应不是合法 JSON');
  })) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new ModelCallError('invalid-response', '模型响应缺少文本内容');
  }
  return parseJsonContent<T>(content);
}

/**
 * 容忍 ```json 围栏、前后说明文字与多个片段，提取第一个完整 JSON 值。
 * 对象与数组根都接受；用平衡括号扫描避免"首个 { 到最后一个 }"被中间
 * 夹杂的散文破坏。
 */
export function parseJsonContent<T>(content: string): T {
  const text = content.replace(/\uFEFF|\u200B|\u200C|\u200D/g, '').trim();
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(
    (match) => match[1]!.trim(),
  );
  const candidates = [...fenced, text];
  for (const candidate of candidates) {
    // 先整段直接解析（模型常输出纯 JSON）
    const direct = tryParse<T>(candidate);
    if (direct !== PARSE_FAILED) return direct;
    // 再平衡扫描：跳过说明文字，取第一个完整的对象/数组
    const scanned = scanBalanced<T>(candidate);
    if (scanned !== PARSE_FAILED) return scanned;
  }
  throw new ModelCallError('invalid-response', '模型响应中未找到可解析的 JSON 对象');
}

const PARSE_FAILED = Symbol('parse-failed');

function tryParse<T>(text: string): T | typeof PARSE_FAILED {
  if (!text) return PARSE_FAILED;
  try {
    return JSON.parse(text) as T;
  } catch {
    // 常见模型输出缺陷：字符串值内未转义的控制字符（把整段 YAML 塞进
    // JSON 字符串时的字面换行）与未转义引号（YAML 自身的 "..."）。
    // 按启发式修复后重试一次。
    try {
      return JSON.parse(repairJsonStrings(text)) as T;
    } catch {
      return PARSE_FAILED;
    }
  }
}

/** 收尾引号后允许出现的结构字符（跳过空白后）。 */
const STRUCTURAL_AFTER_CLOSE = new Set([',', '}', ']', ':']);
/** 开启引号前允许出现的结构字符。 */
const STRUCTURAL_BEFORE_OPEN = new Set(['{', '[', ',', ':']);

function escapeControlChar(code: number): string {
  if (code === 0x0a) return '\\n';
  if (code === 0x0d) return '\\r';
  if (code === 0x09) return '\\t';
  return `\\u${code.toString(16).padStart(4, '0')}`;
}

/**
 * 修复 JSON 字符串值内的两类常见损坏：
 * 1. 字面控制字符（换行/制表等 < 0x20）→ 转义；
 * 2. 未转义引号 → 用“引号后第一个非空白字符是否为 JSON 结构字符”
 *    判断收尾或内嵌：收尾引号后只能是 , } ] : 或文本结束，否则视为
 *    内嵌引号转义保留。
 */
function repairJsonStrings(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  let lastOutside = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j]!)) j += 1;
        const next = text[j];
        if (next === undefined || STRUCTURAL_AFTER_CLOSE.has(next)) {
          inString = false;
          out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += escapeControlChar(code);
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      if (lastOutside === '' || STRUCTURAL_BEFORE_OPEN.has(lastOutside)) {
        inString = true;
        out += ch;
      }
      // 结构字符后以外的游离引号：丢弃，避免破坏外围结构。
      continue;
    }
    if (!/\s/.test(ch)) lastOutside = ch;
    out += ch;
  }
  return out;
}

/** 从任意文本中提取第一个可解析的平衡 JSON 对象/数组；忽略字符串内的括号。 */
function scanBalanced<T>(text: string): T | typeof PARSE_FAILED {
  // 逐个尝试文本里出现的每个顶层起始括号：说明文字夹杂杂散 { 或
  // 多段输出时，第一个候选可能损坏，后续候选仍可命中。
  for (let start = text.search(/[{[]/); start >= 0; ) {
    const open = text[start]!;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return PARSE_FAILED;
    const parsed = tryParse<T>(text.slice(start, end + 1));
    if (parsed !== PARSE_FAILED) return parsed;
    const next = text.slice(end + 1).search(/[{[]/);
    start = next < 0 ? -1 : end + 1 + next;
  }
  return PARSE_FAILED;
}
