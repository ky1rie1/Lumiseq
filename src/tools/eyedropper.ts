// src/tools/eyedropper.ts
//! Eyedropper Color Sampler Tool (Phase 6)
//! Samples pixel color from canvas or document with 1x1, 3x3, or 5x5 averaging.

import { RGB, HSL, rgbToHex, rgbToHsl, defaultColorState } from '../color/colorState';

export type EyedropperSampleSize = 1 | 3 | 5;

export interface SampledColorResult {
  x: number;
  y: number;
  sampleSize: EyedropperSampleSize;
  rgb: RGB;
  hex: string;
  hsl: HSL;
}

/** Coordinates address the containing document pixel, and windows stay centered at edges. */
export function colorSampleBounds(width: number, height: number, x: number, y: number, size: EyedropperSampleSize) {
  if (![x, y, width, height].every(Number.isFinite) || ![1, 3, 5].includes(size) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error('请在图像范围内取色。');
  }
  const pixelX = Math.floor(x), pixelY = Math.floor(y), half = Math.floor(size / 2);
  const left = Math.max(0, pixelX - half), top = Math.max(0, pixelY - half);
  return { x: pixelX, y: pixelY, left, top, width: Math.min(width, pixelX + half + 1) - left, height: Math.min(height, pixelY + half + 1) - top };
}

export class EyedropperTool {
  /**
   * Samples color at (x, y) from an ImageData or CanvasRenderingContext2D.
   */
  sampleColor(params: {
    source: ImageData | CanvasRenderingContext2D;
    x: number;
    y: number;
    sampleSize?: EyedropperSampleSize;
    updateColorState?: boolean;
    setAsBackground?: boolean;
  }): SampledColorResult {
    const sampleSize = params.sampleSize ?? 1;
    const source = params.source;
    const bounds = 'getImageData' in source ? source.canvas : source;
    const area = colorSampleBounds(bounds.width, bounds.height, params.x, params.y, sampleSize);
    const isContext = 'getImageData' in source;
    const imgData = isContext ? source.getImageData(area.left, area.top, area.width, area.height) : source;
    const data = imgData.data;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let coverage = 0;
    const left = isContext ? 0 : area.left, top = isContext ? 0 : area.top;
    for (let y = top; y < top + area.height; y++) {
      for (let x = left; x < left + area.width; x++) {
        const i = (y * imgData.width + x) * 4;
        const alpha = data[i + 3];
        sumR += data[i] * alpha;
        sumG += data[i + 1] * alpha;
        sumB += data[i + 2] * alpha;
        coverage += alpha;
      }
    }
    if (coverage === 0) throw new Error('该位置完全透明，无法取色。');
    const r = Math.round(sumR / coverage);
    const g = Math.round(sumG / coverage);
    const b = Math.round(sumB / coverage);

    const rgb: RGB = { r, g, b };
    const hex = rgbToHex(r, g, b);
    const hsl = rgbToHsl(r, g, b);

    if (params.updateColorState) {
      if (params.setAsBackground) {
        defaultColorState.setBackground(hex);
      } else {
        defaultColorState.setForeground(hex);
      }
    }

    return {
      x: area.x,
      y: area.y,
      sampleSize,
      rgb,
      hex,
      hsl,
    };
  }
}

export const defaultEyedropper = new EyedropperTool();
