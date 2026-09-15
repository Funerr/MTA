import { createHash } from 'node:crypto';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 从 data URL 或裸 base64 取出图像字节。 */
export function decodeBase64Image(value: string): Uint8Array | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const comma = trimmed.indexOf(',');
  const body =
    trimmed.startsWith('data:') && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  try {
    const bytes = Buffer.from(body, 'base64');
    return bytes.byteLength > 0 ? new Uint8Array(bytes) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 从原生 ScreenshotItem 或序列化截图对象取出字节。
 * 内存已释放（hasBase64() === false 且无法恢复）时返回 undefined。
 */
export function extractScreenshotBytes(item: unknown): Uint8Array | undefined {
  if (!isRecord(item)) return undefined;
  try {
    if (typeof item.hasBase64 === 'function' && item.hasBase64() === false) {
      const raw = item.rawBase64;
      if (typeof raw === 'string') return decodeBase64Image(raw);
      return undefined;
    }
  } catch {
    return undefined;
  }
  try {
    if (typeof item.base64 === 'string') return decodeBase64Image(item.base64);
  } catch {
    return undefined;
  }
  if (typeof item.rawBase64 === 'string') return decodeBase64Image(item.rawBase64);
  return undefined;
}

export function screenshotIdOf(item: unknown, bytes?: Uint8Array): string {
  if (isRecord(item) && typeof item.id === 'string' && item.id.length > 0) {
    return item.id;
  }
  if (bytes && bytes.byteLength > 0) {
    return createHash('sha256').update(bytes).digest('hex');
  }
  return 'unknown';
}

export function screenshotCapturedAt(item: unknown): number {
  if (isRecord(item) && typeof item.capturedAt === 'number' && Number.isFinite(item.capturedAt)) {
    return item.capturedAt;
  }
  return 0;
}
