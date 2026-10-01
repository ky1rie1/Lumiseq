import type { Point, Rect } from '../selection/types';

export interface Refinement { shift: number; smooth: number; feather: number; contrast: number }
export const defaultRefinement: Refinement = { shift: 0, smooth: 0, feather: 0, contrast: 0 };

export function resizeSoftAlpha(input: Uint8ClampedArray, width: number, height: number, targetWidth: number, targetHeight: number): Uint8ClampedArray {
  validatePixels(input.length, width, height);
  validatePixels(targetWidth * targetHeight, targetWidth, targetHeight);
  const output = new Uint8ClampedArray(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const fy = Math.max(0, Math.min(height - 1, (y + 0.5) * height / targetHeight - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(height - 1, y0 + 1), dy = fy - y0;
    for (let x = 0; x < targetWidth; x++) {
      const fx = Math.max(0, Math.min(width - 1, (x + 0.5) * width / targetWidth - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(width - 1, x0 + 1), dx = fx - x0;
      const top = input[y0 * width + x0] * (1 - dx) + input[y0 * width + x1] * dx;
      const bottom = input[y1 * width + x0] * (1 - dx) + input[y1 * width + x1] * dx;
      output[y * targetWidth + x] = Math.round(top * (1 - dy) + bottom * dy);
    }
  }
  return output;
}

function validatePixels(length: number, width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width * height > 150_000_000 || length !== width * height) throw new Error('蒙版尺寸或像素数据无效。');
}

/** BiRefNet's exported output is logits, not binary labels or already-normalized alpha. */
export function alphaFromLogits(logits: ArrayLike<number>, width: number, height: number): Uint8ClampedArray {
  validatePixels(logits.length, width, height);
  const alpha = new Uint8ClampedArray(logits.length);
  for (let i = 0; i < logits.length; i++) {
    const value = logits[i];
    if (!Number.isFinite(value)) throw new Error('模型返回无效像素，未应用抠图。');
    alpha[i] = Math.round(255 / (1 + Math.exp(-value)));
  }
  return alpha;
}

/** ImageNet RGB normalization, planar NCHW, with white-composited transparent pixels. */
export function prepareInput(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  validatePixels(rgba.length / 4, width, height);
  const size = width * height;
  const output = new Float32Array(size * 3);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < size; i++) {
    const opacity = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) output[c * size + i] = ((rgba[i * 4 + c] / 255 * opacity + 1 - opacity) - mean[c]) / std[c];
  }
  return output;
}

/** Separable sliding filters run in O(pixel count), independent of the chosen radius. */
function filter(mask: Uint8ClampedArray, width: number, height: number, radius: number, mode: 'max' | 'min' | 'mean'): Uint8ClampedArray {
  const horizontal = new Uint8ClampedArray(mask.length), output = new Uint8ClampedArray(mask.length);
  for (let pass = 0; pass < 2; pass++) {
    const input = pass === 0 ? mask : horizontal, dest = pass === 0 ? horizontal : output;
    const lines = pass === 0 ? height : width, length = pass === 0 ? width : height;
    const deque = new Int32Array(length);
    for (let line = 0; line < lines; line++) {
      const index = (pos: number) => pass === 0 ? line * width + pos : pos * width + line;
      let head = 0, tail = 0, end = -1, sum = 0, start = 0;
      for (let pos = 0; pos < length; pos++) {
        const left = Math.max(0, pos - radius), right = Math.min(length - 1, pos + radius);
        while (end < right) {
          end++;
          const value = input[index(end)];
          sum += value;
          while (tail > head && (mode === 'max' ? input[index(deque[tail - 1])] <= value : input[index(deque[tail - 1])] >= value)) tail--;
          deque[tail++] = end;
        }
        while (start < left) { sum -= input[index(start)]; start++; }
        while (head < tail && deque[head] < left) head++;
        dest[index(pos)] = mode === 'mean' ? Math.round(sum / (right - left + 1)) : input[index(deque[head])];
      }
    }
  }
  return output;
}

export function refineAlpha(input: Uint8ClampedArray, width: number, height: number, options: Refinement): Uint8ClampedArray {
  validatePixels(input.length, width, height);
  if (![options.shift, options.smooth, options.feather, options.contrast].every(Number.isFinite) ||
      Math.abs(options.shift) > 100 || options.smooth < 0 || options.smooth > 30 ||
      options.feather < 0 || options.feather > 100 || options.contrast < 0 || options.contrast > 100) throw new Error('边缘精修参数无效。');
  let alpha: Uint8ClampedArray = new Uint8ClampedArray(input);
  const shift = Math.round(Math.abs(options.shift));
  if (shift) alpha = filter(alpha, width, height, shift, options.shift > 0 ? 'max' : 'min');
  if (options.smooth >= 1) alpha = filter(alpha, width, height, Math.round(options.smooth), 'mean');
  if (options.feather >= 1) {
    const radius = Math.max(1, Math.round(options.feather / 2));
    for (let i = 0; i < 3; i++) alpha = filter(alpha, width, height, radius, 'mean');
  }
  if (options.contrast) {
    const strength = 1 + options.contrast / 25;
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round((alpha[i] - 127.5) * strength + 127.5);
  }
  return alpha;
}

export function paintAlpha(mask: Uint8ClampedArray, width: number, height: number, point: Point, radius: number, mode: 'add' | 'remove'): void {
  validatePixels(mask.length, width, height);
  if (![point.x, point.y, radius].every(Number.isFinite) || radius <= 0) return;
  const left = Math.max(0, Math.floor(point.x - radius)), right = Math.min(width - 1, Math.ceil(point.x + radius));
  const top = Math.max(0, Math.floor(point.y - radius)), bottom = Math.min(height - 1, Math.ceil(point.y + radius));
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const distance = Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y);
    const coverage = Math.max(0, Math.min(1, (radius - distance) / Math.max(1, radius * 0.25)));
    const idx = y * width + x;
    mask[idx] = Math.round(mask[idx] * (1 - coverage) + (mode === 'add' ? 255 : 0) * coverage);
  }
}

export function maskBounds(mask: Uint8ClampedArray, width: number, height: number): Rect {
  validatePixels(mask.length, width, height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x] > 0) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return maxX < 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
