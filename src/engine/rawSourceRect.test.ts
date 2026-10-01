import { expect, it } from 'vitest';
import { normalizeRawSourceRect } from './rawSourceRect';

it('maps a cropped RAW viewport into the full photo for masks and vignette', () => {
  expect(normalizeRawSourceRect({ x: 1500, y: 500, width: 1200, height: 800, sourceWidth: 6000, sourceHeight: 4000 }))
    .toEqual([0.25, 0.125, 0.2, 0.2]);
});

it('rejects a crop outside the native source', () => {
  expect(() => normalizeRawSourceRect({ x: 5999, y: 0, width: 2, height: 1, sourceWidth: 6000, sourceHeight: 4000 })).toThrow();
});
