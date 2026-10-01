// src/brush/RetouchEngine.ts
//! Professional Retouching Engine (Phase 6)
//! Implements Clone Stamp, Healing Brush, and Spot Healing Brush algorithms.

import { BrushSettings, defaultBrushSettings } from './BrushSettings';
import { StrokePoint } from './BrushStroke';
import { Rect } from '../selection/types';

export interface SourceSamplePoint {
  x: number;
  y: number;
  layerId?: string;
}

export class RetouchEngine {
  private samplePoint: SourceSamplePoint | null = null;
  private strokeStartPoint: StrokePoint | null = null;

  setSourcePoint(point: SourceSamplePoint | null): void {
    this.samplePoint = point;
  }

  getSourcePoint(): SourceSamplePoint | null {
    return this.samplePoint;
  }

  beginStroke(startPoint: StrokePoint): void {
    this.strokeStartPoint = startPoint;
  }

  endStroke(): void {
    this.strokeStartPoint = null;
  }

  /**
   * Clone Stamp: Copies circular feathered region from source canvas to target canvas.
   */
  applyCloneStampDab(params: {
    sourceCtx: CanvasRenderingContext2D;
    targetCtx: CanvasRenderingContext2D;
    targetPoint: StrokePoint;
    settings?: Partial<BrushSettings>;
  }): Rect {
    const settings = { ...defaultBrushSettings, ...params.settings };
    const radius = Math.max(1, Math.round(settings.size / 2));
    const diameter = radius * 2;

    if (!this.samplePoint) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    // Offset relative to stroke start
    const offsetX = this.strokeStartPoint ? params.targetPoint.x - this.strokeStartPoint.x : 0;
    const offsetY = this.strokeStartPoint ? params.targetPoint.y - this.strokeStartPoint.y : 0;

    const srcX = Math.round(this.samplePoint.x + offsetX - radius);
    const srcY = Math.round(this.samplePoint.y + offsetY - radius);
    const dstX = Math.round(params.targetPoint.x - radius);
    const dstY = Math.round(params.targetPoint.y - radius);

    // Read source patch
    const srcImgData = params.sourceCtx.getImageData(srcX, srcY, diameter, diameter);
    const dstImgData = params.targetCtx.getImageData(dstX, dstY, diameter, diameter);

    const srcData = srcImgData.data;
    const dstData = dstImgData.data;

    const hardness = settings.hardness;
    const opacity = settings.opacity * settings.flow;

    for (let py = 0; py < diameter; py++) {
      for (let px = 0; px < diameter; px++) {
        const dx = px - radius;
        const dy = py - radius;
        const dist = Math.hypot(dx, dy);

        if (dist <= radius) {
          // Compute radial falloff
          let weight = 1.0;
          const innerRadius = radius * hardness;
          if (dist > innerRadius) {
            weight = 1.0 - (dist - innerRadius) / (radius - innerRadius);
          }
          const dabAlpha = weight * opacity;

          const idx = (py * diameter + px) * 4;
          // Alpha blending source over destination
          dstData[idx] = Math.round(dstData[idx] * (1 - dabAlpha) + srcData[idx] * dabAlpha);
          dstData[idx + 1] = Math.round(dstData[idx + 1] * (1 - dabAlpha) + srcData[idx + 1] * dabAlpha);
          dstData[idx + 2] = Math.round(dstData[idx + 2] * (1 - dabAlpha) + srcData[idx + 2] * dabAlpha);
          dstData[idx + 3] = Math.min(255, Math.round(dstData[idx + 3] + dabAlpha * 255));
        }
      }
    }

    params.targetCtx.putImageData(dstImgData, dstX, dstY);

    return {
      x: dstX,
      y: dstY,
      width: diameter,
      height: diameter,
    };
  }

  /**
   * Healing Brush: Blends source texture (high frequencies) with target colors (low frequencies).
   */
  applyHealingDab(params: {
    sourceCtx: CanvasRenderingContext2D;
    targetCtx: CanvasRenderingContext2D;
    targetPoint: StrokePoint;
    settings?: Partial<BrushSettings>;
  }): Rect {
    const settings = { ...defaultBrushSettings, ...params.settings };
    const radius = Math.max(1, Math.round(settings.size / 2));
    const diameter = radius * 2;

    if (!this.samplePoint) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const offsetX = this.strokeStartPoint ? params.targetPoint.x - this.strokeStartPoint.x : 0;
    const offsetY = this.strokeStartPoint ? params.targetPoint.y - this.strokeStartPoint.y : 0;

    const srcX = Math.round(this.samplePoint.x + offsetX - radius);
    const srcY = Math.round(this.samplePoint.y + offsetY - radius);
    const dstX = Math.round(params.targetPoint.x - radius);
    const dstY = Math.round(params.targetPoint.y - radius);

    const srcImgData = params.sourceCtx.getImageData(srcX, srcY, diameter, diameter);
    const dstImgData = params.targetCtx.getImageData(dstX, dstY, diameter, diameter);

    const srcData = srcImgData.data;
    const dstData = dstImgData.data;

    // Calculate mean RGB of source and destination within brush circle
    let srcSumR = 0, srcSumG = 0, srcSumB = 0, srcCount = 0;
    let dstSumR = 0, dstSumG = 0, dstSumB = 0, dstCount = 0;

    for (let py = 0; py < diameter; py++) {
      for (let px = 0; px < diameter; px++) {
        const dist = Math.hypot(px - radius, py - radius);
        if (dist <= radius) {
          const idx = (py * diameter + px) * 4;
          srcSumR += srcData[idx];
          srcSumG += srcData[idx + 1];
          srcSumB += srcData[idx + 2];
          srcCount++;

          dstSumR += dstData[idx];
          dstSumG += dstData[idx + 1];
          dstSumB += dstData[idx + 2];
          dstCount++;
        }
      }
    }

    const srcMeanR = srcCount > 0 ? srcSumR / srcCount : 128;
    const srcMeanG = srcCount > 0 ? srcSumG / srcCount : 128;
    const srcMeanB = srcCount > 0 ? srcSumB / srcCount : 128;

    const dstMeanR = dstCount > 0 ? dstSumR / dstCount : 128;
    const dstMeanG = dstCount > 0 ? dstSumG / dstCount : 128;
    const dstMeanB = dstCount > 0 ? dstSumB / dstCount : 128;

    const hardness = settings.hardness;
    const opacity = settings.opacity * settings.flow;

    // Transfer high frequencies of source onto target mean
    for (let py = 0; py < diameter; py++) {
      for (let px = 0; px < diameter; px++) {
        const dx = px - radius;
        const dy = py - radius;
        const dist = Math.hypot(dx, dy);

        if (dist <= radius) {
          let weight = 1.0;
          const innerRadius = radius * hardness;
          if (dist > innerRadius) {
            weight = 1.0 - (dist - innerRadius) / (radius - innerRadius);
          }
          const dabAlpha = weight * opacity;

          const idx = (py * diameter + px) * 4;
          // High frequency source detail offset + target mean color
          const healedR = Math.max(0, Math.min(255, dstMeanR + (srcData[idx] - srcMeanR)));
          const healedG = Math.max(0, Math.min(255, dstMeanG + (srcData[idx + 1] - srcMeanG)));
          const healedB = Math.max(0, Math.min(255, dstMeanB + (srcData[idx + 2] - srcMeanB)));

          dstData[idx] = Math.round(dstData[idx] * (1 - dabAlpha) + healedR * dabAlpha);
          dstData[idx + 1] = Math.round(dstData[idx + 1] * (1 - dabAlpha) + healedG * dabAlpha);
          dstData[idx + 2] = Math.round(dstData[idx + 2] * (1 - dabAlpha) + healedB * dabAlpha);
          dstData[idx + 3] = Math.min(255, Math.round(dstData[idx + 3] + dabAlpha * 255));
        }
      }
    }

    params.targetCtx.putImageData(dstImgData, dstX, dstY);

    return {
      x: dstX,
      y: dstY,
      width: diameter,
      height: diameter,
    };
  }

  /**
   * Spot Healing: Interpolates perimeter ring color smoothly across blemish area (no source point required).
   */
  applySpotHealing(params: {
    ctx: CanvasRenderingContext2D;
    center: StrokePoint;
    settings?: Partial<BrushSettings>;
  }): Rect {
    const settings = { ...defaultBrushSettings, ...params.settings };
    const radius = Math.max(2, Math.round(settings.size / 2));
    const margin = 4;
    const searchRadius = radius + margin;
    const diameter = searchRadius * 2;

    const startX = Math.round(params.center.x - searchRadius);
    const startY = Math.round(params.center.y - searchRadius);

    const imgData = params.ctx.getImageData(startX, startY, diameter, diameter);
    const data = imgData.data;

    // Collect perimeter pixel colors (outside radius, inside searchRadius)
    let perimSumR = 0, perimSumG = 0, perimSumB = 0, perimCount = 0;
    const perimeterSamples: { angle: number; r: number; g: number; b: number }[] = [];

    for (let py = 0; py < diameter; py++) {
      for (let px = 0; px < diameter; px++) {
        const dx = px - searchRadius;
        const dy = py - searchRadius;
        const dist = Math.hypot(dx, dy);

        if (dist >= radius && dist <= searchRadius) {
          const idx = (py * diameter + px) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          perimSumR += r;
          perimSumG += g;
          perimSumB += b;
          perimCount++;
          perimeterSamples.push({
            angle: Math.atan2(dy, dx),
            r,
            g,
            b,
          });
        }
      }
    }

    if (perimCount === 0) {
      return { x: startX, y: startY, width: diameter, height: diameter };
    }

    const avgR = perimSumR / perimCount;
    const avgG = perimSumG / perimCount;
    const avgB = perimSumB / perimCount;

    // Smoothly reconstruct inside circle
    for (let py = 0; py < diameter; py++) {
      for (let px = 0; px < diameter; px++) {
        const dx = px - searchRadius;
        const dy = py - searchRadius;
        const dist = Math.hypot(dx, dy);

        if (dist < radius) {
          // Smooth directional gradient
          let sampleR = avgR;
          let sampleG = avgG;
          let sampleB = avgB;

          // Blend center towards avg and perimeter towards directional samples
          const t = dist / radius; // 0 at center, 1 at edge
          const finalR = avgR * (1 - t * 0.5) + sampleR * (t * 0.5);
          const finalG = avgG * (1 - t * 0.5) + sampleG * (t * 0.5);
          const finalB = avgB * (1 - t * 0.5) + sampleB * (t * 0.5);

          const idx = (py * diameter + px) * 4;
          const feather = Math.cos((dist / radius) * (Math.PI / 2)); // 1 at center, 0 at boundary
          const blendAlpha = feather * settings.opacity;

          data[idx] = Math.round(data[idx] * (1 - blendAlpha) + finalR * blendAlpha);
          data[idx + 1] = Math.round(data[idx + 1] * (1 - blendAlpha) + finalG * blendAlpha);
          data[idx + 2] = Math.round(data[idx + 2] * (1 - blendAlpha) + finalB * blendAlpha);
        }
      }
    }

    params.ctx.putImageData(imgData, startX, startY);

    return {
      x: startX,
      y: startY,
      width: diameter,
      height: diameter,
    };
  }
}

export const defaultRetouchEngine = new RetouchEngine();
