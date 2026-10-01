// src/engine/blendModes.ts
//! Comprehensive Blend Modes Engine (Phase 6)
//! Implements exact Photoshop standard compositing math for all 16 blend modes.

import { BlendMode } from '../types/edit';

export type RGB = [number, number, number];

/**
 * Composite a source RGB pixel over destination RGB pixel with blend mode and opacity.
 * All RGB channel inputs and outputs are normalized to [0, 1].
 */
export function blendPixel(src: RGB, dst: RGB, mode: BlendMode, opacity: number = 1.0): RGB {
  const [sR, sG, sB] = src;
  const [dR, dG, dB] = dst;

  let bR = sR;
  let bG = sG;
  let bB = sB;

  switch (mode) {
    case 'normal':
      bR = sR;
      bG = sG;
      bB = sB;
      break;

    case 'multiply':
      bR = sR * dR;
      bG = sG * dG;
      bB = sB * dB;
      break;

    case 'screen':
      bR = 1 - (1 - sR) * (1 - dR);
      bG = 1 - (1 - sG) * (1 - dG);
      bB = 1 - (1 - sB) * (1 - dB);
      break;

    case 'overlay':
      bR = dR < 0.5 ? 2 * dR * sR : 1 - 2 * (1 - dR) * (1 - sR);
      bG = dG < 0.5 ? 2 * dG * sG : 1 - 2 * (1 - dG) * (1 - sG);
      bB = dB < 0.5 ? 2 * dB * sB : 1 - 2 * (1 - dB) * (1 - sB);
      break;

    case 'darken':
      bR = Math.min(sR, dR);
      bG = Math.min(sG, dG);
      bB = Math.min(sB, dB);
      break;

    case 'lighten':
      bR = Math.max(sR, dR);
      bG = Math.max(sG, dG);
      bB = Math.max(sB, dB);
      break;

    case 'color-dodge':
      bR = sR >= 1 ? 1 : Math.min(1, dR / (1 - sR));
      bG = sG >= 1 ? 1 : Math.min(1, dG / (1 - sG));
      bB = sB >= 1 ? 1 : Math.min(1, dB / (1 - sB));
      break;

    case 'color-burn':
      bR = sR <= 0 ? 0 : Math.max(0, 1 - (1 - dR) / sR);
      bG = sG <= 0 ? 0 : Math.max(0, 1 - (1 - dG) / sG);
      bB = sB <= 0 ? 0 : Math.max(0, 1 - (1 - dB) / sB);
      break;

    case 'hard-light':
      bR = sR < 0.5 ? 2 * sR * dR : 1 - 2 * (1 - sR) * (1 - dR);
      bG = sG < 0.5 ? 2 * sG * dG : 1 - 2 * (1 - sG) * (1 - dG);
      bB = sB < 0.5 ? 2 * sB * dB : 1 - 2 * (1 - sB) * (1 - dB);
      break;

    case 'soft-light':
      bR = sR < 0.5 ? dR - (1 - 2 * sR) * dR * (1 - dR) : dR + (2 * sR - 1) * ((dR <= 0.25 ? ((16 * dR - 12) * dR + 4) * dR : Math.sqrt(dR)) - dR);
      bG = sG < 0.5 ? dG - (1 - 2 * sG) * dG * (1 - dG) : dG + (2 * sG - 1) * ((dG <= 0.25 ? ((16 * dG - 12) * dG + 4) * dG : Math.sqrt(dG)) - dG);
      bB = sB < 0.5 ? dB - (1 - 2 * sB) * dB * (1 - dB) : dB + (2 * sB - 1) * ((dB <= 0.25 ? ((16 * dB - 12) * dB + 4) * dB : Math.sqrt(dB)) - dB);
      break;

    case 'difference':
      bR = Math.abs(dR - sR);
      bG = Math.abs(dG - sG);
      bB = Math.abs(dB - sB);
      break;

    case 'exclusion':
      bR = dR + sR - 2 * dR * sR;
      bG = dG + sG - 2 * dG * sG;
      bB = dB + sB - 2 * dB * sB;
      break;

    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity': {
      const srcHsl = rgbToHsl(sR, sG, sB);
      const dstHsl = rgbToHsl(dR, dG, dB);
      let outH = dstHsl[0];
      let outS = dstHsl[1];
      let outL = dstHsl[2];

      if (mode === 'hue') {
        outH = srcHsl[0];
      } else if (mode === 'saturation') {
        outS = srcHsl[1];
      } else if (mode === 'color') {
        outH = srcHsl[0];
        outS = srcHsl[1];
      } else if (mode === 'luminosity') {
        outL = srcHsl[2];
      }
      const [r, g, b] = hslToRgb(outH, outS, outL);
      bR = r;
      bG = g;
      bB = b;
      break;
    }
  }

  // Linear interpolation with layer opacity
  return [
    dR + (bR - dR) * opacity,
    dG + (bG - dG) * opacity,
    dB + (bB - dB) * opacity,
  ];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    return [l, l, l];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);

  return [r, g, b];
}

/**
 * Composite entire source RGBA ImageData buffer over destination RGBA ImageData buffer.
 */
export function blendImageData(
  srcData: Uint8ClampedArray,
  dstData: Uint8ClampedArray,
  mode: BlendMode,
  opacity: number = 1.0,
  maskData?: Uint8ClampedArray
): void {
  const len = dstData.length;
  for (let i = 0; i < len; i += 4) {
    const srcA = srcData[i + 3] / 255;
    if (srcA <= 0) continue;

    const maskWeight = maskData ? maskData[i] / 255 : 1.0;
    const effectiveAlpha = srcA * opacity * maskWeight;
    if (effectiveAlpha <= 0) continue;

    const srcR = srcData[i] / 255;
    const srcG = srcData[i + 1] / 255;
    const srcB = srcData[i + 2] / 255;

    const dstR = dstData[i] / 255;
    const dstG = dstData[i + 1] / 255;
    const dstB = dstData[i + 2] / 255;

    const [outR, outG, outB] = blendPixel([srcR, srcG, srcB], [dstR, dstG, dstB], mode, effectiveAlpha);

    dstData[i] = Math.round(Math.min(255, Math.max(0, outR * 255)));
    dstData[i + 1] = Math.round(Math.min(255, Math.max(0, outG * 255)));
    dstData[i + 2] = Math.round(Math.min(255, Math.max(0, outB * 255)));
    dstData[i + 3] = Math.max(dstData[i + 3], Math.round(effectiveAlpha * 255));
  }
}

/**
 * Convenience helper: Blend single top RGBA color over bottom RGBA color.
 */
export function blendColors(
  top: { r: number; g: number; b: number; a?: number },
  bottom: { r: number; g: number; b: number; a?: number },
  mode: BlendMode,
  opacity: number = 1.0
): { r: number; g: number; b: number; a: number } {
  const [r, g, b] = blendPixel(
    [top.r / 255, top.g / 255, top.b / 255],
    [bottom.r / 255, bottom.g / 255, bottom.b / 255],
    mode,
    (top.a ?? 1.0) * opacity
  );
  return {
    r: Math.round(Math.min(255, Math.max(0, r * 255))),
    g: Math.round(Math.min(255, Math.max(0, g * 255))),
    b: Math.round(Math.min(255, Math.max(0, b * 255))),
    a: top.a ?? 1.0,
  };
}
