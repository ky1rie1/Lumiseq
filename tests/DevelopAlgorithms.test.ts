// tests/DevelopAlgorithms.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateHSLAdjustment, circularAngleDiff } from '../src/color/hslOverlap';
import { buildMonotonicCurveLUT, buildCompositeToneCurveLUT } from '../src/engine/curveLut';
import { ChannelHSL } from '../src/types/develop';
import { ColorChannel } from '../src/types/common';

describe('Stage B Develop Algorithms Realism', () => {
  describe('HSL 8-Channel Circular Overlap & Continuity', () => {
    it('should compute circular angle differences with 0/360 wrap-around', () => {
      expect(circularAngleDiff(10, 20)).toBe(10);
      expect(circularAngleDiff(355, 5)).toBe(10);
      expect(circularAngleDiff(0, 360)).toBe(0);
      expect(circularAngleDiff(180, 0)).toBe(180);
    });

    it('should smoothly interpolate between adjacent color channels without step discontinuity', () => {
      const defaultHSL: Record<ColorChannel, ChannelHSL> = {
        red: { hue: 20, saturation: 0, luminance: 0 },     // Red shifts hue
        orange: { hue: -20, saturation: 0, luminance: 0 },  // Orange shifts opposite
        yellow: { hue: 0, saturation: 0, luminance: 0 },
        green: { hue: 0, saturation: 0, luminance: 0 },
        aqua: { hue: 0, saturation: 0, luminance: 0 },
        blue: { hue: 0, saturation: 0, luminance: 0 },
        purple: { hue: 0, saturation: 0, luminance: 0 },
        magenta: { hue: 0, saturation: 0, luminance: 0 },
      };

      // Test hues transitioning across the red-orange boundary: 10°, 15°, 20°, 25°
      const delta10 = evaluateHSLAdjustment(10, defaultHSL);
      const delta15 = evaluateHSLAdjustment(15, defaultHSL);
      const delta20 = evaluateHSLAdjustment(20, defaultHSL);
      const delta25 = evaluateHSLAdjustment(25, defaultHSL);

      // Hue delta must transition monotonically and continuously
      expect(delta10.hueDelta).toBeGreaterThan(delta15.hueDelta);
      expect(delta15.hueDelta).toBeGreaterThan(delta20.hueDelta);
      expect(delta20.hueDelta).toBeGreaterThan(delta25.hueDelta);

      // Delta step size between 14.9° and 15.1° should be tiny (< 0.1 deg)
      const stepA = evaluateHSLAdjustment(14.9, defaultHSL);
      const stepB = evaluateHSLAdjustment(15.1, defaultHSL);
      expect(Math.abs(stepA.hueDelta - stepB.hueDelta)).toBeLessThan(0.15);
    });

    it('should handle 0° / 360° boundary seamlessly for Red channel', () => {
      const hsl: Record<ColorChannel, ChannelHSL> = {
        red: { hue: 50, saturation: 30, luminance: 10 },
        orange: { hue: 0, saturation: 0, luminance: 0 },
        yellow: { hue: 0, saturation: 0, luminance: 0 },
        green: { hue: 0, saturation: 0, luminance: 0 },
        aqua: { hue: 0, saturation: 0, luminance: 0 },
        blue: { hue: 0, saturation: 0, luminance: 0 },
        purple: { hue: 0, saturation: 0, luminance: 0 },
        magenta: { hue: 0, saturation: 0, luminance: 0 },
      };

      const adj359 = evaluateHSLAdjustment(359.5, hsl);
      const adj001 = evaluateHSLAdjustment(0.5, hsl);

      expect(Math.abs(adj359.hueDelta - adj001.hueDelta)).toBeLessThan(0.2);
      expect(Math.abs(adj359.saturationFactor - adj001.saturationFactor)).toBeLessThan(0.01);
    });
  });

  describe('Tone Curve Monotonic Cubic Spline LUT', () => {
    it('should produce an identity LUT for default endpoints (0,0) and (1,1)', () => {
      const lut = buildMonotonicCurveLUT([{ x: 0, y: 0 }, { x: 1, y: 1 }], 256);
      expect(lut[0]).toBeCloseTo(0.0, 3);
      expect(lut[128]).toBeCloseTo(0.5, 2);
      expect(lut[255]).toBeCloseTo(1.0, 3);
    });

    it('should preserve monotonicity and avoid oscillations or NaN', () => {
      // S-curve points
      const points = [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.15 },
        { x: 0.75, y: 0.85 },
        { x: 1, y: 1 },
      ];

      const lut = buildMonotonicCurveLUT(points, 256);

      // Verify no NaN or Infinity
      for (let i = 0; i < 256; i++) {
        expect(isFinite(lut[i])).toBe(true);
        expect(lut[i]).toBeGreaterThanOrEqual(0.0);
        expect(lut[i]).toBeLessThanOrEqual(1.0);
        // Monotonic non-decreasing
        if (i > 0) {
          expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1e-4);
        }
      }
    });

    it('should correctly build composite RGBA texture buffer', () => {
      const curves = {
        rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }], // Red channel boost
        green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      };

      const rgba = buildCompositeToneCurveLUT(curves, 256);
      expect(rgba.length).toBe(256 * 4);

      // Midpoint red channel should be higher than green and blue
      const midOffset = 128 * 4;
      const r = rgba[midOffset];
      const g = rgba[midOffset + 1];
      const b = rgba[midOffset + 2];
      expect(r).toBeGreaterThan(g);
      expect(g).toBe(b);
    });
  });
});
