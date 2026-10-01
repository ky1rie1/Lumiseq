import { expect, it } from 'vitest';
import { refineGuidedAlpha as refine, refineGuidedAlphaTiles } from './guidedAlpha';

function image(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(pixel(x, y), (y * width + x) * 4);
  return rgba;
}

it('uses a source RGB boundary to reduce a coarse mask ramp without thresholding it', () => {
  const rgba = image(64, 16, x => x < 32 ? [255, 0, 0, 255] : [0, 130, 0, 255]);
  const result = refine(new Uint8ClampedArray([0, 0, 255, 255]), 4, 1, rgba, 64, 16);
  // The existing resize produces 120/135 at this source edge.
  expect(result[8 * 64 + 31]).toBeLessThan(95);
  expect(result[8 * 64 + 32]).toBeGreaterThan(160);
  expect(result[8 * 64]).toBe(0);
  expect(result[8 * 64 + 63]).toBe(255);
});

it('clears fully transparent source pixels without multiplying partial source alpha twice', () => {
  const rgba = image(4, 1, x => [255, x * 50, 0, [0, 64, 128, 255][x]]);
  expect([...refine(new Uint8ClampedArray([255]), 1, 1, rgba, 4, 1)]).toEqual([0, 255, 255, 255]);
});

it('keeps a flat semi-transparent model region soft', () => {
  const rgba = image(32, 8, x => x < 16 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  expect([...refine(new Uint8ClampedArray([100, 100]), 2, 1, rgba, 32, 8)]).toEqual(Array(256).fill(100));
});

it('does not invent foreground where the model selected none', () => {
  const rgba = image(16, 4, x => [x % 2 * 255, 0, 255, 255]);
  expect([...refine(new Uint8ClampedArray([0]), 1, 1, rgba, 16, 4)]).toEqual(Array(64).fill(0));
});

it('agrees across tile boundaries and reads only a bounded halo', () => {
  const w = 301, h = 97;
  const rgba = image(w, h, (x, y) => x < 147 + Math.sin(y / 6) * 4 ? [220, 20, 40, 255] : [30, 180, 70, 255]);
  const low = new Uint8ClampedArray([0, 0, 0, 128, 255, 255, 255, 255]);
  const read = (x: number, y: number, tw: number, th: number) => {
    // radius is capped at 32; a 16px core reads at most 16+4*32.
    expect(tw).toBeLessThanOrEqual(144); expect(th).toBeLessThanOrEqual(144);
    const tile = new Uint8ClampedArray(tw * th * 4);
    for (let row = 0; row < th; row++) tile.set(rgba.subarray(((y + row) * w + x) * 4, ((y + row) * w + x + tw) * 4), row * tw * 4);
    return tile;
  };
  const small = refineGuidedAlphaTiles(low, 8, 1, w, h, read, 16);
  const normal = refine(low, 8, 1, rgba, w, h);
  let difference = 0;
  for (let i = 0; i < small.length; i++) difference = Math.max(difference, Math.abs(small[i] - normal[i]));
  expect(difference).toBeLessThanOrEqual(1);
});

it('rejects invalid dimensions and truncated guidance before returning a mask', () => {
  expect(() => refine(new Uint8ClampedArray([0]), 1, 1, new Uint8ClampedArray(4), 0, 1)).toThrow('尺寸');
  expect(() => refine(new Uint8ClampedArray([0]), 1, 1, new Uint8ClampedArray(4), 10000, 10000)).toThrow('4000');
  expect(() => refine(new Uint8ClampedArray([0]), 1, 1, new Uint8ClampedArray(3), 1, 1)).toThrow('尺寸');
  expect(() => refine(new Uint8ClampedArray(0), 1, 1, new Uint8ClampedArray(4), 1, 1)).toThrow('无效');
});
