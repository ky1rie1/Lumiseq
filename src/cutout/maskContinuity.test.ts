import { describe, expect, it } from 'vitest';
import { repairMaskGaps } from './maskContinuity';

describe('mask continuity', () => {
  it('bridges a narrow missed strip only when its source color matches the subject', () => {
    const mask = Uint8ClampedArray.from([0, 230, 230, 0, 0, 230, 230, 0]);
    const rgba = new Uint8ClampedArray(8 * 4);
    for (let x = 0; x < 8; x++) {
      const color = x === 3 ? 204 : x === 4 ? 20 : 210;
      rgba.set([color, 30, 40, 255], x * 4);
    }
    const result = repairMaskGaps(mask, rgba, 8, 1, 3);
    expect(result[3]).toBeGreaterThanOrEqual(128);
    expect(result[4]).toBe(0);
    expect(result[0]).toBe(0);
    expect(result[7]).toBe(0);
  });

  it('does not join separated subjects across transparent pixels', () => {
    const mask = Uint8ClampedArray.from([230, 0, 230]);
    const rgba = Uint8ClampedArray.from([200, 30, 40, 255, 200, 30, 40, 0, 200, 30, 40, 255]);
    expect(repairMaskGaps(mask, rgba, 3, 1, 2)[1]).toBe(0);
  });

  it('recovers a larger same-colour body section missed by the model without taking a contrasting background', () => {
    const width = 30, height = 12;
    const mask = new Uint8ClampedArray(width * height);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const subject = y >= 2 && y <= 8 && x >= 5 && x <= 24;
      const pixel = y * width + x;
      rgba.set(subject ? [210, 35, 40, 255] : [30, 180, 45, 255], pixel * 4);
      if (subject && (x <= 9 || x >= 20)) mask[pixel] = 240;
    }
    const result = repairMaskGaps(mask, rgba, width, height, 3);
    expect(result[5 * width + 15]).toBeGreaterThanOrEqual(128);
    expect(result[5 * width + 4]).toBe(0);
    expect(result[1 * width + 15]).toBe(0);
  });

  it('does not expand through a background with the same colour distribution', () => {
    const width = 50, height = 20;
    const mask = new Uint8ClampedArray(width * height);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < mask.length; i++) rgba.set([210, 35, 40, 255], i * 4);
    for (let y = 1; y <= 18; y++) for (let x = 2; x <= 47; x++) if (x < 24 || x > 29) mask[y * width + x] = 240;
    const result = repairMaskGaps(mask, rgba, width, height, 3);
    expect(result[10 * width + 26]).toBe(0);
  });
});
