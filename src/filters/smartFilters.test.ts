import { describe, expect, it } from 'vitest';
import { applySmartFilterStack, createSmartFilter, normalizeSmartFilter } from './smartFilters';

describe('smart filter pixels', () => {
  it('keeps blue transparent edges blue at partial blur opacity', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0]);
    const result = applySmartFilterStack(pixels, 3, 1, [createSmartFilter('gaussian_blur', { opacity: 0.5, settings: { radius: 1 } })]);
    expect([...result.slice(0, 4)]).toEqual([0, 0, 255, 64]);
  });
  it('creates bounded defaults and clamps external settings', () => {
    const blur = createSmartFilter('gaussian_blur');
    expect(blur.enabled).toBe(true);
    expect(blur.opacity).toBe(1);
    expect(blur.settings).toEqual({ radius: 4 });

    expect(normalizeSmartFilter({ ...blur, opacity: 9, settings: { radius: 500 } })).toMatchObject({
      opacity: 1,
      settings: { radius: 64 },
    });
  });

  it('blurs alpha-aware colors without bleeding hidden RGB into the subject', () => {
    const input = new Uint8ClampedArray([
      255, 0, 0, 0,
      0, 0, 255, 255,
      255, 0, 0, 0,
    ]);
    const output = applySmartFilterStack(input, 3, 1, [
      { ...createSmartFilter('gaussian_blur'), settings: { radius: 1 } },
    ]);
    expect(output[4]).toBeLessThan(8);
    expect(output[6]).toBeGreaterThan(245);
    expect(output[7]).toBeGreaterThan(80);
  });

  it('sharpens local contrast and reduces isolated noise without changing alpha', () => {
    const impulse = new Uint8ClampedArray([
      100, 100, 100, 255,
      130, 130, 130, 255,
      100, 100, 100, 255,
    ]);
    const sharpened = applySmartFilterStack(impulse, 3, 1, [
      { ...createSmartFilter('unsharp_mask'), settings: { radius: 1, amount: 1, threshold: 0 } },
    ]);
    expect(sharpened[4]).toBeGreaterThan(130);
    expect(sharpened[7]).toBe(255);

    const denoised = applySmartFilterStack(impulse, 3, 1, [
      { ...createSmartFilter('noise_reduction'), settings: { radius: 1, strength: 1, preserveEdges: 0 } },
    ]);
    expect(denoised[4]).toBeLessThan(130);
    expect(denoised[4]).toBeGreaterThan(100);
    expect(denoised[7]).toBe(255);
  });

  it('skips disabled filters and blends filter opacity', () => {
    const input = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
    const disabled = { ...createSmartFilter('gaussian_blur'), enabled: false, settings: { radius: 1 } };
    expect(applySmartFilterStack(input, 3, 1, [disabled])).toEqual(input);

    const half = { ...disabled, enabled: true, opacity: 0.5 };
    const output = applySmartFilterStack(input, 3, 1, [half]);
    expect(output[4]).toBeLessThan(255);
    expect(output[4]).toBeGreaterThan(128);
  });
});
