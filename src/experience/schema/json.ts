import { createHash } from 'node:crypto';

/** 参与 Key/指纹计算的纯 JSON 值（标量、数组或字符串键对象）。 */
export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * 严格规范化 JSON 序列化：对象键按码点排序、无空白。
 * 字符串内容原样保留，不 trim、不改写；运行 ID、取消信号等不进入 Key。
 */
export function canonicalJsonStringify(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item as JsonValue)).join(',')}]`;
  }
  const record = value as { readonly [key: string]: JsonValue };
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`)
    .join(',');
  return `{${body}}`;
}

/** sha256 摘要，输出 64 位小写十六进制；Key、指纹与资产摘要共用。 */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}
