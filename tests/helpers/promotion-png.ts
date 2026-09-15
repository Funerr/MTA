import sharp from 'sharp';

/** 生成纯色 PNG，供夹具截图与可视化裁剪断言使用。 */
export async function makeSolidPng(
  width: number,
  height: number,
  rgb: { r: number; g: number; b: number },
): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: rgb },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

/** 灰底上绘制一块实心矩形，用于核对 bbox 裁剪与原始目标框一致。 */
export async function makeMarkedPng(
  width: number,
  height: number,
  mark: { x: number; y: number; width: number; height: number; rgb: { r: number; g: number; b: number } },
): Promise<Uint8Array> {
  const base = await sharp({
    create: { width, height, channels: 3, background: { r: 48, g: 48, b: 48 } },
  })
    .png()
    .toBuffer();
  const overlay = await sharp({
    create: {
      width: mark.width,
      height: mark.height,
      channels: 3,
      background: mark.rgb,
    },
  })
    .png()
    .toBuffer();
  const buffer = await sharp(base)
    .composite([{ input: overlay, left: mark.x, top: mark.y }])
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

export function pngDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

export async function samplePixel(
  png: Uint8Array,
  x: number,
  y: number,
): Promise<{ r: number; g: number; b: number }> {
  const { data } = await sharp(Buffer.from(png))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const meta = await sharp(Buffer.from(png)).metadata();
  const width = meta.width ?? 0;
  const i = (y * width + x) * 4;
  return { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 };
}
