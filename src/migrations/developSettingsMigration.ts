// src/migrations/developSettingsMigration.ts
//! Migration and NaN/Sanitization logic for DevelopSettings (v1/v2 -> v3)

import { DevelopSettings, ChannelHSL, ToneCurves, DevelopMask } from '../types/develop';
import { ColorChannel } from '../types/common';
import { isResolvedAutoWhiteBalance } from '../engine/developColorMath';

const DEFAULT_CHANNELS: ColorChannel[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
];

function sanitizeNumber(val: unknown, fallback: number, min?: number, max?: number): number {
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
    return fallback;
  }
  let res = val;
  if (min !== undefined) res = Math.max(min, res);
  if (max !== undefined) res = Math.min(max, res);
  return res;
}

function sanitizeMask(raw: any): DevelopMask | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.maskAssetId !== 'string' || !raw.maskAssetId ||
      !['linear', 'radial', 'brush'].includes(raw.kind) || !raw.geometry || typeof raw.geometry !== 'object') return null;
  const point = (candidate: any) => candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
    ? { x: sanitizeNumber(candidate.x, 0.5, 0, 1), y: sanitizeNumber(candidate.y, 0.5, 0, 1) } : undefined;
  const geometry = {
    start: point(raw.geometry.start), end: point(raw.geometry.end), center: point(raw.geometry.center),
    radiusX: sanitizeNumber(raw.geometry.radiusX, 0.3, 0.001, 1),
    radiusY: sanitizeNumber(raw.geometry.radiusY, 0.3, 0.001, 1),
    feather: sanitizeNumber(raw.geometry.feather, 0.5, 0, 1),
  };
  const strokes = Array.isArray(raw.strokes) ? raw.strokes.filter((stroke: any) => Array.isArray(stroke?.points)).map((stroke: any) => ({
    points: stroke.points.map(point).filter(Boolean),
    radius: sanitizeNumber(stroke.radius, 0.035, 0.001, 1),
    feather: sanitizeNumber(stroke.feather, 0.4, 0, 1),
  })) : [];
  return {
    id: raw.id, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '局部蒙版',
    maskAssetId: raw.maskAssetId, kind: raw.kind, geometry, strokes,
    inverted: raw.inverted === true, opacity: sanitizeNumber(raw.opacity, 1, 0, 1),
    exposure: sanitizeNumber(raw.exposure, 0, -5, 5), contrast: sanitizeNumber(raw.contrast, 0, -100, 100),
    highlights: sanitizeNumber(raw.highlights, 0, -100, 100), shadows: sanitizeNumber(raw.shadows, 0, -100, 100),
    temperature: sanitizeNumber(raw.temperature, 0, -100, 100), saturation: sanitizeNumber(raw.saturation, 0, -100, 100),
  };
}

export function migrateDevelopSettings(raw: any, isRaw: boolean = false): DevelopSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      version: 3,
      exposure: 0.0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      whiteBalance: isRaw ? { mode: 'as-shot' } : { mode: 'custom', temperature: 5500, tint: 0 },
      texture: 0,
      clarity: 0,
      dehaze: 0,
      vibrance: 0,
      saturation: 0,
      hsl: createDefaultHsl(),
      curves: createDefaultCurves(),
      detail: {
        sharpenAmount: 0,
        sharpenRadius: 1.0,
        sharpenThreshold: 0,
        lumaDenoise: 0,
        chromaDenoise: 0,
      },
      optics: {
        vignetteAmount: 0,
        vignetteMidpoint: 50,
      },
      masks: [],
    };
  }

  // Version 1 -> Version 2 migration
  const exposure = sanitizeNumber(raw.exposure, 0.0, -5.0, 5.0);
  const contrast = sanitizeNumber(raw.contrast, 0, -100, 100);
  const highlights = sanitizeNumber(raw.highlights, 0, -100, 100);
  const shadows = sanitizeNumber(raw.shadows, 0, -100, 100);
  const whites = sanitizeNumber(raw.whites, 0, -100, 100);
  const blacks = sanitizeNumber(raw.blacks, 0, -100, 100);
  const texture = sanitizeNumber(raw.texture, 0, -100, 100);
  const clarity = sanitizeNumber(raw.clarity, 0, -100, 100);
  const dehaze = sanitizeNumber(raw.dehaze, 0, -100, 100);
  const vibrance = sanitizeNumber(raw.vibrance, 0, -100, 100);
  const saturation = sanitizeNumber(raw.saturation, 0, -100, 100);

  // White balance
  const wb = raw.whiteBalance || {};
  const wbMode = wb.mode === 'auto' || wb.mode === 'custom' ? wb.mode : 'as-shot';
  const temperature = sanitizeNumber(wb.temperature, 5500, 2000, 12000);
  const tint = sanitizeNumber(wb.tint, 0, -150, 150);
  const cameraMultipliers = Array.isArray(wb.cameraMultipliers) && wb.cameraMultipliers.length >= 3
    ? [
        sanitizeNumber(wb.cameraMultipliers[0], 1.0, 0.1, 10.0),
        sanitizeNumber(wb.cameraMultipliers[1], 1.0, 0.1, 10.0),
        sanitizeNumber(wb.cameraMultipliers[2], 1.0, 0.1, 10.0),
        sanitizeNumber(wb.cameraMultipliers[3] ?? 1.0, 1.0, 0.1, 10.0),
      ] as [number, number, number, number]
    : undefined;

  // HSL Channels
  const hsl: Record<ColorChannel, ChannelHSL> = createDefaultHsl();
  if (raw.hsl && typeof raw.hsl === 'object') {
    for (const ch of DEFAULT_CHANNELS) {
      if (raw.hsl[ch]) {
        hsl[ch] = {
          hue: sanitizeNumber(raw.hsl[ch].hue, 0, -100, 100),
          saturation: sanitizeNumber(raw.hsl[ch].saturation, 0, -100, 100),
          luminance: sanitizeNumber(raw.hsl[ch].luminance, 0, -100, 100),
        };
      }
    }
  }

  // Curves
  const curves: ToneCurves = createDefaultCurves();
  if (raw.curves && typeof raw.curves === 'object') {
    for (const ch of ['rgb', 'red', 'green', 'blue'] as const) {
      if (Array.isArray(raw.curves[ch]) && raw.curves[ch].length >= 2) {
        curves[ch] = raw.curves[ch].map((pt: any) => ({
          x: sanitizeNumber(pt.x, 0, 0, 1),
          y: sanitizeNumber(pt.y, 0, 0, 1),
        })).sort((a: any, b: any) => a.x - b.x);
      }
    }
  }

  // Detail
  const rawDetail = raw.detail || {};
  const detail = {
    sharpenAmount: sanitizeNumber(rawDetail.sharpenAmount, 0, 0, 150),
    sharpenRadius: sanitizeNumber(rawDetail.sharpenRadius, 1.0, 0.5, 3.0),
    sharpenThreshold: sanitizeNumber(rawDetail.sharpenThreshold, 0, 0, 25),
    lumaDenoise: sanitizeNumber(rawDetail.lumaDenoise, 0, 0, 100),
    chromaDenoise: sanitizeNumber(rawDetail.chromaDenoise, 0, 0, 100),
  };

  // Optics
  const rawOptics = raw.optics || {};
  const optics = {
    vignetteAmount: sanitizeNumber(rawOptics.vignetteAmount, 0, -100, 100),
    vignetteMidpoint: sanitizeNumber(rawOptics.vignetteMidpoint, 50, 0, 100),
  };

  return {
    version: 3,
    exposure,
    contrast,
    highlights,
    shadows,
    whites,
    blacks,
    whiteBalance: {
      mode: wbMode,
      temperature,
      tint,
      cameraMultipliers,
      resolvedAuto: isResolvedAutoWhiteBalance(wb.resolvedAuto) ? structuredClone(wb.resolvedAuto) : undefined,
    },
    texture,
    clarity,
    dehaze,
    vibrance,
    saturation,
    hsl,
    curves,
    detail,
    optics,
    masks: Array.isArray(raw.masks) ? raw.masks.map(sanitizeMask).filter((mask: DevelopMask | null): mask is DevelopMask => mask !== null) : [],
  };
}

function createDefaultHsl(): Record<ColorChannel, ChannelHSL> {
  const res = {} as Record<ColorChannel, ChannelHSL>;
  for (const ch of DEFAULT_CHANNELS) {
    res[ch] = { hue: 0, saturation: 0, luminance: 0 };
  }
  return res;
}

function createDefaultCurves(): ToneCurves {
  return {
    rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  };
}
