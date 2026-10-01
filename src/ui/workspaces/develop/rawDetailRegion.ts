export interface RawDetailRegion { x: number; y: number; width: number; height: number }

/** Source-pixel rectangle for a bounded, lossless-encoded detail overlay. */
export function computeRawDetailRegion(
  sourceWidth: number, sourceHeight: number,
  viewportWidth: number, viewportHeight: number,
  scale: number, panX: number, panY: number,
  previewWidth: number, previewHeight: number,
): RawDetailRegion | null {
  const values = [sourceWidth, sourceHeight, viewportWidth, viewportHeight, scale, panX, panY, previewWidth, previewHeight];
  if (!values.every(Number.isFinite) || Math.min(sourceWidth, sourceHeight, viewportWidth, viewportHeight, scale, previewWidth, previewHeight) <= 0) return null;
  if (scale <= Math.min(previewWidth / sourceWidth, previewHeight / sourceHeight) + 1e-6) return null;

  const centerX = sourceWidth / 2 - panX / scale;
  const centerY = sourceHeight / 2 - panY / scale;
  const margin = 32;
  let x = Math.max(0, Math.floor(centerX - viewportWidth / (2 * scale) - margin));
  let y = Math.max(0, Math.floor(centerY - viewportHeight / (2 * scale) - margin));
  let right = Math.min(sourceWidth, Math.ceil(centerX + viewportWidth / (2 * scale) + margin));
  let bottom = Math.min(sourceHeight, Math.ceil(centerY + viewportHeight / (2 * scale) + margin));
  if (right <= x || bottom <= y) return null;

  const width = Math.min(right - x, 4096);
  const height = Math.min(bottom - y, 4096, Math.floor(6_000_000 / width));
  if (right - x > width) x = Math.max(0, Math.min(sourceWidth - width, Math.floor(centerX - width / 2)));
  if (bottom - y > height) y = Math.max(0, Math.min(sourceHeight - height, Math.floor(centerY - height / 2)));
  right = x + width;
  bottom = y + height;
  return { x, y, width: right - x, height: bottom - y };
}
