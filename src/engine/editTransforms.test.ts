import { expect, it } from 'vitest';
import { layerMatrix, linkedMaskTransform, multiplyMatrix } from './editTransforms';
import { createTextLayer } from '../document/EditDocument';
import type { LayerMask } from '../types/edit';
const baseMask: LayerMask = { id: 'mask', assetId: 'asset', enabled: true, linked: true, density: 1, feather: 0 };

it('moves and resizes a linked mask with a rotated layer inside a moved group', () => {
  const layer = createTextLayer({ text: 'linked', x: 3, y: 4 });
  layer.transform.width = 20; layer.transform.height = 10; layer.transform.rotation = 90;
  const parent = { ...layer.transform, x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const original = multiplyMatrix(layerMatrix(parent), layerMatrix(layer.transform));
  const mask: LayerMask = { ...baseMask, referenceTransform: original, referenceWidth: 20, referenceHeight: 10 };
  parent.x = 30;
  layer.transform.x = 8; layer.transform.y = 6;
  layer.transform.width = 40; layer.transform.height = 30;
  const current = multiplyMatrix(layerMatrix(parent), layerMatrix(layer.transform));
  const mapping = linkedMaskTransform(current, mask, layer.transform);
  const map = (x: number, y: number) => [mapping[0]*x+mapping[2]*y+mapping[4], mapping[1]*x+mapping[3]*y+mapping[5]];
  // Original document corners of the 90-degree rotated text box now follow translation and 2x/3x resize.
  expect(map(13, 4)[0]).toBeCloseTo(38); expect(map(13, 4)[1]).toBeCloseTo(6);
  expect(map(13, 24)[0]).toBeCloseTo(38); expect(map(13, 24)[1]).toBeCloseTo(46);
  expect(map(3, 4)[0]).toBeCloseTo(8); expect(map(3, 4)[1]).toBeCloseTo(6);
});

it('keeps legacy and explicitly unlinked document masks in document coordinates', () => {
  const layer = createTextLayer({ text: 'legacy' });
  const world = layerMatrix(layer.transform);
  expect(linkedMaskTransform(world, baseMask, layer.transform)).toEqual([1,0,0,1,0,0]);
  expect(linkedMaskTransform(world, { ...baseMask, linked: false, referenceTransform: world, referenceWidth: 400, referenceHeight: 80 }, layer.transform)).toEqual([1,0,0,1,0,0]);
});

it('rejects corrupt linked mask metadata rather than producing nonfinite drawing coordinates', () => {
  const layer = createTextLayer({ text: 'bad' });
  const mask: LayerMask = { ...baseMask, referenceTransform: [1,0,0,1,NaN,0], referenceWidth: 0, referenceHeight: 80 };
  expect(() => linkedMaskTransform([1,0,0,1,0,0], mask, layer.transform)).toThrow();
  expect(() => linkedMaskTransform([1,0,0,1,0,0], { ...baseMask, referenceTransform: [1,0,0,1,0,0], referenceWidth: Number.MIN_VALUE, referenceHeight: 80 }, layer.transform)).toThrow();
});
