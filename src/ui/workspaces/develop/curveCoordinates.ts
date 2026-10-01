import { Point2D } from '../../../types/common';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const padding = 12;

export function curveToCss(point: Point2D, width: number, height: number): Point2D {
  return { x: padding + point.x * (width - 2 * padding), y: padding + (1 - point.y) * (height - 2 * padding) };
}

export function cssToCurve(point: Point2D, width: number, height: number): Point2D {
  return { x: clamp((point.x - padding) / (width - 2 * padding)), y: clamp(1 - (point.y - padding) / (height - 2 * padding)) };
}

export function startCurvePointer(canvas: { getBoundingClientRect: () => Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>; focus: (options?: FocusOptions) => void }, client: Point2D) {
  // Hit test the geometry the user saw and keep focus from scrolling a clipped pane.
  const box = canvas.getBoundingClientRect();
  canvas.focus({ preventScroll: true });
  const css = { x: client.x - box.left, y: client.y - box.top };
  return { css, coord: cssToCurve(css, box.width, box.height), box };
}

export function hitCurvePoint(points: Point2D[], css: Point2D, width: number, height: number, radius = 10): number | null {
  let nearest: number | null = null;
  let distance = radius;
  points.forEach((point, index) => {
    const position = curveToCss(point, width, height);
    const candidate = Math.hypot(position.x - css.x, position.y - css.y);
    if (candidate <= distance) { distance = candidate; nearest = index; }
  });
  return nearest;
}

export function numericCurveValue(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 255) throw new RangeError('Curve coordinates must be between 0 and 255');
  return value / 255;
}

/** Rounded readouts must not quantize a coordinate the user left untouched. */
export function numericCurvePosition(point: Point2D, draft: { x: string; y: string }): Point2D {
  if (!draft.x.trim() || !draft.y.trim()) throw new RangeError('Curve coordinates cannot be empty');
  const x = numericCurveValue(Number(draft.x)), y = numericCurveValue(Number(draft.y));
  return { x: Number(draft.x) === Math.round(point.x * 255) ? point.x : x,
    y: Number(draft.y) === Math.round(point.y * 255) ? point.y : y };
}

export function moveCurvePoint(points: Point2D[], index: number, position: Point2D): Point2D[] {
  if (!points[index] || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new RangeError('Invalid curve point');
  let x = points[index].x;
  if (index > 0 && index < points.length - 1) {
    const left = points[index - 1].x;
    const right = points[index + 1].x;
    // A Y-only edit must preserve an already ordered X, including dense loaded points.
    if (position.x !== x || x <= left || x >= right) {
      const gap = Math.min(1 / 255, (right - left) / 3);
      x = Math.max(left + gap, Math.min(right - gap, position.x));
    }
  }
  return points.map((point, i) => i === index ? { x, y: clamp(position.y) } : { ...point });
}
