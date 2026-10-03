import { IAssetManager } from '../types/asset';
import { DevelopSettings } from '../types/develop';
import { buildDevelopCurveLUT, curvesAreNeutral, isResolvedAutoWhiteBalance, relativeWhiteBalanceMatrix } from '../engine/developColorMath';

const HSL_CHANNELS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;

interface NativeDevelopMask {
  width: number;
  height: number;
  bytes: number[];
  inverted: boolean;
  opacity: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  temperature: number;
  saturation: number;
}

export interface NativeDevelopPayload {
  rendering_version?: 1 | 2;
  exposure: number;
  contrast: number;
  saturation: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
  curve_lut: number[];
  hsl: [number, number, number][];
  vignette_amount: number;
  vignette_midpoint: number;
  texture: number;
  clarity: number;
  dehaze: number;
  sharpen_amount: number;
  sharpen_radius: number;
  sharpen_threshold: number;
  luma_denoise: number;
  chroma_denoise: number;
  white_balance_mode: string;
  white_balance_matrix?: number[];
  temperature?: number;
  tint?: number;
  masks: NativeDevelopMask[];
}

/** Return controls that the native full-resolution renderer cannot faithfully export yet. */
export function getUnsupportedNativeDevelopFeatures(settings: DevelopSettings, _isRaw = true): string[] {
  const features: string[] = [];
  if (settings.whiteBalance.mode === 'auto' && !isResolvedAutoWhiteBalance(settings.whiteBalance.resolvedAuto)) features.push('自动白平衡');
  return features;
}

/** Resolve transient mask assets into an explicit native payload; never serialize pixels in document JSON. */
export async function buildNativeDevelopPayload(settings: DevelopSettings, assets: IAssetManager): Promise<NativeDevelopPayload> {
  if (settings.renderingVersion !== undefined && settings.renderingVersion !== 1 && settings.renderingVersion !== 2) throw new Error('Unsupported rendering version');
  const whiteBalanceMatrix = settings.whiteBalance.mode === 'auto' ? relativeWhiteBalanceMatrix(settings.whiteBalance) : undefined;
  const masks: NativeDevelopMask[] = [];
  for (const mask of settings.masks) {
    const handle = assets.getHandle(mask.maskAssetId);
    const pixels = await assets.getMask(mask.maskAssetId);
    if (!handle || !pixels || !handle.width || !handle.height || pixels.length !== handle.width * handle.height) {
      throw new Error(`蒙版 ${mask.name} 的像素数据丢失，无法导出`);
    }
    masks.push({
      width: handle.width, height: handle.height, bytes: Array.from(pixels),
      inverted: mask.inverted, opacity: mask.opacity,
      exposure: mask.exposure ?? 0, contrast: mask.contrast ?? 0,
      highlights: mask.highlights ?? 0, shadows: mask.shadows ?? 0,
      temperature: mask.temperature ?? 0, saturation: mask.saturation ?? 0,
    });
  }
  return {
    rendering_version: settings.renderingVersion ?? 1,
    exposure: settings.exposure, contrast: settings.contrast,
    saturation: settings.saturation, highlights: settings.highlights, shadows: settings.shadows,
    whites: settings.whites, blacks: settings.blacks, vibrance: settings.vibrance,
    curve_lut: curvesAreNeutral(settings.curves) ? [] : Array.from(buildDevelopCurveLUT(settings.curves)),
    hsl: HSL_CHANNELS.some(channel => {
      const value = settings.hsl[channel];
      return value.hue !== 0 || value.saturation !== 0 || value.luminance !== 0;
    }) ? HSL_CHANNELS.map(channel => {
      const value = settings.hsl[channel];
      return [value.hue * 0.3, 1 + value.saturation / 100, value.luminance / 200] as [number, number, number];
    }) : [],
    vignette_amount: settings.optics.vignetteAmount,
    vignette_midpoint: settings.optics.vignetteMidpoint,
    texture: settings.texture, clarity: settings.clarity, dehaze: settings.dehaze,
    sharpen_amount: settings.detail.sharpenAmount,
    sharpen_radius: settings.detail.sharpenRadius,
    sharpen_threshold: settings.detail.sharpenThreshold,
    luma_denoise: settings.detail.lumaDenoise,
    chroma_denoise: settings.detail.chromaDenoise,
    white_balance_mode: settings.whiteBalance.mode,
    white_balance_matrix: whiteBalanceMatrix,
    temperature: settings.whiteBalance.temperature, tint: settings.whiteBalance.tint,
    masks,
  };
}
