import { describe, expect, it } from 'vitest';
import { estimateWaveletNoise, waveletDenoise } from './waveletDenoise';

// Box-Muller with a fixed LCG gives reproducible, actual random noise rather than checkerboard artifacts.
function noisyImage(width: number, height: number, edge = false): Float32Array {
  let state = 0x12345678;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + 1) / 4294967297; };
  const pixels = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const base = edge ? (x < width / 2 ? .1 : .8) : .35;
    for (let c = 0; c < 3; c++) pixels[(y * width + x) * 3 + c] = base + .02 * Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  }
  return pixels;
}

function fieldStats(pixels: Float32Array, width: number, x0: number, x1: number, y0: number, y1: number) {
  const values: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * width + x) * 3;
    values.push(.25 * pixels[i] + .5 * pixels[i + 1] + .25 * pixels[i + 2]);
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, variance };
}

describe('opponent wavelet denoise', () => {
  it('returns the exact input when both controls or all noise estimates are zero', () => {
    const pixels = Float32Array.from([-.1, .2, .3, .6, .8, 1.2]);
    expect(waveletDenoise(pixels, 2, 1, 0, 0, [.1, .1, .1])).toBe(pixels);
    expect(waveletDenoise(pixels, 2, 1, 100, 100, [0, 0, 0])).toBe(pixels);
  });

  it('preserves a constant HDR colored field and estimates no noise', () => {
    const pixels = Float32Array.from(Array.from({ length: 19 * 17 }, () => [1.6, .35, .05]).flat());
    expect(estimateWaveletNoise(pixels, 19, 17)).toEqual([0, 0, 0]);
    const result = waveletDenoise(pixels, 19, 17, 100, 100, [.02, .04, .04]);
    for (let i = 0; i < result.length; i++) expect(result[i]).toBeCloseTo(pixels[i], 5);
  });

  it('reduces independent Gaussian noise variance while preserving flat-field brightness', () => {
    const pixels = noisyImage(80, 64);
    const sigma = estimateWaveletNoise(pixels, 80, 64);
    expect(sigma[0]).toBeGreaterThan(.005);
    expect(sigma[0]).toBeLessThan(.015);
    expect(sigma[1]).toBeGreaterThan(.01);
    const result = waveletDenoise(pixels, 80, 64, 100, 100, sigma);
    const before = fieldStats(pixels, 80, 14, 66, 14, 50);
    const after = fieldStats(result, 80, 14, 66, 14, 50);
    expect(after.variance).toBeLessThan(before.variance * .25);
    expect(Math.abs(after.mean - before.mean)).toBeLessThan(.001);
  });

  it('retains the location and contrast of a strong edge while denoising each side', () => {
    const pixels = noisyImage(96, 64, true);
    const result = waveletDenoise(pixels, 96, 64, 100, 100, estimateWaveletNoise(pixels, 96, 64));
    const dark = fieldStats(result, 96, 16, 40, 14, 50);
    const light = fieldStats(result, 96, 56, 80, 14, 50);
    expect(light.mean - dark.mean).toBeGreaterThan(.68);
    const left = fieldStats(result, 96, 47, 48, 14, 50).mean;
    const right = fieldStats(result, 96, 48, 49, 14, 50).mean;
    expect(right - left).toBeGreaterThan(.62);
    // A global MAD spans two brightnesses; sqrt-domain dark-side noise is greater than its global median.
    expect(dark.variance).toBeLessThan(fieldStats(pixels, 96, 16, 40, 14, 50).variance * .4);
  });

  it('matches full-image interiors when stripes include the 14 pixel native halo', () => {
    const width = 43, height = 90, top = 14, bottom = 75;
    const pixels = noisyImage(width, height, true);
    const sigma: [number, number, number] = [.015, .03, .03];
    const full = waveletDenoise(pixels, width, height, 75, 95, sigma);
    const stripe = waveletDenoise(pixels.slice(top * width * 3, bottom * width * 3), width, bottom - top, 75, 95, sigma);
    for (let y = top + 14; y < bottom - 14; y++) for (let x = 0; x < width * 3; x++) {
      expect(stripe[(y - top) * width * 3 + x]).toBe(full[y * width * 3 + x]);
    }
  });

  it('rejects malformed image shapes before filtering', () => {
    expect(() => waveletDenoise(new Float32Array(6), 3, 1, 100, 100, [.1, .1, .1])).toThrow(RangeError);
    expect(() => estimateWaveletNoise(new Float32Array(6), -2, 1)).toThrow(RangeError);
  });

  it('sanitizes nonfinite samples and noise controls without producing NaNs', () => {
    const pixels = Float32Array.from([NaN, Infinity, -Infinity, .2, .3, .5]);
    const result = waveletDenoise(pixels, 2, 1, 100, 100, [.1, .1, .1]);
    expect(Array.from(result).every(Number.isFinite)).toBe(true);
    expect(estimateWaveletNoise(pixels, 2, 1).every(Number.isFinite)).toBe(true);
    expect(waveletDenoise(pixels, 2, 1, NaN, Infinity, [.1, .1, .1])).toBe(pixels);
  });

  it('keeps disabled opponent channels unchanged', () => {
    const pixels = noisyImage(25, 21);
    const lumaOnly = waveletDenoise(pixels, 25, 21, 100, 0, [.02, .04, .04]);
    const chromaOnly = waveletDenoise(pixels, 25, 21, 0, 100, [.02, .04, .04]);
    for (let i = 0; i < pixels.length; i += 3) {
      const original = Array.from(pixels.slice(i, i + 3), Math.sqrt);
      const luma = Array.from(lumaOnly.slice(i, i + 3), Math.sqrt);
      const chroma = Array.from(chromaOnly.slice(i, i + 3), Math.sqrt);
      expect(luma[0] - luma[1]).toBeCloseTo(original[0] - original[1], 6);
      expect(luma[2] - luma[1]).toBeCloseTo(original[2] - original[1], 6);
      expect(.25 * chroma[0] + .5 * chroma[1] + .25 * chroma[2]).toBeCloseTo(.25 * original[0] + .5 * original[1] + .25 * original[2], 6);
    }
  });

  it('handles fractional preview dilation without shifting constant color', () => {
    const pixels = new Float32Array(15 * 13 * 3).fill(.35);
    const result = waveletDenoise(pixels, 15, 13, 100, 100, [.02, .04, .04], .3);
    for (const value of result) expect(value).toBeCloseTo(.35, 6);
  });

  it('matches the hand-derived three-band clamp-border fixture used by Rust', () => {
    // sqrt values .1/.9 give lows .35/.65, .44375/.55625, .47890625/.52109375.
    const pixels = Float32Array.from([.01, .01, .01, .81, .81, .81]);
    const result = waveletDenoise(pixels, 2, 1, 100, 100, [.1, .1, .1]);
    for (let c = 0; c < 3; c++) {
      expect(result[c]).toBeCloseTo(.053882174118, 6);
      expect(result[c + 3]).toBeCloseTo(.589631491335, 6);
    }
    const sigma = estimateWaveletNoise(pixels, 2, 1);
    expect(sigma[0]).toBeCloseTo(.370650554626, 6);
    expect(sigma[1]).toBe(0); expect(sigma[2]).toBe(0);
  });
});
