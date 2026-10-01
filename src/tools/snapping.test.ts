import { expect, it } from 'vitest';
import { SnappingEngine } from './snapping';
import type { Layer } from '../types/edit';

const layer = (id: string, x: number, y: number, width: number, height: number): Layer => ({
  id, name: id, type: 'image', visible: true, opacity: 1, blendMode: 'normal',
  sourceAssetId: id, naturalWidth: width, naturalHeight: height,
  transform: { x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1 },
});

it('snaps to canvas center and reports the actual alignment line', () => {
  const result = new SnappingEngine().snap({ target: { x: 47, y: 60, width: 100, height: 20 }, canvasWidth: 200, canvasHeight: 200, threshold: 5 });
  expect(result.x).toBe(50);
  expect(result.snappedX).toBe(true);
  expect(result.guides).toContainEqual({ orientation: 'vertical', position: 100 });
});

it('snaps one layer edge to another visible layer center', () => {
  const result = new SnappingEngine().snap({
    target: { x: 149, y: 123, width: 30, height: 20 }, canvasWidth: 500, canvasHeight: 500,
    otherLayers: [layer('reference', 100, 100, 100, 100)], threshold: 3,
  });
  expect(result.x).toBe(150);
  expect(result.guides).toContainEqual({ orientation: 'vertical', position: 150 });
});

it('uses a per-call threshold instead of global mutable sensitivity', () => {
  const engine = new SnappingEngine();
  const params = { target: { x: 94, y: 40, width: 50, height: 20 }, canvasWidth: 100, canvasHeight: 100 };
  expect(engine.snap({ ...params, threshold: 3 }).snappedX).toBe(false);
  expect(engine.snap({ ...params, threshold: 8 }).x).toBe(100);
});

it('ignores hidden and transformed reference layers', () => {
  const hidden = layer('hidden', 100, 100, 100, 100); hidden.visible = false;
  const rotated = layer('rotated', 100, 100, 100, 100); rotated.transform.rotation = 30;
  const result = new SnappingEngine().snap({ target: { x: 149, y: 150, width: 20, height: 20 }, canvasWidth: 500, canvasHeight: 500, otherLayers: [hidden, rotated], threshold: 3 });
  expect(result.snappedX).toBe(false);
  expect(result.snappedY).toBe(false);
});
