// src/color/hslOverlap.ts
//! 8-Channel Circular HSL Mixer with Smooth Overlap and 0°/360° Wrap-Around

import { ColorChannel } from '../types/common';
import { ChannelHSL } from '../types/develop';

export interface ChannelCenter {
  channel: ColorChannel;
  centerDeg: number;
  widthDeg: number;
}

// 8 nominal color channels with their center hues and influence widths (in degrees)
export const HSL_CHANNELS: ChannelCenter[] = [
  { channel: 'red', centerDeg: 0, widthDeg: 45 },
  { channel: 'orange', centerDeg: 30, widthDeg: 35 },
  { channel: 'yellow', centerDeg: 60, widthDeg: 40 },
  { channel: 'green', centerDeg: 120, widthDeg: 60 },
  { channel: 'aqua', centerDeg: 180, widthDeg: 50 },
  { channel: 'blue', centerDeg: 240, widthDeg: 50 },
  { channel: 'purple', centerDeg: 285, widthDeg: 45 },
  { channel: 'magenta', centerDeg: 325, widthDeg: 45 },
];

/**
 * Calculates shortest circular angular difference between two angles in [0, 360).
 */
export function circularAngleDiff(aDeg: number, bDeg: number): number {
  let diff = Math.abs(aDeg - bDeg) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

/**
 * Computes smooth weight for a given hue (in degrees 0-360) for each channel.
 * Uses a cosine bell curve so transitions between adjacent colors are C1-continuous.
 */
export function getChannelWeight(hueDeg: number, center: ChannelCenter): number {
  const dist = circularAngleDiff(hueDeg, center.centerDeg);
  if (dist >= center.widthDeg) return 0;
  // Cosine bell curve: 1.0 at dist=0, smoothly decreasing to 0.0 at dist=widthDeg
  return 0.5 * (1.0 + Math.cos((Math.PI * dist) / center.widthDeg));
}

export interface HSLAdjustmentDelta {
  hueDelta: number;         // in degrees (-180 to +180)
  saturationFactor: number; // multiplier (e.g. 1.2 = +20%)
  luminanceDelta: number;   // normalized delta (-1.0 to +1.0)
}

/**
 * Evaluates the blended HSL adjustment for a pixel with given hue (0-360).
 * Continuous everywhere — zero threshold jumps at channel boundaries.
 */
export function evaluateHSLAdjustment(
  hueDeg: number,
  hslSettings: Record<ColorChannel, ChannelHSL>
): HSLAdjustmentDelta {
  let totalWeight = 0;
  let weightedHueShift = 0;
  let weightedSatFactor = 0;
  let weightedLumShift = 0;

  for (const ch of HSL_CHANNELS) {
    const w = getChannelWeight(hueDeg, ch);
    if (w > 0) {
      const s = hslSettings[ch.channel] || { hue: 0, saturation: 0, luminance: 0 };
      totalWeight += w;
      // Hue adjustment: -100 to +100 maps to -30° to +30°
      weightedHueShift += w * (s.hue * 0.3);
      // Saturation factor: -100 to +100 maps to 0.0 to 2.0
      weightedSatFactor += w * (1.0 + s.saturation / 100);
      // Luminance delta: -100 to +100 maps to -0.5 to +0.5
      weightedLumShift += w * (s.luminance / 200);
    }
  }

  if (totalWeight < 1e-5) {
    return { hueDelta: 0, saturationFactor: 1.0, luminanceDelta: 0 };
  }

  return {
    hueDelta: weightedHueShift / totalWeight,
    saturationFactor: weightedSatFactor / totalWeight,
    luminanceDelta: weightedLumShift / totalWeight,
  };
}
