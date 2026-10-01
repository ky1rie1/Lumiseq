export interface CutoutRegion { x: number; y: number; width: number; height: number }

/** Find the opaque layer footprint on a small alpha thumbnail, retaining context around it. */
export function planCutoutRegion(alpha: Uint8ClampedArray, thumbWidth: number, thumbHeight: number, width: number, height: number): CutoutRegion {
  if (alpha.length !== thumbWidth * thumbHeight || thumbWidth < 1 || thumbHeight < 1 || width < 1 || height < 1) {
    throw new Error('抠图源区域尺寸无效。');
  }
  const full = { x: 0, y: 0, width, height };
  let left = thumbWidth, top = thumbHeight, right = -1, bottom = -1;
  for (let y = 0; y < thumbHeight; y++) for (let x = 0; x < thumbWidth; x++) {
    if (alpha[y * thumbWidth + x] < 8) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) return full;
  const pad = Math.max(2, Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 0.08));
  const x0 = Math.max(0, Math.floor((left - pad) * width / thumbWidth));
  const y0 = Math.max(0, Math.floor((top - pad) * height / thumbHeight));
  const x1 = Math.min(width, Math.ceil((right + 1 + pad) * width / thumbWidth));
  const y1 = Math.min(height, Math.ceil((bottom + 1 + pad) * height / thumbHeight));
  if ((x1 - x0) * (y1 - y0) >= width * height * 0.9) return full;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function placeRegionMask(mask: Uint8ClampedArray, region: CutoutRegion, width: number, height: number): Uint8ClampedArray {
  if (region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 ||
      region.x + region.width > width || region.y + region.height > height || mask.length !== region.width * region.height) {
    throw new Error('抠图蒙版无法映射到画布。');
  }
  if (region.x === 0 && region.y === 0 && region.width === width && region.height === height) return mask;
  const output = new Uint8ClampedArray(width * height);
  for (let row = 0; row < region.height; row++) {
    output.set(mask.subarray(row * region.width, (row + 1) * region.width), (region.y + row) * width + region.x);
  }
  return output;
}
