// src/selection/SelectionUtils.ts
//! High-performance pixel math and geometric algorithms for 8-bit grayscale selection masks

import { Point, Rect, SelectionMode, SelectionShape } from './types';

export class SelectionUtils {
  /**
   * Create an empty 8-bit grayscale mask
   */
  static createEmptyMask(width: number, height: number): Uint8ClampedArray {
    return new Uint8ClampedArray(width * height);
  }

  /**
   * Create a full-canvas (255) 8-bit grayscale mask
   */
  static createFullMask(width: number, height: number): Uint8ClampedArray {
    const mask = new Uint8ClampedArray(width * height);
    mask.fill(255);
    return mask;
  }

  /**
   * Rasterize a geometric shape into an 8-bit grayscale mask
   */
  static rasterizeShape(
    width: number,
    height: number,
    shape: SelectionShape,
    rect?: Rect,
    points?: Point[]
  ): Uint8ClampedArray {
    const mask = new Uint8ClampedArray(width * height);

    if (shape === 'rectangle' && rect) {
      const rx = Math.max(0, Math.min(width, Math.round(rect.x)));
      const ry = Math.max(0, Math.min(height, Math.round(rect.y)));
      const rw = Math.max(0, Math.min(width - rx, Math.round(rect.width)));
      const rh = Math.max(0, Math.min(height - ry, Math.round(rect.height)));

      for (let y = ry; y < ry + rh; y++) {
        const rowOffset = y * width;
        for (let x = rx; x < rx + rw; x++) {
          mask[rowOffset + x] = 255;
        }
      }
    } else if (shape === 'ellipse' && rect) {
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const rx = rect.width / 2;
      const ry = rect.height / 2;
      if (rx <= 0 || ry <= 0) return mask;

      const minX = Math.max(0, Math.floor(rect.x));
      const maxX = Math.min(width, Math.ceil(rect.x + rect.width));
      const minY = Math.max(0, Math.floor(rect.y));
      const maxY = Math.min(height, Math.ceil(rect.y + rect.height));

      const invRx2 = 1 / (rx * rx);
      const invRy2 = 1 / (ry * ry);

      for (let y = minY; y < maxY; y++) {
        const dy = y - cy;
        const dy2 = dy * dy * invRy2;
        const rowOffset = y * width;
        for (let x = minX; x < maxX; x++) {
          const dx = x - cx;
          if (dx * dx * invRx2 + dy2 <= 1.0) {
            mask[rowOffset + x] = 255;
          }
        }
      }
    } else if ((shape === 'lasso' || shape === 'polygon') && points && points.length >= 3) {
      this.rasterizePolygon(mask, width, height, points);
    }

    return mask;
  }

  /**
   * Ray-casting / scanline polygon rasterization
   */
  private static rasterizePolygon(
    mask: Uint8ClampedArray,
    width: number,
    height: number,
    points: Point[]
  ): void {
    let minY = height;
    let maxY = 0;
    for (const p of points) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(height - 1, Math.ceil(maxY));

    const numPoints = points.length;

    for (let y = minY; y <= maxY; y++) {
      const nodeX: number[] = [];
      let j = numPoints - 1;

      for (let i = 0; i < numPoints; i++) {
        const pi = points[i];
        const pj = points[j];

        if ((pi.y < y && pj.y >= y) || (pj.y < y && pi.y >= y)) {
          const x = pi.x + ((y - pi.y) / (pj.y - pi.y)) * (pj.x - pi.x);
          nodeX.push(x);
        }
        j = i;
      }

      nodeX.sort((a, b) => a - b);

      const rowOffset = y * width;
      for (let i = 0; i < nodeX.length; i += 2) {
        if (i + 1 >= nodeX.length) break;
        let startX = Math.max(0, Math.ceil(nodeX[i]));
        let endX = Math.min(width - 1, Math.floor(nodeX[i + 1]));
        for (let x = startX; x <= endX; x++) {
          mask[rowOffset + x] = 255;
        }
      }
    }
  }

  /**
   * Combine two 8-bit masks using boolean selection mode
   */
  static combineMasks(
    target: Uint8ClampedArray,
    source: Uint8ClampedArray,
    mode: SelectionMode
  ): Uint8ClampedArray {
    const result = new Uint8ClampedArray(target.length);

    for (let i = 0; i < target.length; i++) {
      const t = target[i];
      const s = source[i];

      switch (mode) {
        case 'replace':
          result[i] = s;
          break;
        case 'add':
          result[i] = Math.min(255, t + s);
          break;
        case 'subtract':
          result[i] = Math.max(0, t - s);
          break;
        case 'intersect':
          result[i] = Math.min(t, s);
          break;
      }
    }

    return result;
  }

  /**
   * Calculate tight bounding box of non-zero pixels
   */
  static getMaskBounds(mask: Uint8ClampedArray, width: number, height: number): Rect {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        if (mask[rowOffset + x] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  }

  /**
   * Check if mask is completely empty
   */
  static isMaskEmpty(mask: Uint8ClampedArray): boolean {
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] > 0) return false;
    }
    return true;
  }

  /**
   * Invert 8-bit grayscale mask: 255 - value
   */
  static invertMask(mask: Uint8ClampedArray): Uint8ClampedArray {
    const result = new Uint8ClampedArray(mask.length);
    for (let i = 0; i < mask.length; i++) {
      result[i] = 255 - mask[i];
    }
    return result;
  }

  /**
   * Gaussian blur / feathering on 8-bit mask (separable 1D passes)
   */
  static featherMask(
    mask: Uint8ClampedArray,
    width: number,
    height: number,
    radius: number
  ): Uint8ClampedArray {
    if (radius <= 0) return new Uint8ClampedArray(mask);

    const kernelRadius = Math.ceil(radius * 2);
    const kernelSize = kernelRadius * 2 + 1;
    const kernel = new Float32Array(kernelSize);
    const sigma = radius;
    const twoSigma2 = 2 * sigma * sigma;

    let kernelSum = 0;
    for (let i = -kernelRadius; i <= kernelRadius; i++) {
      const val = Math.exp(-(i * i) / twoSigma2);
      kernel[i + kernelRadius] = val;
      kernelSum += val;
    }
    for (let i = 0; i < kernelSize; i++) {
      kernel[i] /= kernelSum;
    }

    // Horizontal pass
    const temp = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -kernelRadius; k <= kernelRadius; k++) {
          const sampleX = Math.max(0, Math.min(width - 1, x + k));
          sum += mask[rowOffset + sampleX] * kernel[k + kernelRadius];
        }
        temp[rowOffset + x] = sum;
      }
    }

    // Vertical pass
    const result = new Uint8ClampedArray(width * height);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let k = -kernelRadius; k <= kernelRadius; k++) {
          const sampleY = Math.max(0, Math.min(height - 1, y + k));
          sum += temp[sampleY * width + x] * kernel[k + kernelRadius];
        }
        result[y * width + x] = Math.max(0, Math.min(255, Math.round(sum)));
      }
    }

    return result;
  }

  /**
   * Morphological dilation: grow selection by radius pixels
   */
  static expandMask(
    mask: Uint8ClampedArray,
    width: number,
    height: number,
    radius: number
  ): Uint8ClampedArray {
    if (radius <= 0) return new Uint8ClampedArray(mask);
    const result = new Uint8ClampedArray(mask.length);
    const r = Math.round(radius);
    const r2 = r * r;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        let maxVal = mask[rowOffset + x];
        if (maxVal === 255) {
          result[rowOffset + x] = 255;
          continue;
        }

        for (let dy = -r; dy <= r; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          const dy2 = dy * dy;
          const nRowOffset = ny * width;

          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy2 <= r2) {
              const nx = x + dx;
              if (nx >= 0 && nx < width) {
                const val = mask[nRowOffset + nx];
                if (val > maxVal) {
                  maxVal = val;
                  if (maxVal === 255) break;
                }
              }
            }
          }
          if (maxVal === 255) break;
        }
        result[rowOffset + x] = maxVal;
      }
    }

    return result;
  }

  /**
   * Morphological erosion: shrink selection by radius pixels
   */
  static contractMask(
    mask: Uint8ClampedArray,
    width: number,
    height: number,
    radius: number
  ): Uint8ClampedArray {
    if (radius <= 0) return new Uint8ClampedArray(mask);
    const result = new Uint8ClampedArray(mask.length);
    const r = Math.round(radius);
    const r2 = r * r;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        let minVal = mask[rowOffset + x];
        if (minVal === 0) {
          result[rowOffset + x] = 0;
          continue;
        }

        for (let dy = -r; dy <= r; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          const dy2 = dy * dy;
          const nRowOffset = ny * width;

          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy2 <= r2) {
              const nx = x + dx;
              if (nx >= 0 && nx < width) {
                const val = mask[nRowOffset + nx];
                if (val < minVal) {
                  minVal = val;
                  if (minVal === 0) break;
                }
              }
            }
          }
          if (minVal === 0) break;
        }
        result[rowOffset + x] = minVal;
      }
    }

    return result;
  }
}
