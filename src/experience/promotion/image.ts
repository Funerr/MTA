import sharp from 'sharp';
import type { BoundingBox } from '../schema/action';
import type { ImageEvidence, ImageSignature, ScreenEvidence } from '../schema/assets';
import { computeAssetDigest } from '../schema/assets';
import {
  CONTEXT_PAD_RATIO,
  IMAGE_PIPELINE_VERSION,
  IMAGE_SIGNATURE_ALGORITHM,
  IMAGE_SIGNATURE_GRID,
  IMAGE_SIGNATURE_VERSION,
} from './constants';

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array;
  readonly rgba: Buffer;
}

export interface ImagePipeline {
  readonly version: string;
  decode(bytes: Uint8Array): Promise<DecodedImage>;
  crop(png: Uint8Array, box: BoundingBox): Promise<Uint8Array>;
}

export class SharpImagePipeline implements ImagePipeline {
  readonly version = IMAGE_PIPELINE_VERSION;

  async decode(bytes: Uint8Array): Promise<DecodedImage> {
    const image = sharp(Buffer.from(bytes), { failOn: 'error' });
    const pngBuffer = await image.png().toBuffer();
    const { data, info } = await sharp(pngBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) {
      throw new Error('图像解码失败：无法读取宽高');
    }
    return {
      width: info.width,
      height: info.height,
      png: new Uint8Array(pngBuffer),
      rgba: data,
    };
  }

  async crop(png: Uint8Array, box: BoundingBox): Promise<Uint8Array> {
    if (box.width <= 0 || box.height <= 0) {
      throw new Error(`裁剪区域为空：${box.width}x${box.height}`);
    }
    const buffer = await sharp(Buffer.from(png))
      .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
      .png()
      .toBuffer();
    if (buffer.byteLength === 0) {
      throw new Error('裁剪结果为空');
    }
    return new Uint8Array(buffer);
  }
}

export const defaultImagePipeline: ImagePipeline = new SharpImagePipeline();

/** 将目标框按比例扩边并夹紧到图像边界；结果必须覆盖原 bbox。 */
export function expandBox(
  box: BoundingBox,
  image: { readonly width: number; readonly height: number },
  padRatio: number = CONTEXT_PAD_RATIO,
): BoundingBox {
  const padX = Math.round(box.width * padRatio);
  const padY = Math.round(box.height * padRatio);
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const right = Math.min(image.width, box.x + box.width + padX);
  const bottom = Math.min(image.height, box.y + box.height + padY);
  return { x, y, width: right - x, height: bottom - y };
}

/** 8×8 平均 RGB 网格签名，表达内容外观，不是完整性摘要。 */
export function meanRgbGridSignature(
  rgba: Buffer,
  width: number,
  height: number,
  extraParams: Record<string, string | number | boolean | null> = {},
): ImageSignature {
  const grid = IMAGE_SIGNATURE_GRID;
  const cells = new Uint8Array(grid * grid * 3);
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const x0 = Math.floor((gx * width) / grid);
      const x1 = Math.floor(((gx + 1) * width) / grid);
      const y0 = Math.floor((gy * height) / grid);
      const y1 = Math.floor(((gy + 1) * height) / grid);
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < Math.max(y1, y0 + 1) && y < height; y += 1) {
        for (let x = x0; x < Math.max(x1, x0 + 1) && x < width; x += 1) {
          const i = (y * width + x) * 4;
          r += rgba[i] ?? 0;
          g += rgba[i + 1] ?? 0;
          b += rgba[i + 2] ?? 0;
          count += 1;
        }
      }
      const o = (gy * grid + gx) * 3;
      const denom = Math.max(1, count);
      cells[o] = Math.round(r / denom);
      cells[o + 1] = Math.round(g / denom);
      cells[o + 2] = Math.round(b / denom);
    }
  }
  return {
    algorithm: IMAGE_SIGNATURE_ALGORITHM,
    version: IMAGE_SIGNATURE_VERSION,
    params: { grid, pipeline: IMAGE_PIPELINE_VERSION, ...extraParams },
    value: Buffer.from(cells).toString('hex'),
  };
}

export function imageEvidenceFromPng(
  png: Uint8Array,
  width: number,
  height: number,
): ImageEvidence {
  const digest = computeAssetDigest(png);
  return {
    asset: { digest, byteSize: png.byteLength, mimeType: 'image/png' },
    width,
    height,
  };
}

export async function screenEvidenceFromPng(
  png: Uint8Array,
  pipeline: ImagePipeline = defaultImagePipeline,
  extraParams: Record<string, string | number | boolean | null> = {},
): Promise<{ evidence: ScreenEvidence; png: Uint8Array }> {
  const decoded = await pipeline.decode(png);
  return {
    png: decoded.png,
    evidence: {
      screenshot: imageEvidenceFromPng(decoded.png, decoded.width, decoded.height),
      signature: meanRgbGridSignature(
        decoded.rgba,
        decoded.width,
        decoded.height,
        extraParams,
      ),
    },
  };
}
