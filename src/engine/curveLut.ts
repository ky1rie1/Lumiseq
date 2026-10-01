// src/engine/curveLut.ts
//! Monotonic Cubic Spline (Fritsch-Carlson) 1D LUT Generator for Tone Curves

import { Point2D } from '../types/common';
import { ToneCurves } from '../types/develop';

/**
 * Builds a monotonic 256 or 1024-entry 1D LUT from control points.
 * Guarantees zero overshoot/oscillations and no division by zero or NaN.
 */
export function buildMonotonicCurveLUT(
  points: Point2D[],
  lutSize: number = 256
): Float32Array {
  const lut = new Float32Array(lutSize);

  // Fallback to linear identity if insufficient points
  if (!points || points.length === 0) {
    for (let i = 0; i < lutSize; i++) lut[i] = i / (lutSize - 1);
    return lut;
  }

  // 1. Sort points by X and sanitize
  const pts: Point2D[] = points
    .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number' && isFinite(p.x) && isFinite(p.y))
    .map((p) => ({
      x: Math.max(0, Math.min(1, p.x)),
      y: Math.max(0, Math.min(1, p.y)),
    }))
    .sort((a, b) => a.x - b.x);

  // Ensure endpoints are present
  if (pts.length === 0) {
    for (let i = 0; i < lutSize; i++) lut[i] = i / (lutSize - 1);
    return lut;
  }

  if (pts[0].x > 0) {
    pts.unshift({ x: 0, y: pts[0].y });
  }
  if (pts[pts.length - 1].x < 1) {
    pts.push({ x: 1, y: pts[pts.length - 1].y });
  }

  // Remove duplicate X coordinates
  const uniquePts: Point2D[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x > uniquePts[uniquePts.length - 1].x + 1e-4) {
      uniquePts.push(pts[i]);
    }
  }

  const n = uniquePts.length;
  if (n === 1) {
    lut.fill(uniquePts[0].y);
    return lut;
  }

  // 2. Fritsch-Carlson Monotonic Cubic Spline Slopes
  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const m: number[] = new Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    dx[i] = uniquePts[i + 1].x - uniquePts[i].x;
    dy[i] = uniquePts[i + 1].y - uniquePts[i].y;
    m[i] = dy[i] / (dx[i] > 1e-5 ? dx[i] : 1e-5);
  }

  // Tangents at control points
  const d: number[] = new Array(n);
  d[0] = m[0];
  d[n - 1] = m[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      d[i] = 0;
    } else {
      d[i] = (m[i - 1] + m[i]) / 2;
    }
  }

  // Monotonicity adjustments
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(dy[i]) < 1e-5) {
      d[i] = 0;
      d[i + 1] = 0;
    } else {
      const alpha = d[i] / m[i];
      const beta = d[i + 1] / m[i];
      const dist = alpha * alpha + beta * beta;
      if (dist > 9) {
        const tau = 3 / Math.sqrt(dist);
        d[i] = tau * alpha * m[i];
        d[i + 1] = tau * beta * m[i];
      }
    }
  }

  // 3. Evaluate spline at each LUT step
  let curSegment = 0;
  for (let i = 0; i < lutSize; i++) {
    const x = i / (lutSize - 1);

    while (curSegment < n - 2 && x > uniquePts[curSegment + 1].x) {
      curSegment++;
    }

    const x0 = uniquePts[curSegment].x;
    const x1 = uniquePts[curSegment + 1].x;
    const y0 = uniquePts[curSegment].y;
    const y1 = uniquePts[curSegment + 1].y;
    const h = x1 - x0 > 1e-5 ? x1 - x0 : 1e-5;
    const t = Math.max(0, Math.min(1, (x - x0) / h));

    const h00 = (1 + 2 * t) * (1 - t) * (1 - t);
    const h10 = t * (1 - t) * (1 - t);
    const h01 = t * t * (3 - 2 * t);
    const h11 = t * t * (t - 1);

    const val = h00 * y0 + h10 * h * d[curSegment] + h01 * y1 + h11 * h * d[curSegment + 1];
    lut[i] = Math.max(0, Math.min(1, isFinite(val) ? val : x));
  }

  return lut;
}

/**
 * Generates an RGBA 256-entry 1D LUT texture buffer combining Master RGB and individual R, G, B channels.
 * Format: 256 x 1 RGBA Float32 or Uint8.
 */
export function buildCompositeToneCurveLUT(
  curves: ToneCurves,
  lutSize: number = 256
): Uint8Array {
  const masterLUT = buildMonotonicCurveLUT(curves.rgb, lutSize);
  const redLUT = buildMonotonicCurveLUT(curves.red, lutSize);
  const greenLUT = buildMonotonicCurveLUT(curves.green, lutSize);
  const blueLUT = buildMonotonicCurveLUT(curves.blue, lutSize);

  // RGBA buffer: R channel, G channel, B channel, A = 255
  const rgba = new Uint8Array(lutSize * 4);

  for (let i = 0; i < lutSize; i++) {
    // 1. Master curve maps input intensity
    const masterVal = masterLUT[i];
    const masterIdx = Math.max(0, Math.min(lutSize - 1, Math.round(masterVal * (lutSize - 1))));

    // 2. Individual channel curve maps master result
    const r = Math.round(redLUT[masterIdx] * 255);
    const g = Math.round(greenLUT[masterIdx] * 255);
    const b = Math.round(blueLUT[masterIdx] * 255);

    const offset = i * 4;
    rgba[offset] = Math.max(0, Math.min(255, r));
    rgba[offset + 1] = Math.max(0, Math.min(255, g));
    rgba[offset + 2] = Math.max(0, Math.min(255, b));
    rgba[offset + 3] = 255;
  }

  return rgba;
}
