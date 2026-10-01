import { describe, expect, it } from 'vitest';
import { analyzeHaze, applyHaze, type HazeAnalysis } from './hazeAnalysis';

type RGB = [number, number, number];
function fixture(width: number, height: number, at: (x: number, y: number) => RGB) {
  const pixels = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(at(x, y), (y * width + x) * 3);
  return pixels;
}
const fog: RGB = [.64, .78, .9];
const mix = (truth: RGB, t: number): RGB => truth.map((v, c) => v * t + fog[c] * (1 - t)) as RGB;
const error = (a: RGB, b: RGB) => a.reduce((sum, v, c) => sum + (v - b[c]) ** 2, 0);

describe('whole-image guided haze analysis', () => {
  it('estimates colored airlight despite a clipped white background and sparse bright point', () => {
    const pixels = fixture(64, 64, (x, y) => x > 55 ? [1, 1, 1] : x === 20 && y === 20 ? [.99, .99, .99] : y < 12 ? fog : mix([.06, .18, .02], .6));
    const analysis = analyzeHaze(pixels, 64, 64);
    fog.forEach((v, c) => expect(analysis.atmosphere[c]).toBeCloseTo(v, 5));
  });

  it('restores colored fog closer to scene RGB while respecting a clear dark foreground', () => {
    const truth: RGB = [.06, .18, .02];
    const pixels = fixture(64, 64, (x, y) => y < 12 ? fog : x < 12 ? [0, .02, .01] : mix(truth, .6));
    const analysis = analyzeHaze(pixels, 64, 64);
    const input = mix(truth, .6);
    expect(error(applyHaze(input, analysis, .65, .65, 100), truth)).toBeLessThan(error(input, truth) * .1);
    const clear = applyHaze([0, .02, .01], analysis, .05, .8, 100);
    clear.forEach((v, c) => expect(v).toBeCloseTo([0, .02, .01][c], 4));
  });

  it('adds the measured colored atmosphere for negative strength and keeps zero exact', () => {
    const analysis = analyzeHaze(fixture(8, 8, () => fog), 8, 8);
    const rgb: RGB = [.1, .2, .3];
    expect(applyHaze(rgb, analysis, .1, .9, 0)).toEqual(rgb);
    const added = applyHaze(rgb, analysis, .1, .9, -100);
    [.2404, .3508, .456].forEach((v, c) => expect(added[c]).toBeCloseTo(v, 6));
  });

  it('samples a top-origin asymmetric profile with GL texel centers and clamp bilinear', () => {
    const analysis: HazeAnalysis = { version: 1, width: 2, height: 2, atmosphere: [1, 1, 1], coefficients: [0, 0, 0, .2, 0, .4, 0, .8] };
    const rgb: RGB = [.5, .5, .5];
    expect(applyHaze(rgb, analysis, .25, .25, 100)).toEqual(rgb);
    // Center has b=(0+.2+.4+.8)/4=.35 and t=1-.9*.35=.685.
    expect(applyHaze(rgb, analysis, .5, .5, 100)[0]).toBeCloseTo(.2700729927, 8);
    expect(applyHaze(rgb, analysis, -1, 2, 100)[0]).toBeCloseTo(.21875, 8);
    expect(applyHaze(rgb, analysis, .75, .25, 100)[0]).toBeCloseTo(.3902439024, 8);
  });

  it('matches independently derived guided coefficients after both averaging passes', () => {
    const analysis = analyzeHaze(Float32Array.from([.5, .5, .5, .6, .6, .6, .7, .7, .7]), 3, 1);
    // r=1, A=.7, p=[5/7,5/7,6/7]. The local slopes are
    // [0,(1/210)/(1/150+.0001),(1/280)/(.0025+.0001)], then averaged again.
    const expected = [.3518648839, .5269763078, .6924520471, .3156032528, 1.0386780707, .1162620221];
    expected.forEach((v, i) => expect(analysis.coefficients[i]).toBeCloseTo(v, 5));
  });

  it('preserves HDR airlight and never clips the recovered scene values', () => {
    const analysis = analyzeHaze(fixture(16, 8, () => [1.4, 1.6, 2]), 16, 8);
    [1.4, 1.6, 2].forEach((v, c) => expect(analysis.atmosphere[c]).toBeCloseTo(v, 5));
    expect(applyHaze([3, 3, 3], analysis, .5, .5, 100)[0]).toBeGreaterThan(3);
  });

  it('keeps black finite and unchanged for both strength directions', () => {
    const analysis = analyzeHaze(new Float32Array(12), 2, 2);
    expect(analysis.coefficients.every(Number.isFinite)).toBe(true);
    for (const amount of [-100, 0, 100]) expect(applyHaze([0, 0, 0], analysis, .5, .5, amount)).toEqual([0, 0, 0]);
  });

  it('bounds the coarse grid without changing a uniform scene atmosphere', () => {
    const analysis = analyzeHaze(fixture(512, 128, () => fog), 512, 128);
    expect([analysis.width, analysis.height]).toEqual([256, 64]);
    expect(analysis.coefficients).toHaveLength(256 * 64 * 2);
    fog.forEach((v, c) => expect(analysis.atmosphere[c]).toBeCloseTo(v, 5));
  });

  it('rejects malformed, unbounded and nonfinite analysis buffers', () => {
    expect(() => analyzeHaze(new Float32Array(3), 2, 2)).toThrow();
    expect(() => analyzeHaze(new Float32Array(3), 1.5, 1)).toThrow();
    expect(() => analyzeHaze(new Float32Array(3), 0, 1)).toThrow();
    expect(() => analyzeHaze(new Float32Array(3).fill(NaN), 1, 1)).toThrow();
    expect(() => analyzeHaze(new Float32Array(65537 * 3), 65537, 1)).toThrow();
  });
});
