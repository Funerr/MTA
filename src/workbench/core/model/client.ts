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

export async function chatJson<T>(
  endpoint: AuthoringModelConfig | null,
  options: ChatJsonOptions,
): Promise<T> {
  if (!endpoint) {
    throw new ModelCallError(
      'not-configured',
      '编写模型未配置；请在工作台“模型配置”中填写 baseUrl、模型名称与密钥',
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  if (options.signal?.aborted) throw new ModelCallError('aborted', '模型调用已取消');
  let response: Response;
  try {
    response = await fetch(`${endpoint.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: options.messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens,
        response_format: { type: 'json_object' },
      }),
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

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ModelCallError(
      'http',
      `模型服务返回 ${response.status}：${body.slice(0, 300)}`,
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

/** 容忍 ```json 围栏与前缀文本，只要求能提取出完整 JSON 对象。 */
export function parseJsonContent<T>(content: string): T {
  const text = content.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = fenced ? [fenced[1]!.trim(), text] : [text];
  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      continue;
    }
  }
  throw new ModelCallError('invalid-response', '模型响应中未找到可解析的 JSON 对象');
}
