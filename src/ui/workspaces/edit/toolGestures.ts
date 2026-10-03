import type { Point, Rect, SelectionMode } from '../../../selection/types';

/** Decide before pointer capture: a menu must never start a tool gesture. */
export function canvasPointerIntent({ button, tool, space }: { button: number; tool: string; space: boolean }): 'context' | 'pan' | 'zoom' | 'tool' | 'ignore' {
  if (button === 2) return 'context';
  if (button !== 0 && button !== 1) return 'ignore';
  if (button === 1 || space || tool === 'hand') return 'pan';
  return tool === 'zoom' ? 'zoom' : 'tool';
}

export function resolveSelectionMode(configured: SelectionMode, shift: boolean, alt: boolean): SelectionMode {
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return configured;
}

export function constrainDragRect(start: Point, end: Point, ratio: number | null, docWidth: number, docHeight: number): Rect {
  const sx = Math.max(0, Math.min(docWidth, start.x));
  const sy = Math.max(0, Math.min(docHeight, start.y));
  const ex = Math.max(0, Math.min(docWidth, end.x));
  const ey = Math.max(0, Math.min(docHeight, end.y));
  const directionX = ex >= sx ? 1 : -1;
  const directionY = ey >= sy ? 1 : -1;
  let width = Math.abs(ex - sx);
  let height = Math.abs(ey - sy);
  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    height = width / ratio;
    const verticalRoom = directionY > 0 ? docHeight - sy : sy;
    if (height > verticalRoom) {
      height = verticalRoom;
      width = height * ratio;
    }
  }
  return {
    x: directionX > 0 ? sx : sx - width,
    y: directionY > 0 ? sy : sy - height,
    width,
    height,
  };
}

export function canClosePolygon(points: Point[]): boolean {
  return new Set(points.map(point => `${point.x},${point.y}`)).size >= 3;
}

export function isPointWithinLayer(
  point: Point,
  transform: { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number },
): boolean {
  const x2 = transform.x + transform.width * transform.scaleX;
  const y2 = transform.y + transform.height * transform.scaleY;
  return point.x >= Math.min(transform.x, x2)
    && point.x <= Math.max(transform.x, x2)
    && point.y >= Math.min(transform.y, y2)
    && point.y <= Math.max(transform.y, y2);
}
