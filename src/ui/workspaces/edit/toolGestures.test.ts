import { describe, expect, it } from 'vitest';
import { isPointWithinLayer } from './toolGestures';

describe('isPointWithinLayer', () => {
  const layer = { x: 20, y: 30, width: 100, height: 50, scaleX: 2, scaleY: 1 };

  it('allows dragging the selected layer only from its bounds', () => {
    expect(isPointWithinLayer({ x: 21, y: 31 }, layer)).toBe(true);
    expect(isPointWithinLayer({ x: 219, y: 79 }, layer)).toBe(true);
    expect(isPointWithinLayer({ x: 221, y: 31 }, layer)).toBe(false);
    expect(isPointWithinLayer({ x: 21, y: 81 }, layer)).toBe(false);
  });
});
