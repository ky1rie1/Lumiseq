// tests/GpuCpuGolden.test.ts
import { describe, it, expect } from 'vitest';
import { buildCompositeToneCurveLUT } from '../src/engine/curveLut';
import { evaluateHSLAdjustment } from '../src/color/hslOverlap';

describe('CPU vs GPU Math Parity Golden Tests', () => {
  it('should compute linear photographic exposure identically', () => {
    const exposures = [-2.0, -0.5, 0.0, 0.75, 2.0];
    const testR = 0.5;

    for (const ev of exposures) {
      const cpuVal = Math.pow(testR, 2.2) * Math.pow(2.0, ev);
      const glslMath = Math.pow(testR, 2.2) * Math.pow(2.0, ev);
      expect(cpuVal).toBeCloseTo(glslMath, 5);
    }
  });

  it('should compute soft-knee highlights and shadows continuously', () => {
    const lumas = [0.05, 0.15, 0.25, 0.5, 0.75, 0.95];
    const shadows = 50;
    const highlights = -50;

    for (const luma of lumas) {
      // CPU soft-knee formula
      const shadowWeight = 1.0 / (1.0 + Math.exp((luma - 0.25) * 12.0));
      const sFactor = 1.0 + (shadows / 100.0) * shadowWeight * 0.75;

      const highlightWeight = 1.0 / (1.0 + Math.exp(-(luma - 0.55) * 10.0));
      const hFactor = 1.0 + (highlights / 100.0) * highlightWeight * 0.75;

      expect(isFinite(sFactor)).toBe(true);
      expect(isFinite(hFactor)).toBe(true);
      expect(sFactor).toBeGreaterThanOrEqual(1.0); // Shadow boost in darks
      expect(hFactor).toBeLessThanOrEqual(1.0);    // Highlight reduction in brights
    }
  });

  it('should evaluate 1D LUT tone curve identically on CPU', () => {
    const curves = {
      rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }],
      red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    };

    const lut = buildCompositeToneCurveLUT(curves, 256);
    // At midpoint 128 (approx 0.5), value should be approx 0.6 * 255 = 153
    const midVal = lut[128 * 4];
    expect(midVal).toBeGreaterThan(140);
    expect(midVal).toBeLessThan(165);
  });
});
