import { defaultImagePipeline, type DecodedImage } from '../promotion/image';
import type { BoundingBox } from '../schema/action';
import {
  PHASH_HASH_SIZE,
  PHASH_SIZE,
  PNG_MAGIC,
} from './constants';
import { MatcherInputError } from './types';

export interface GrayFrame {
  readonly width: number;
  readonly height: number;
  readonly gray: Uint8Array;
  readonly rgba: Buffer;
}

const cosineTables = new Map<number, Float64Array>();

function cosineTable(n: number): Float64Array {
  const cached = cosineTables.get(n);
  if (cached) return cached;
  const table = new Float64Array(n * n);
  for (let u = 0; u < n; u += 1) {
    for (let x = 0; x < n; x += 1) {
      table[u * n + x] = Math.cos((Math.PI * u * (2 * x + 1)) / (2 * n));
    }
  }
  cosineTables.set(n, table);
  return table;
}

export function hasPngMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

export async function decodePngFrame(
  png: Uint8Array,
  label: string,
  limits: { maxBytes: number; maxPixels: number },
): Promise<GrayFrame> {
  if (png.byteLength === 0) {
    throw new MatcherInputError('invalid-image', `${label} 为空`);
  }
  if (png.byteLength > limits.maxBytes) {
    throw new MatcherInputError(
      'resource-limit',
      `${label} 字节数 ${png.byteLength} 超过上界 ${limits.maxBytes}`,
    );
  }
  if (!hasPngMagic(png)) {
    throw new MatcherInputError('invalid-image', `${label} 不是合法 PNG`);
  }
  let decoded: DecodedImage;
  try {
    decoded = await defaultImagePipeline.decode(png);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MatcherInputError('invalid-image', `${label} 解码失败：${message}`);
  }
  const pixels = decoded.width * decoded.height;
  if (pixels > limits.maxPixels) {
    throw new MatcherInputError(
      'resource-limit',
      `${label} 像素数 ${pixels} 超过上界 ${limits.maxPixels}`,
    );
  }
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: decoded.rgba,
    gray: rgbaToGray(decoded.rgba, decoded.width, decoded.height),
  };
}

export function rgbaToGray(rgba: Buffer, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    const o = i * 4;
    gray[i] = Math.round(
      0.299 * (rgba[o] ?? 0) + 0.587 * (rgba[o + 1] ?? 0) + 0.114 * (rgba[o + 2] ?? 0),
    );
  }
  return gray;
}

export function cropGray(
  gray: Uint8Array,
  width: number,
  height: number,
  box: BoundingBox,
): Uint8Array {
  if (
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > width ||
    box.y + box.height > height
  ) {
    throw new MatcherInputError(
      'invalid-image',
      `裁剪框 (${box.x},${box.y},${box.width}x${box.height}) 越出图像 ${width}x${height}`,
    );
  }
  const out = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y += 1) {
    const src = (box.y + y) * width + box.x;
    out.set(gray.subarray(src, src + box.width), y * box.width);
  }
  return out;
}

export function applyMasks(
  gray: Uint8Array,
  width: number,
  height: number,
  masks: readonly BoundingBox[],
): Uint8Array {
  if (masks.length === 0) return gray;
  const out = gray.slice();
  for (const mask of masks) {
    const x0 = Math.max(0, mask.x);
    const y0 = Math.max(0, mask.y);
    const x1 = Math.min(width, mask.x + mask.width);
    const y1 = Math.min(height, mask.y + mask.height);
    for (let y = y0; y < y1; y += 1) {
      out.fill(0, y * width + x0, y * width + x1);
    }
  }
  return out;
}

function resizeGray(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float64Array {
  const dst = new Float64Array(dw * dh);
  for (let dy = 0; dy < dh; dy += 1) {
    const y0 = Math.floor((dy * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * sh) / dh));
    for (let dx = 0; dx < dw; dx += 1) {
      const x0 = Math.floor((dx * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * sw) / dw));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < sh; y += 1) {
        for (let x = x0; x < x1 && x < sw; x += 1) {
          sum += src[y * sw + x] ?? 0;
          count += 1;
        }
      }
      dst[dy * dw + dx] = sum / Math.max(1, count);
    }
  }
  return dst;
}

function dct2D(block: Float64Array, n: number): Float64Array {
  const cos = cosineTable(n);
  const tmp = new Float64Array(n * n);
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let u = 0; u < n; u += 1) {
      let sum = 0;
      for (let x = 0; x < n; x += 1) {
        sum += (block[y * n + x] ?? 0) * (cos[u * n + x] ?? 0);
      }
      tmp[y * n + u] = sum;
    }
  }
  for (let u = 0; u < n; u += 1) {
    for (let v = 0; v < n; v += 1) {
      let sum = 0;
      for (let y = 0; y < n; y += 1) {
        sum += (tmp[y * n + u] ?? 0) * (cos[v * n + y] ?? 0);
      }
      out[v * n + u] = sum;
    }
  }
  return out;
}

export function perceptualHash(gray: Uint8Array, width: number, height: number): bigint {
  const small = resizeGray(gray, width, height, PHASH_SIZE, PHASH_SIZE);
  const dct = dct2D(small, PHASH_SIZE);
  const coeffs: number[] = [];
  for (let v = 0; v < PHASH_HASH_SIZE; v += 1) {
    for (let u = 0; u < PHASH_HASH_SIZE; u += 1) {
      coeffs.push(dct[v * PHASH_SIZE + u] ?? 0);
    }
  }
  const sorted = [...coeffs].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  let hash = 0n;
  for (let i = 0; i < coeffs.length; i += 1) {
    if ((coeffs[i] ?? 0) > median) hash |= 1n << BigInt(i);
  }
  return hash;
}

export function hamming64(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x !== 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export interface PreparedTemplate {
  readonly width: number;
  readonly height: number;
  readonly gray: Uint8Array;
  readonly mean: number;
  readonly norm: number;
  readonly sum: number;
  readonly sumSq: number;
}

export function prepareTemplate(gray: Uint8Array, width: number, height: number): PreparedTemplate {
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i] ?? 0;
    sum += v;
    sumSq += v * v;
  }
  const n = gray.length;
  const mean = sum / Math.max(1, n);
  const norm = Math.sqrt(Math.max(0, sumSq - n * mean * mean));
  return { width, height, gray, mean, norm, sum, sumSq };
}

export function znccAt(
  image: Uint8Array,
  iw: number,
  template: PreparedTemplate,
  left: number,
  top: number,
): number {
  const tw = template.width;
  const th = template.height;
  const n = tw * th;
  let sumI = 0;
  let sumI2 = 0;
  let sumIT = 0;
  for (let y = 0; y < th; y += 1) {
    const iy = (top + y) * iw + left;
    const ty = y * tw;
    for (let x = 0; x < tw; x += 1) {
      const iv = image[iy + x] ?? 0;
      const tv = template.gray[ty + x] ?? 0;
      sumI += iv;
      sumI2 += iv * iv;
      sumIT += iv * tv;
    }
  }
  const meanI = sumI / n;
  const normI = Math.sqrt(Math.max(0, sumI2 - n * meanI * meanI));
  const denom = normI * template.norm;
  if (denom < 1e-6) {
    return Math.abs(meanI - template.mean) < 1e-6 ? 1 : 0;
  }
  // 等价于零均值归一化相关：n*cov / (normI * normT)
  const cov = sumIT - n * meanI * template.mean;
  return cov / denom;
}

export interface ScorePeak {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

export function searchZnccPeaks(
  image: Uint8Array,
  iw: number,
  ih: number,
  template: PreparedTemplate,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minScore: number,
  maxCandidates: number,
  nmsRadiusPx: number,
): { peaks: ScorePeak[]; positionCount: number } {
  const positionCount = (maxX - minX + 1) * (maxY - minY + 1);
  const raw: ScorePeak[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (x < 0 || y < 0 || x + template.width > iw || y + template.height > ih) {
        continue;
      }
      const score = znccAt(image, iw, template, x, y);
      if (score >= minScore) {
        raw.push({ x, y, score });
      }
    }
  }
  const peaks = nonMaxSuppression(raw, nmsRadiusPx);
  if (peaks.length > maxCandidates) {
    throw new MatcherInputError(
      'resource-limit',
      `超过候选上界：${peaks.length} > ${maxCandidates}`,
    );
  }
  return { peaks, positionCount };
}

export function nonMaxSuppression(peaks: readonly ScorePeak[], radius: number): ScorePeak[] {
  const sorted = [...peaks].sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const kept: ScorePeak[] = [];
  const r2 = radius * radius;
  for (const peak of sorted) {
    const nearby = kept.some((item) => {
      const dx = item.x - peak.x;
      const dy = item.y - peak.y;
      return dx * dx + dy * dy <= r2;
    });
    if (!nearby) kept.push(peak);
  }
  return kept;
}

export function ssimGray(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[i] ?? 0;
    meanB += b[i] ?? 0;
  }
  meanA /= n;
  meanB /= n;
  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (a[i] ?? 0) - meanA;
    const db = (b[i] ?? 0) - meanB;
    varA += da * da;
    varB += db * db;
    cov += da * db;
  }
  varA /= n;
  varB /= n;
  cov /= n;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  return (
    ((2 * meanA * meanB + c1) * (2 * cov + c2)) /
    ((meanA * meanA + meanB * meanB + c1) * (varA + varB + c2))
  );
}
