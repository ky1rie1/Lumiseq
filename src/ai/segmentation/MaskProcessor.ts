// src/ai/segmentation/MaskProcessor.ts
//! High-precision mask post-processing: island removal, hole filling, edge smoothing, and feathering

import { SelectionUtils } from '../../selection/SelectionUtils';

export class MaskProcessor {
  /**
   * Remove disconnected specks / islands with pixel area less than minArea
   */
  static removeSmallIslands(
    mask: Uint8ClampedArray,
    width: number,
    height: number,
    minArea: number = 32
  ): Uint8ClampedArray {
    if (minArea <= 0) return new Uint8ClampedArray(mask);

    const result = new Uint8ClampedArray(mask);
    const visited = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (result[idx] === 0 || visited[idx]) continue;

        // BFS to measure connected component area
        const component: number[] = [];
        const queue: number[] = [idx];
        visited[idx] = 1;

        while (queue.length > 0) {
          const curr = queue.pop()!;
          component.push(curr);

          const cx = curr % width;
          const cy = Math.floor(curr / width);

          // 4-neighborhood
          const neighbors = [
            cy > 0 ? (cy - 1) * width + cx : -1,
            cy < height - 1 ? (cy + 1) * width + cx : -1,
            cx > 0 ? cy * width + (cx - 1) : -1,
            cx < width - 1 ? cy * width + (cx + 1) : -1,
          ];

          for (const n of neighbors) {
            if (n !== -1 && result[n] > 0 && !visited[n]) {
              visited[n] = 1;
              queue.push(n);
            }
          }
        }

        // If island is smaller than minArea, clear it
        if (component.length < minArea) {
          for (const pixelIdx of component) {
            result[pixelIdx] = 0;
          }
        }
      }
    }

    return result;
  }

  /**
   * Fill interior holes inside the foreground mask
   */
  static fillSmallHoles(
    mask: Uint8ClampedArray,
    width: number,
    height: number,
    maxHoleArea: number = 64
  ): Uint8ClampedArray {
    if (maxHoleArea <= 0) return new Uint8ClampedArray(mask);

    // Invert mask (holes become islands), remove small islands, invert back
    const inverted = SelectionUtils.invertMask(mask);
    const cleanedInverted = this.removeSmallIslands(inverted, width, height, maxHoleArea);
    return SelectionUtils.invertMask(cleanedInverted);
  }

  /**
   * Edge smoothing using a fast 3x3 median filter to eliminate aliasing without destroying fine edge detail
   */
  static edgeSmoothing(
    mask: Uint8ClampedArray,
    width: number,
    height: number
  ): Uint8ClampedArray {
    const result = new Uint8ClampedArray(mask.length);
    const window = new Uint8Array(9);

    for (let y = 1; y < height - 1; y++) {
      const rowPrev = (y - 1) * width;
      const rowCurr = y * width;
      const rowNext = (y + 1) * width;

      for (let x = 1; x < width - 1; x++) {
        // Collect 3x3 window
        window[0] = mask[rowPrev + x - 1];
        window[1] = mask[rowPrev + x];
        window[2] = mask[rowPrev + x + 1];
        window[3] = mask[rowCurr + x - 1];
        window[4] = mask[rowCurr + x];
        window[5] = mask[rowCurr + x + 1];
        window[6] = mask[rowNext + x - 1];
        window[7] = mask[rowNext + x];
        window[8] = mask[rowNext + x + 1];

        // Sort 9 values to find median (index 4)
        window.sort();
        result[rowCurr + x] = window[4];
      }
    }

    return result;
  }

  /**
   * Comprehensive cleanup pipeline
   */
  static process(
    rawMask: Uint8ClampedArray,
    width: number,
    height: number,
    options?: {
      removeIslands?: boolean;
      minIslandArea?: number;
      fillHoles?: boolean;
      maxHoleArea?: number;
      smoothEdges?: boolean;
      featherRadius?: number;
      growShrinkDelta?: number;
    }
  ): Uint8ClampedArray {
    let current = rawMask;

    if (options?.growShrinkDelta && options.growShrinkDelta !== 0) {
      current = options.growShrinkDelta > 0
        ? SelectionUtils.expandMask(current, width, height, options.growShrinkDelta)
        : SelectionUtils.contractMask(current, width, height, Math.abs(options.growShrinkDelta));
    }

    if (options?.removeIslands !== false) {
      current = this.removeSmallIslands(current, width, height, options?.minIslandArea ?? 32);
    }

    if (options?.fillHoles !== false) {
      current = this.fillSmallHoles(current, width, height, options?.maxHoleArea ?? 64);
    }

    if (options?.smoothEdges) {
      current = this.edgeSmoothing(current, width, height);
    }

    if (options?.featherRadius && options.featherRadius > 0) {
      current = SelectionUtils.featherMask(current, width, height, options.featherRadius);
    }

    return current;
  }
}
