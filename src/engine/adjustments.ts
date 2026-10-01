// src/engine/adjustments.ts
//! Parametric Adjustment Layer Processing Engine (Phase 6)
//! Evaluates Exposure, Brightness/Contrast, Hue/Saturation, Color Balance,
//! Black & White, Levels, and Curves transformations.

import {
  AdjustmentSettings,
  ExposureAdjustmentSettings,
  BrightnessContrastSettings,
  HueSaturationSettings,
  ColorBalanceSettings,
  BlackAndWhiteSettings,
  LevelsSettings,
  CurvesSettings,
  CurvePoint,
} from '../types/edit';
import { rgbToHsl, hslToRgb } from './blendModes';

export class AdjustmentEngine {
  /**
   * Applies adjustment transform in-place on RGBA Uint8ClampedArray pixel buffer.
   */
  static apply(data: Uint8ClampedArray, settings: AdjustmentSettings, mask?: Uint8ClampedArray): void {
    switch (settings.type) {
      case 'exposure':
        this.applyExposure(data, settings.values, mask);
        break;
      case 'brightness_contrast':
        this.applyBrightnessContrast(data, settings.values, mask);
        break;
      case 'hue_saturation':
        this.applyHueSaturation(data, settings.values, mask);
        break;
      case 'color_balance':
        this.applyColorBalance(data, settings.values, mask);
        break;
      case 'black_and_white':
        this.applyBlackAndWhite(data, settings.values, mask);
        break;
      case 'levels':
        this.applyLevels(data, settings.values, mask);
        break;
      case 'curves':
        this.applyCurves(data, settings.values, mask);
        break;
    }
  }

  // --- 1. Exposure ---
  static applyExposure(data: Uint8ClampedArray, s: ExposureAdjustmentSettings, mask?: Uint8ClampedArray): void {
    const factor = Math.pow(2, s.exposure);
    const offset = s.offset || 0;
    const gamma = s.gamma || 1.0;

    for (let i = 0; i < data.length; i += 4) {
      const weight = mask ? mask[i] / 255 : 1.0;
      if (weight <= 0) continue;

      for (let c = 0; c < 3; c++) {
        let val = data[i + c] / 255;
        // Exposure multiplier in linear space
        val = (val * factor) + offset;
        if (gamma !== 1.0 && val > 0) {
          val = Math.pow(val, 1 / gamma);
        }
        val = Math.min(255, Math.max(0, val * 255));
        data[i + c] = Math.round(data[i + c] + (val - data[i + c]) * weight);
      }
    }
  }

  // --- 2. Brightness & Contrast ---
  static applyBrightnessContrast(data: Uint8ClampedArray, s: BrightnessContrastSettings, mask?: Uint8ClampedArray): void {
    const brightness = s.brightness; // -100 to 100
    const contrast = s.contrast; // -100 to 100

    // Photoshop style contrast factor
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < data.length; i += 4) {
      const weight = mask ? mask[i] / 255 : 1.0;
      if (weight <= 0) continue;

      for (let c = 0; c < 3; c++) {
        let val = data[i + c] + brightness;
        val = factor * (val - 128) + 128;
        val = Math.min(255, Math.max(0, val));
        data[i + c] = Math.round(data[i + c] + (val - data[i + c]) * weight);
      }
    }
  }

  // --- 3. Hue / Saturation ---
  static applyHueSaturation(data: Uint8ClampedArray, s: HueSaturationSettings, mask?: Uint8ClampedArray): void {
    const hueDelta = s.hue / 360; // -0.5 to 0.5
    const satFactor = 1 + (s.saturation / 100);
    const lightDelta = s.lightness / 100;

    for (let i = 0; i < data.length; i += 4) {
      const weight = mask ? mask[i] / 255 : 1.0;
      if (weight <= 0) continue;

      const [h, sat, l] = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
      let newH = (h + hueDelta) % 1.0;
      if (newH < 0) newH += 1.0;

      const newS = Math.min(1, Math.max(0, sat * satFactor));
      const newL = Math.min(1, Math.max(0, l + lightDelta * (lightDelta > 0 ? (1 - l) : l)));

      const [r, g, b] = hslToRgb(newH, newS, newL);
      data[i] = Math.round(data[i] + (r * 255 - data[i]) * weight);
      data[i + 1] = Math.round(data[i + 1] + (g * 255 - data[i + 1]) * weight);
      data[i + 2] = Math.round(data[i + 2] + (b * 255 - data[i + 2]) * weight);
    }
  }

  // --- 4. Color Balance ---
  static applyColorBalance(data: Uint8ClampedArray, s: ColorBalanceSettings, mask?: Uint8ClampedArray): void {
    for (let i = 0; i < data.length; i += 4) {
      const weight = mask ? mask[i] / 255 : 1.0;
      if (weight <= 0) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

      // Shadow, midtone, highlight weights
      const shadowW = Math.max(0, 1 - luminance / 128);
      const highlightW = Math.max(0, (luminance - 128) / 127);
      const midtoneW = 1 - shadowW - highlightW;

      const deltaR = s.shadows.cyanRed * shadowW + s.midtones.cyanRed * midtoneW + s.highlights.cyanRed * highlightW;
      const deltaG = s.shadows.magentaGreen * shadowW + s.midtones.magentaGreen * midtoneW + s.highlights.magentaGreen * highlightW;
      const deltaB = s.shadows.yellowBlue * shadowW + s.midtones.yellowBlue * midtoneW + s.highlights.yellowBlue * highlightW;

      let newR = Math.min(255, Math.max(0, r + deltaR));
      let newG = Math.min(255, Math.max(0, g + deltaG));
      let newB = Math.min(255, Math.max(0, b + deltaB));

      if (s.preserveLuminosity) {
        const newLum = 0.299 * newR + 0.587 * newG + 0.114 * newB;
        if (newLum > 0) {
          const lumRatio = luminance / newLum;
          newR = Math.min(255, Math.max(0, newR * lumRatio));
          newG = Math.min(255, Math.max(0, newG * lumRatio));
          newB = Math.min(255, Math.max(0, newB * lumRatio));
        }
      }

      data[i] = Math.round(r + (newR - r) * weight);
      data[i + 1] = Math.round(g + (newG - g) * weight);
      data[i + 2] = Math.round(b + (newB - b) * weight);
    }
  }

  // --- 5. Black & White ---
  static applyBlackAndWhite(data: Uint8ClampedArray, s: BlackAndWhiteSettings, mask?: Uint8ClampedArray): void {
    const total = Math.abs(s.reds) + Math.abs(s.yellows) + Math.abs(s.greens) + Math.abs(s.cyans) + Math.abs(s.blues) + Math.abs(s.magentas);
    const norm = total > 0 ? 1 / total : 1 / 6;

    const wR = (s.reds + s.yellows * 0.5 + s.magentas * 0.5) * norm;
    const wG = (s.greens + s.yellows * 0.5 + s.cyans * 0.5) * norm;
    const wB = (s.blues + s.cyans * 0.5 + s.magentas * 0.5) * norm;

    for (let i = 0; i < data.length; i += 4) {
      const weight = mask ? mask[i] / 255 : 1.0;
      if (weight <= 0) continue;

      const gray = Math.min(255, Math.max(0, data[i] * wR + data[i + 1] * wG + data[i + 2] * wB));
      data[i] = Math.round(data[i] + (gray - data[i]) * weight);
      data[i + 1] = Math.round(data[i + 1] + (gray - data[i + 1]) * weight);
      data[i + 2] = Math.round(data[i + 2] + (gray - data[i + 2]) * weight);
    }
  }

  // --- 6. Levels ---
  static applyLevels(data: Uint8ClampedArray, s: LevelsSettings, mask?: Uint8ClampedArray): void {
    const lut = this.buildLevelsLUT(s);

    for (let i = 0; i < data.length; i += 4) {
      const weight = mask ? mask[i] / 255 : 1.0;
      if (weight <= 0) continue;

      const newR = lut[data[i]];
      const newG = lut[data[i + 1]];
      const newB = lut[data[i + 2]];

      data[i] = Math.round(data[i] + (newR - data[i]) * weight);
      data[i + 1] = Math.round(data[i + 1] + (newG - data[i + 1]) * weight);
      data[i + 2] = Math.round(data[i + 2] + (newB - data[i + 2]) * weight);
    }
  }

  static buildLevelsLUT(s: LevelsSettings): Uint8Array {
    const lut = new Uint8Array(256);
    const inRange = Math.max(1, s.inputWhite - s.inputBlack);
    const outRange = s.outputWhite - s.outputBlack;
    const invGamma = 1.0 / Math.max(0.01, s.inputGamma);

    for (let i = 0; i < 256; i++) {
      if (i <= s.inputBlack) {
        lut[i] = s.outputBlack;
      } else if (i >= s.inputWhite) {
        lut[i] = s.outputWhite;
      } else {
        const normalized = (i - s.inputBlack) / inRange;
        const gammaCorrected = Math.pow(normalized, invGamma);
        lut[i] = Math.round(Math.min(255, Math.max(0, s.outputBlack + gammaCorrected * outRange)));
      }
    }
    return lut;
  }

  // --- 7. Curves ---
  static applyCurves(data: Uint8ClampedArray, s: CurvesSettings, mask?: Uint8ClampedArray): void {
    const rgbLut = this.buildCurveLUT(s.rgb);
    const rLut = s.red ? this.buildCurveLUT(s.red) : null;
    const gLut = s.green ? this.buildCurveLUT(s.green) : null;
    const bLut = s.blue ? this.buildCurveLUT(s.blue) : null;

    for (let i = 0; i < data.length; i += 4) {
      const weight = mask ? mask[i] / 255 : 1.0;
      if (weight <= 0) continue;

      let r = rgbLut[data[i]];
      let g = rgbLut[data[i + 1]];
      let b = rgbLut[data[i + 2]];

      if (rLut) r = rLut[r];
      if (gLut) g = gLut[g];
      if (bLut) b = bLut[b];

      data[i] = Math.round(data[i] + (r - data[i]) * weight);
      data[i + 1] = Math.round(data[i + 1] + (g - data[i + 1]) * weight);
      data[i + 2] = Math.round(data[i + 2] + (b - data[i + 2]) * weight);
    }
  }

  /**
   * Generates a 256-entry monotonic cubic spline lookup table from control points.
   */
  static buildCurveLUT(points: CurvePoint[]): Uint8Array {
    const lut = new Uint8Array(256);
    if (!points || points.length === 0) {
      for (let i = 0; i < 256; i++) lut[i] = i;
      return lut;
    }

    // Sort control points by x
    const sorted = [...points].sort((a, b) => a.x - b.x);

    // Ensure edge endpoints exist
    if (sorted[0].x > 0) {
      sorted.unshift({ x: 0, y: sorted[0].y });
    }
    if (sorted[sorted.length - 1].x < 255) {
      sorted.push({ x: 255, y: sorted[sorted.length - 1].y });
    }

    // Piecewise cubic Hermite interpolation
    for (let i = 0; i < sorted.length - 1; i++) {
      const p0 = sorted[Math.max(0, i - 1)];
      const p1 = sorted[i];
      const p2 = sorted[i + 1];
      const p3 = sorted[Math.min(sorted.length - 1, i + 2)];

      const dx = p2.x - p1.x;
      if (dx <= 0) continue;

      // Slopes (Catmull-Rom style tangents)
      const m1 = (p2.y - p0.y) / Math.max(1, p2.x - p0.x);
      const m2 = (p3.y - p1.y) / Math.max(1, p3.x - p1.x);

      for (let x = p1.x; x <= p2.x; x++) {
        const t = (x - p1.x) / dx;
        const t2 = t * t;
        const t3 = t2 * t;

        // Hermite basis functions
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        const y = h00 * p1.y + h10 * dx * m1 + h01 * p2.y + h11 * dx * m2;
        lut[Math.min(255, Math.max(0, x))] = Math.round(Math.min(255, Math.max(0, y)));
      }
    }

    return lut;
  }
}
