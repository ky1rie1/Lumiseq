import { describe, expect, it } from 'vitest';
import { alphaFromLogits, prepareInput, refineAlpha, paintAlpha, maskBounds, resizeSoftAlpha } from './cutoutMath';

describe('local cutout alpha processing', () => {
  it('resizes soft alpha with pixel-center sampling and preserves endpoint coverage', () => {
    expect([...resizeSoftAlpha(new Uint8ClampedArray([0, 255]), 2, 1, 4, 1)]).toEqual([0, 64, 191, 255]);
  });
  it('keeps soft alpha and rejects invalid model output rather than making an empty cutout', () => {
    expect([...alphaFromLogits(new Float32Array([-20, 0, 20]), 3, 1)]).toEqual([0, 128, 255]);
    expect(() => alphaFromLogits(new Float32Array([NaN]), 1, 1)).toThrow();
    expect(() => alphaFromLogits(new Float32Array([1]), 2, 1)).toThrow();
  });
  it('normalizes RGB in NCHW and composites transparent input onto white', () => {
    const output = prepareInput(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), 2, 1);
    expect(output).toHaveLength(6);
    expect(output[0]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(output[1]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(output[2]).toBeCloseTo(-0.456 / 0.224);
    expect(output[3]).toBeCloseTo((1 - 0.456) / 0.224);
  });
  it('identity refinement preserves soft edges; shift expands and contracts', () => {
    const input = new Uint8ClampedArray([0, 80, 255, 80, 0]);
    expect([...refineAlpha(input, 5, 1, { shift: 0, smooth: 0, feather: 0, contrast: 0 })]).toEqual([...input]);
    expect([...refineAlpha(input, 5, 1, { shift: 1, smooth: 0, feather: 0, contrast: 0 })]).toEqual([80, 255, 255, 255, 80]);
    expect([...refineAlpha(input, 5, 1, { shift: -1, smooth: 0, feather: 0, contrast: 0 })]).toEqual([0, 0, 80, 0, 0]);
    expect([...input]).toEqual([0, 80, 255, 80, 0]);
  });
  it('manual add/remove strokes change only pixels under the brush', () => {
    const mask = new Uint8ClampedArray(25);
    paintAlpha(mask, 5, 5, { x: 2.5, y: 2.5 }, 1, 'add');
    expect(mask[12]).toBe(255);
    expect(mask[0]).toBe(0);
    paintAlpha(mask, 5, 5, { x: 2.5, y: 2.5 }, 1, 'remove');
    expect(mask[12]).toBe(0);
  });
  it('finds bounds even when edges contain only partial coverage', () => {
    expect(maskBounds(new Uint8ClampedArray([0, 1, 0, 0, 100, 0]), 3, 2)).toEqual({ x: 1, y: 0, width: 1, height: 2 });
    expect(() => refineAlpha(new Uint8ClampedArray(3), 2, 2, { shift: 0, smooth: 0, feather: 0, contrast: 0 })).toThrow();
  });
});
