import sharp from 'sharp';
import type { BoundingBox } from '../../src/experience/schema/action';

export type RGB = { r: number; g: number; b: number };

export class RgbaCanvas {
  readonly data: Buffer;

  constructor(
    readonly width: number,
    readonly height: number,
    background: RGB,
  ) {
    this.data = Buffer.alloc(width * height * 4, 255);
    this.fill({ x: 0, y: 0, width, height }, background);
  }

  fill(box: BoundingBox, rgb: RGB): void {
    const x0 = Math.max(0, box.x);
    const y0 = Math.max(0, box.y);
    const x1 = Math.min(this.width, box.x + box.width);
    const y1 = Math.min(this.height, box.y + box.height);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * this.width + x) * 4;
        this.data[i] = rgb.r;
        this.data[i + 1] = rgb.g;
        this.data[i + 2] = rgb.b;
        this.data[i + 3] = 255;
      }
    }
  }

  glyph(box: BoundingBox, seed: number): void {
    const cols = 6;
    const rows = 6;
    const cellW = Math.max(1, Math.floor(box.width / cols));
    const cellH = Math.max(1, Math.floor(box.height / rows));
    let state = seed >>> 0;
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const on = (state & 3) !== 0;
        const x = box.x + gx * cellW;
        const y = box.y + gy * cellH;
        const width = gx === cols - 1 ? box.width - gx * cellW : cellW;
        const height = gy === rows - 1 ? box.height - gy * cellH : cellH;
        const rgb = on
          ? {
              r: 12 + (state & 47),
              g: 20 + ((state >>> 8) & 47),
              b: 180 + ((state >>> 16) & 47),
            }
          : { r: 252, g: 252, b: 255 };
        this.fill({ x, y, width, height }, rgb);
      }
    }
  }

  toggle(box: BoundingBox, on: boolean): void {
    this.fill(box, on ? { r: 46, g: 170, b: 80 } : { r: 168, g: 170, b: 176 });
    const knob = Math.max(8, Math.floor(box.height * 0.72));
    const pad = Math.floor((box.height - knob) / 2);
    const kx = on ? box.x + box.width - pad - knob : box.x + pad;
    this.fill(
      { x: kx, y: box.y + pad, width: knob, height: knob },
      { r: 255, g: 255, b: 255 },
    );
  }

  async toPng(): Promise<Uint8Array> {
    const buffer = await sharp(this.data, {
      raw: { width: this.width, height: this.height, channels: 4 },
    })
      .png({ compressionLevel: 6 })
      .toBuffer();
    return new Uint8Array(buffer);
  }
}
