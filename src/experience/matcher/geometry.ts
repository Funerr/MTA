import type { BoundingBox } from '../schema/action';

export function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

export function boxCenter(box: BoundingBox): { x: number; y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

/** 像素中心落入标注框（半开区间，与整数 bbox 对齐）。 */
export function centerInside(center: { x: number; y: number }, box: BoundingBox): boolean {
  return (
    center.x >= box.x &&
    center.x < box.x + box.width &&
    center.y >= box.y &&
    center.y < box.y + box.height
  );
}

export function translateBox(box: BoundingBox, dx: number, dy: number): BoundingBox {
  return { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height };
}

export function isBoxInside(
  box: BoundingBox,
  width: number,
  height: number,
): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= width &&
    box.y + box.height <= height
  );
}

/** 目标可能出现的搜索占用区：历史框按半径扩边后夹紧到图像内。 */
export function searchOccupancy(
  bbox: BoundingBox,
  image: { readonly width: number; readonly height: number },
  radiusX: number,
  radiusY: number,
): BoundingBox {
  const x0 = Math.max(0, bbox.x - radiusX);
  const y0 = Math.max(0, bbox.y - radiusY);
  const x1 = Math.min(image.width, bbox.x + bbox.width + radiusX);
  const y1 = Math.min(image.height, bbox.y + bbox.height + radiusY);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}
