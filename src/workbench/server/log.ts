/**
 * 工作台日志：统一入口，输出前做密钥脱敏。
 * 模型密钥、Authorization 等敏感值不得进入普通日志。
 */

const SECRET_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  // "apiKey":"sk-..." / "api_key": "..." 等键值对
  {
    pattern: /("(?:apiKey|api_key|apikey|authorization|token|password)"\s*:\s*)"[^"]*"/gi,
    replacement: '$1"[REDACTED]"',
  },
  // Bearer 凭据
  { pattern: /(Bearer\s+)\S+/gi, replacement: '$1[REDACTED]' },
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce(
    (acc, { pattern, replacement }) => acc.replace(pattern, replacement),
    text,
  );
}

type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, message: string, meta?: unknown): void {
  const line = `[workbench] ${message}${
    meta === undefined ? '' : ` ${redact(JSON.stringify(meta))}`
  }`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
