import { describe, expect, it } from 'vitest';
import {
  smoothStep,
  length,
  roundedRectSDF,
  circleSDF,
  evaluateShapeSDF,
  generateDisplacementMapData,
  getDefaultDisplacementDataUrl,
} from '../src/ui/shared/liquidGlassShader';

describe('Liquid Glass Shader Engine', () => {
  it('smoothStep interpolates smoothly and clamps bounds', () => {
    expect(smoothStep(0, 1, -0.5)).toBe(0);
    expect(smoothStep(0, 1, 1.5)).toBe(1);
    expect(smoothStep(0, 1, 0.5)).toBe(0.5);
    expect(smoothStep(2, 2, 2)).toBe(0);
  });

  it('length calculates euclidean distance correctly', () => {
    expect(length(3, 4)).toBe(5);
    expect(length(0, 0)).toBe(0);
  });

  it('SDF formulas calculate distance from center and boundaries', () => {
    // Center point of rounded rectangle should have negative distance (inside)
    const centerDist = roundedRectSDF(0, 0, 0.4, 0.3, 0.1);
    expect(centerDist).toBeLessThan(0);

    // Far outside point should have positive distance
    const outsideDist = roundedRectSDF(1.0, 1.0, 0.4, 0.3, 0.1);
    expect(outsideDist).toBeGreaterThan(0);

    // Circle SDF
    expect(circleSDF(0, 0, 0.5)).toBe(-0.5);
    expect(circleSDF(0.5, 0, 0.5)).toBe(0);
  });

  it('evaluateShapeSDF produces accurate boundary distances for all shapes', () => {
    // 1. Pill shape (W = 4.0, H = 1.0, radius = 0.5)
    expect(evaluateShapeSDF(0, 0, 4.0, 1.0, 'pill')).toBe(-0.5); // Center
    expect(evaluateShapeSDF(0, 0.5, 4.0, 1.0, 'pill')).toBeCloseTo(0, 2); // Top edge
    expect(evaluateShapeSDF(0, -0.5, 4.0, 1.0, 'pill')).toBeCloseTo(0, 2); // Bottom edge
    expect(evaluateShapeSDF(2.0, 0, 4.0, 1.0, 'pill')).toBeCloseTo(0, 2); // Right end
    expect(evaluateShapeSDF(-2.0, 0, 4.0, 1.0, 'pill')).toBeCloseTo(0, 2); // Left end

    // 2. Circle shape (W = 1.0, H = 1.0, radius = 0.5)
    expect(evaluateShapeSDF(0, 0, 1.0, 1.0, 'circle')).toBe(-0.5);
    expect(evaluateShapeSDF(0.5, 0, 1.0, 1.0, 'circle')).toBeCloseTo(0, 2);
    expect(evaluateShapeSDF(0, 0.5, 1.0, 1.0, 'circle')).toBeCloseTo(0, 2);

    // 3. Rounded-rect shape (W = 2.0, H = 1.0, radius = 0.15)
    expect(evaluateShapeSDF(0, 0, 2.0, 1.0, 'rounded-rect', 0.15)).toBe(-0.5);
    expect(evaluateShapeSDF(1.0, 0, 2.0, 1.0, 'rounded-rect', 0.15)).toBeCloseTo(0, 2);
  });

  it('generateDisplacementMapData produces valid RG normal map data and maintains neutral invariants', () => {
    const w = 64;
    const h = 48;
    const result = generateDisplacementMapData(w, h, {
      pointerX: 0.5,
      pointerY: 0.5,
      pointerActive: true,
      pointerDown: false,
      ripplePhase: 1.0,
      rippleAmplitude: 0.8,
      flowTime: 0.5,
    }, {
      shape: 'rounded-rect',
      bevelWidth: 0.2,
    });

    expect(result.data.length).toBe(w * h * 4);
    expect(result.maxScale).toBeGreaterThan(0);

    // Check RGBA invariants: Alpha is 255, Blue is neutral 128
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i + 2]).toBe(128); // B neutral
      expect(result.data[i + 3]).toBe(255); // A opaque
      expect(result.data[i]).toBeGreaterThanOrEqual(0);
      expect(result.data[i]).toBeLessThanOrEqual(255);
      expect(result.data[i + 1]).toBeGreaterThanOrEqual(0);
      expect(result.data[i + 1]).toBeLessThanOrEqual(255);
    }
  });

  it('verifies physical optical lens refraction: flat center is neutral, bevel deflects along normal vectors', () => {
    const w = 60;
    const h = 40;
    const restingState = {
      pointerX: 0.5,
      pointerY: 0.5,
      pointerActive: false,
      pointerDown: false,
      ripplePhase: 0,
      rippleAmplitude: 0,
      flowTime: 0,
    };

    const { data } = generateDisplacementMapData(w, h, restingState, {
      width: 150,
      height: 100,
      shape: 'rounded-rect',
      bevelWidth: 0.22,
    });

    // Helper to get pixel (px, py)
    const getPixel = (px: number, py: number) => {
      const idx = (py * w + px) * 4;
      return {
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
        a: data[idx + 3],
      };
    };

    // 1. Center of the glass must be neutral (128, 128) - flat and undistorted for clear text
    const center = getPixel(Math.floor(w / 2), Math.floor(h / 2));
    expect(center.r).toBe(128);
    expect(center.g).toBe(128);

    // 2. Right edge bevel should deflect outward to the right (R > 128, G ~ 128)
    const rightBevel = getPixel(w - 3, Math.floor(h / 2));
    expect(rightBevel.r).toBeGreaterThan(128);
    expect(Math.abs(rightBevel.g - 128)).toBeLessThanOrEqual(5);

    // 3. Left edge bevel should deflect outward to the left (R < 128, G ~ 128)
    const leftBevel = getPixel(2, Math.floor(h / 2));
    expect(leftBevel.r).toBeLessThan(128);
    expect(Math.abs(leftBevel.g - 128)).toBeLessThanOrEqual(5);

    // 4. Top edge bevel should deflect outward upwards (G > 128, R ~ 128)
    const topBevel = getPixel(Math.floor(w / 2), h - 3);
    expect(topBevel.g).toBeGreaterThan(128);
    expect(Math.abs(topBevel.r - 128)).toBeLessThanOrEqual(5);

    // 5. Bottom edge bevel should deflect outward downwards (G < 128, R ~ 128)
    const bottomBevel = getPixel(Math.floor(w / 2), 2);
    expect(bottomBevel.g).toBeLessThan(128);
    expect(Math.abs(bottomBevel.r - 128)).toBeLessThanOrEqual(5);
  });

  it('pill shape correctly provides bevel curvature on both top/bottom and left/right ends', () => {
    const w = 100;
    const h = 40;
    const { data } = generateDisplacementMapData(w, h, {
      pointerX: 0.5,
      pointerY: 0.5,
      pointerActive: false,
      pointerDown: false,
      ripplePhase: 0,
      rippleAmplitude: 0,
      flowTime: 0,
    }, {
      width: 400,
      height: 80,
      shape: 'pill',
      bevelWidth: 0.25,
    });

    const getPixel = (px: number, py: number) => {
      const idx = (py * w + px) * 4;
      return { r: data[idx], g: data[idx + 1] };
    };

    // Center is neutral
    const center = getPixel(50, 20);
    expect(center.r).toBe(128);
    expect(center.g).toBe(128);

    // Top and bottom edges must be deflected
    const topEdge = getPixel(50, h - 3);
    const bottomEdge = getPixel(50, 2);
    expect(topEdge.g).toBeGreaterThan(128);
    expect(bottomEdge.g).toBeLessThan(128);

    // Left and right semicircular ends must be deflected
    const rightEnd = getPixel(w - 3, 20);
    const leftEnd = getPixel(2, 20);
    expect(rightEnd.r).toBeGreaterThan(128);
    expect(leftEnd.r).toBeLessThan(128);
  });

  it('circle shape has radial symmetry', () => {
    const size = 50;
    const { data } = generateDisplacementMapData(size, size, {
      pointerX: 0.5,
      pointerY: 0.5,
      pointerActive: false,
      pointerDown: false,
      ripplePhase: 0,
      rippleAmplitude: 0,
      flowTime: 0,
    }, {
      width: 100,
      height: 100,
      shape: 'circle',
      bevelWidth: 0.3,
    });

    const getPixel = (px: number, py: number) => {
      const idx = (py * size + px) * 4;
      return { r: data[idx], g: data[idx + 1] };
    };

    expect(getPixel(25, 25).r).toBe(128);
    expect(getPixel(25, 25).g).toBe(128);

    expect(getPixel(size - 3, 25).r).toBeGreaterThan(128);
    expect(getPixel(2, 25).r).toBeLessThan(128);
    expect(getPixel(25, size - 3).g).toBeGreaterThan(128);
    expect(getPixel(25, 2).g).toBeLessThan(128);
  });

  it('pointer ripples create fluid deflection wave around mouse coordinates', () => {
    const w = 40;
    const h = 40;
    const resting = generateDisplacementMapData(w, h, {
      pointerX: 0.5,
      pointerY: 0.5,
      pointerActive: false,
      pointerDown: false,
      ripplePhase: 0,
      rippleAmplitude: 0,
      flowTime: 0,
    }, { shape: 'rounded-rect' });

    const rippling = generateDisplacementMapData(w, h, {
      pointerX: 0.5,
      pointerY: 0.5,
      pointerActive: true,
      pointerDown: false,
      ripplePhase: 1.2,
      rippleAmplitude: 0.8,
      flowTime: 0,
    }, { shape: 'rounded-rect' });

    // Center pixel should be affected by ripple
    const midIdx = (20 * w + 20) * 4;
    expect(resting.data[midIdx]).toBe(128);
    expect(rippling.maxScale).toBeGreaterThan(resting.maxScale);
  });

  it('getDefaultDisplacementDataUrl executes cleanly without error', () => {
    const url = getDefaultDisplacementDataUrl();
    expect(typeof url).toBe('string');
  });
});
