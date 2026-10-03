/** Source pixels represented by one pixel in the standard 1920 × 1080 overview. */
import type { DevelopSettings } from '../types/develop';

export function spatialSourcePixelScale(sourceWidth: number, sourceHeight: number): number {
  if (sourceWidth <= 0 || sourceHeight <= 0) return 1;
  return Math.max(1, sourceWidth / 1920, sourceHeight / 1080);
}

/** Convert a source-image filter radius into pixels of the current preview texture. */
export function spatialPreviewPixelScale(
  sourceWidth: number, sourceHeight: number,
  renderWidth: number, _renderHeight: number,
  regionWidth = sourceWidth,
): number {
  if (sourceWidth <= 0 || regionWidth <= 0 || renderWidth <= 0) return 1;
  return spatialSourcePixelScale(sourceWidth, sourceHeight) * renderWidth / regionWidth;
}

export function spatialSourceHalo(settings: DevelopSettings, width: number, height: number): number {
  const detail = settings.detail;
  if(settings.renderingVersion===2){
    const stages=(settings.texture ? 2*Math.ceil(3*Math.max(.35,1)) : 0)+(settings.clarity ? 2*Math.ceil(3*4) : 0)+(detail.sharpenAmount ? Math.ceil(3*Math.max(.35,detail.sharpenRadius)) : 0);
    return stages+(detail.lumaDenoise || detail.chromaDenoise ? 14 : 0);
  }
  const radius = Math.max(settings.texture ? 1 : 0, settings.clarity ? 8 : 0,
    detail.sharpenAmount ? detail.sharpenRadius : 0);
  const downstream = radius ? Math.ceil(radius * spatialSourcePixelScale(width, height)) + 1 : 0;
  return downstream + (detail.lumaDenoise || detail.chromaDenoise ? 14 : 0);
}
