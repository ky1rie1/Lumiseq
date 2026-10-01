import { expect, it } from 'vitest';
import { resolveLayerMove } from './movePrecision';
import type { Layer } from '../../../types/edit';

const moving = { id: 'moving', visible: true, locked: false, transform: { x: 20, y: 20, width: 40, height: 40, rotation: 0, scaleX: 1, scaleY: 1 } } as Layer;

it('keeps snap sensitivity at 8 screen pixels across zoom levels', () => {
  const params = { layer: moving, x: 93, y: 70, canvasWidth: 100, canvasHeight: 100, otherLayers: [], enabled: true, bypass: false };
  expect(resolveLayerMove({ ...params, documentPixelsPerScreenPixel: 1 })?.x).toBe(100);
  expect(resolveLayerMove({ ...params, documentPixelsPerScreenPixel: 0.5 })?.x).toBe(93);
});

it('bypasses snapping with Alt and refuses a locked layer', () => {
  const params = { layer: moving, x: 97, y: 70, canvasWidth: 100, canvasHeight: 100, otherLayers: [], documentPixelsPerScreenPixel: 1, enabled: true };
  expect(resolveLayerMove({ ...params, bypass: true })).toEqual({ x: 97, y: 70, guides: [] });
  expect(resolveLayerMove({ ...params, layer: { ...moving, locked: true }, bypass: false })).toBeNull();
});

it('does not offer misleading axis guides for a rotated layer', () => {
  const rotated = { ...moving, transform: { ...moving.transform, rotation: 25 } };
  const result = resolveLayerMove({ layer: rotated, x: 97, y: 70, canvasWidth: 100, canvasHeight: 100, otherLayers: [], documentPixelsPerScreenPixel: 1, enabled: true, bypass: false });
  expect(result).toEqual({ x: 97, y: 70, guides: [] });
});
