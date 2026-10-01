export interface RawSourceRect { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number }

export function normalizeRawSourceRect(rect: RawSourceRect): [number, number, number, number] {
  const { x, y, width, height, sourceWidth, sourceHeight } = rect;
  if (![x, y, width, height, sourceWidth, sourceHeight].every(Number.isFinite)
    || x < 0 || y < 0 || width <= 0 || height <= 0 || sourceWidth <= 0 || sourceHeight <= 0
    || x + width > sourceWidth || y + height > sourceHeight) throw new Error('RAW detail crop is outside its source');
  return [x / sourceWidth, y / sourceHeight, width / sourceWidth, height / sourceHeight];
}
