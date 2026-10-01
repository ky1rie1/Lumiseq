import { describe, expect, it } from 'vitest';
import { planCutoutRegion, placeRegionMask } from './cutoutRegion';

describe('cutout source region', () => {
  it('focuses a transparent document on the actual layer pixels', () => {
    const alpha = new Uint8ClampedArray(20 * 10);
    for (let y = 3; y < 7; y++) for (let x = 8; x < 12; x++) alpha[y * 20 + x] = 255;
    const region = planCutoutRegion(alpha, 20, 10, 1000, 500);
    expect(region.x).toBeGreaterThan(0);
    expect(region.y).toBeGreaterThan(0);
    expect(region.width).toBeLessThan(1000);
    expect(region.height).toBeLessThan(500);
    expect(region.x).toBeLessThanOrEqual(400);
    expect(region.x + region.width).toBeGreaterThanOrEqual(600);
  });

  it('keeps opaque full-frame photos at their original size', () => {
    const alpha = new Uint8ClampedArray(20 * 10).fill(255);
    expect(planCutoutRegion(alpha, 20, 10, 1000, 500)).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
  });

  it('returns cropped inference to document coordinates', () => {
    const mask = Uint8ClampedArray.from([10, 20, 30, 40]);
    expect([...placeRegionMask(mask, { x: 1, y: 1, width: 2, height: 2 }, 4, 4)]).toEqual([
      0, 0, 0, 0,
      0, 10, 20, 0,
      0, 30, 40, 0,
      0, 0, 0, 0,
    ]);
  });
});
