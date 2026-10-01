/** Largest preview that fits the develop viewport without changing the photo's proportions. */
export const DEVELOP_PREVIEW_MAX_WIDTH = 1920;
export const DEVELOP_PREVIEW_MAX_HEIGHT = 1080;

export interface PreviewDimensions {
  width: number;
  height: number;
}

export type PreviewQuality = 'auto' | 'economy' | 'high';

export function fitPreviewDimensions(width: number, height: number, quality: PreviewQuality = 'auto', interacting = false): PreviewDimensions {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  // Never upscale: small photos keep their native pixels, large ones shrink by one shared factor.
  const budget = quality === 'economy' || (quality === 'auto' && interacting) ? 2 / 3 : quality === 'high' ? 1.5 : 1;
  const scale = Math.min(1, DEVELOP_PREVIEW_MAX_WIDTH * budget / width, DEVELOP_PREVIEW_MAX_HEIGHT * budget / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
