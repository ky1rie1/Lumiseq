// src/ai/segmentation/LocalSegmentationProvider.ts
//! Explicit heuristic selection helpers. Neural foreground inference is in cutout/.

import { Rect } from '../../selection/types';
import { SelectionUtils } from '../../selection/SelectionUtils';
import { MaskProcessor } from './MaskProcessor';
import { ISegmentationProvider, SegmentationOptions, SegmentationResult } from './types';

export class LocalSegmentationProvider implements ISegmentationProvider {
  readonly id = 'heuristic-local';
  readonly name = 'Heuristic Selection Fallback (Offline Saliency)';
  readonly isLocal = true;

  async isReady(): Promise<boolean> {
    return true;
  }

  /**
   * Helper to extract raw RGBA pixels from HTMLImageElement, HTMLCanvasElement, or ImageData
   */
  private extractPixels(
    image: ImageData | HTMLImageElement | HTMLCanvasElement
  ): { data: Uint8ClampedArray; width: number; height: number } {
    if ('data' in image && image.data instanceof Uint8ClampedArray) {
      return { data: image.data, width: image.width, height: image.height };
    }

    const width = (image as any).naturalWidth || image.width || 1000;
    const height = (image as any).naturalHeight || image.height || 1000;

    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(image as any, 0, 0, width, height);
        const imgData = ctx.getImageData(0, 0, width, height);
        return { data: imgData.data, width, height };
      }
    }

    // Fallback for non-DOM/node environments
    return {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    };
  }

  async segmentSubject(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    options?: SegmentationOptions
  ): Promise<SegmentationResult> {
    const startTime = Date.now();
    const { data, width, height } = this.extractPixels(image);

    // High-precision Center-Biased Saliency & Gradient Contrast Segmentation
    const rawMask = new Uint8ClampedArray(width * height);
    const cx = width / 2;
    const cy = height / 2;
    const maxDist2 = (cx * cx + cy * cy);

    // Compute average corner background color
    const cornerSamples = [0, (width - 1) * 4, ((height - 1) * width) * 4, ((height - 1) * width + width - 1) * 4];
    let bgR = 0, bgG = 0, bgB = 0;
    for (const c of cornerSamples) {
      bgR += data[c];
      bgG += data[c + 1];
      bgB += data[c + 2];
    }
    bgR /= 4;
    bgG /= 4;
    bgB /= 4;

    for (let y = 0; y < height; y++) {
      const dy = y - cy;
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const distCenterNorm = Math.sqrt((dx * dx + dy * dy) / maxDist2);
        const idx = (rowOffset + x) * 4;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Color distance from background corners
        const colorDiff = Math.sqrt(
          (r - bgR) * (r - bgR) +
          (g - bgG) * (g - bgG) +
          (b - bgB) * (b - bgB)
        );

        // Subject score: center proximity + color difference from background
        const score = (colorDiff / 255) * 0.65 + (1 - distCenterNorm) * 0.35;
        if (score >= (options?.threshold ?? 0.38)) {
          rawMask[rowOffset + x] = 255;
        }
      }
    }

    // Post-process mask: remove small noise islands, fill interior holes, feather
    const processed = MaskProcessor.process(rawMask, width, height, {
      removeIslands: options?.removeIslands !== false,
      minIslandArea: Math.max(32, Math.round(width * height * 0.001)),
      fillHoles: options?.fillHoles !== false,
      maxHoleArea: Math.max(64, Math.round(width * height * 0.002)),
      smoothEdges: true,
      featherRadius: options?.featherRadius ?? 1,
    });

    const bounds = SelectionUtils.getMaskBounds(processed, width, height);

    // Save in cache

    return {
      mask: processed,
      width,
      height,
      confidence: 0,
      bounds,
      provider: this.id,
      model: 'Center/Color Saliency (Heuristic)',
      durationMs: Date.now() - startTime,
    };
  }

  async segmentPoint(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    px: number,
    py: number,
    options?: SegmentationOptions
  ): Promise<SegmentationResult> {
    const startTime = Date.now();
    const { data, width, height } = this.extractPixels(image);
    const rawMask = new Uint8ClampedArray(width * height);

    const targetX = Math.max(0, Math.min(width - 1, Math.round(px)));
    const targetY = Math.max(0, Math.min(height - 1, Math.round(py)));
    const targetIdx = (targetY * width + targetX) * 4;

    const tR = data[targetIdx];
    const tG = data[targetIdx + 1];
    const tB = data[targetIdx + 2];

    // Seed-fill / connected region around target point
    const visited = new Uint8Array(width * height);
    const queue: [number, number][] = [[targetX, targetY]];
    visited[targetY * width + targetX] = 1;
    rawMask[targetY * width + targetX] = 255;

    const tolerance = 42; // Euclidean color distance threshold
    const maxRadius = Math.max(width, height) * 0.45;

    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const neighbors: [number, number][] = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nOffset = ny * width + nx;
        if (visited[nOffset]) continue;
        visited[nOffset] = 1;

        const distPoint = Math.hypot(nx - targetX, ny - targetY);
        if (distPoint > maxRadius) continue;

        const nIdx = nOffset * 4;
        const diff = Math.hypot(
          data[nIdx] - tR,
          data[nIdx + 1] - tG,
          data[nIdx + 2] - tB
        );

        if (diff <= tolerance) {
          rawMask[nOffset] = 255;
          queue.push([nx, ny]);
        }
      }
    }

    const processed = MaskProcessor.process(rawMask, width, height, {
      removeIslands: true,
      minIslandArea: 16,
      fillHoles: true,
      featherRadius: options?.featherRadius ?? 1,
    });

    const bounds = SelectionUtils.getMaskBounds(processed, width, height);

    return {
      mask: processed,
      width,
      height,
      confidence: 0,
      bounds,
      provider: this.id,
      model: 'Color Region Growing (Heuristic)',
      durationMs: Date.now() - startTime,
    };
  }

  async segmentBox(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    box: Rect,
    options?: SegmentationOptions
  ): Promise<SegmentationResult> {
    const startTime = Date.now();
    const { width, height } = this.extractPixels(image);
    const rawMask = new Uint8ClampedArray(width * height);

    const bx = Math.max(0, Math.min(width, Math.round(box.x)));
    const by = Math.max(0, Math.min(height, Math.round(box.y)));
    const bw = Math.max(0, Math.min(width - bx, Math.round(box.width)));
    const bh = Math.max(0, Math.min(height - by, Math.round(box.height)));

    // Extract foreground within bounding box
    const cx = bx + bw / 2;
    const cy = by + bh / 2;

    for (let y = by; y < by + bh; y++) {
      const rowOffset = y * width;
      for (let x = bx; x < bx + bw; x++) {
        const dx = (x - cx) / (bw / 2 || 1);
        const dy = (y - cy) / (bh / 2 || 1);
        // Elliptical falloff inside box
        if (dx * dx + dy * dy <= 1.0) {
          rawMask[rowOffset + x] = 255;
        }
      }
    }

    const processed = MaskProcessor.process(rawMask, width, height, {
      removeIslands: true,
      fillHoles: true,
      featherRadius: options?.featherRadius ?? 1,
    });

    const bounds = SelectionUtils.getMaskBounds(processed, width, height);

    return {
      mask: processed,
      width,
      height,
      confidence: 0,
      bounds,
      provider: this.id,
      model: 'Box Color Selection (Heuristic)',
      durationMs: Date.now() - startTime,
    };
  }

  async segmentPrompt(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    prompt: string,
    options?: SegmentationOptions
  ): Promise<SegmentationResult> {
    const lower = prompt.toLowerCase();
    if (lower.includes('sky')) {
      return this.segmentSky(image, options);
    }
    if (lower.includes('subject') || lower.includes('person') || lower.includes('foreground') || lower.includes('main')) {
      return this.segmentSubject(image, options);
    }
    // Default to subject segmentation
    return this.segmentSubject(image, options);
  }

  async segmentSky(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    options?: SegmentationOptions
  ): Promise<SegmentationResult> {
    const startTime = Date.now();
    const { data, width, height } = this.extractPixels(image);
    const rawMask = new Uint8ClampedArray(width * height);

    // Sky is typically in top 60% of image with high blue or high luminance
    const maxSkyY = Math.round(height * 0.65);

    for (let y = 0; y < maxSkyY; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const idx = (rowOffset + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Blue sky or bright overcast sky criteria
        const isBlueSky = b > r && b >= g && b > 80;
        const isOvercastSky = r > 180 && g > 180 && b > 180 && Math.abs(r - b) < 25;

        if (isBlueSky || isOvercastSky) {
          rawMask[rowOffset + x] = 255;
        }
      }
    }

    const processed = MaskProcessor.process(rawMask, width, height, {
      removeIslands: true,
      minIslandArea: Math.round(width * height * 0.005),
      fillHoles: true,
      featherRadius: options?.featherRadius ?? 2,
    });

    const bounds = SelectionUtils.getMaskBounds(processed, width, height);

    return {
      mask: processed,
      width,
      height,
      confidence: 0,
      bounds,
      provider: this.id,
      model: 'Sky Color/Position (Heuristic)',
      durationMs: Date.now() - startTime,
    };
  }
}

export const defaultSegmentationProvider = new LocalSegmentationProvider();
