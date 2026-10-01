import { Point2D } from '../types/common';
import { DevelopMask } from '../types/develop';

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? clamp01(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

/** Reproducible mask bitmap from resolution-independent image coordinates. */
export function rasterizeDevelopMask(mask: DevelopMask, width = 512, height = 512): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 16_777_216) {
    throw new RangeError('Invalid mask bitmap size');
  }
  const pixels = new Uint8ClampedArray(width * height);
  const { geometry } = mask;
  if (mask.kind === 'brush') {
    for (const stroke of mask.strokes ?? []) {
      const radius = Math.max(0.001, stroke.radius);
      const feather = clamp01(stroke.feather);
      for (let index = 0; index < stroke.points.length; index++) {
        const start = stroke.points[index];
        const end = stroke.points[Math.min(index + 1, stroke.points.length - 1)];
        const left = Math.max(0, Math.floor((Math.min(start.x, end.x) - radius) * width));
        const right = Math.min(width - 1, Math.ceil((Math.max(start.x, end.x) + radius) * width));
        const top = Math.max(0, Math.floor((Math.min(start.y, end.y) - radius) * height));
        const bottom = Math.min(height - 1, Math.ceil((Math.max(start.y, end.y) + radius) * height));
        for (let y = top; y <= bottom; y++) {
          for (let x = left; x <= right; x++) {
            const point = { x: (x + 0.5) / width, y: (y + 0.5) / height };
            const distance = distanceToSegment(point, start, end);
            const amount = 1 - clamp01((distance - radius * (1 - feather)) / Math.max(0.001, radius * feather));
            const offset = y * width + x;
            pixels[offset] = Math.max(pixels[offset], Math.round(clamp01(amount) * 255));
          }
        }
      }
    }
    return pixels;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const point = { x: (x + 0.5) / width, y: (y + 0.5) / height };
      let amount = 0;
      if (mask.kind === 'linear') {
        const start = geometry.start ?? { x: 0, y: 0 };
        const end = geometry.end ?? { x: 1, y: 0 };
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const denominator = dx * dx + dy * dy;
        amount = denominator > 0 ? clamp01(((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator) : 0;
      } else if (mask.kind === 'radial') {
        const center = geometry.center ?? { x: 0.5, y: 0.5 };
        const rx = Math.max(0.001, geometry.radiusX ?? 0.3);
        const ry = Math.max(0.001, geometry.radiusY ?? 0.3);
        const distance = Math.hypot((point.x - center.x) / rx, (point.y - center.y) / ry);
        const feather = clamp01(geometry.feather ?? 0.5);
        amount = 1 - clamp01((distance - (1 - feather)) / Math.max(0.001, feather));
      }
      pixels[y * width + x] = Math.round(clamp01(amount) * 255);
    }
  }
  return pixels;
}
