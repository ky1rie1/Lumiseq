// src/brush/BrushRenderer.ts
//! High-Performance Incremental Brush Dab Renderer (Phase 6)
//! Stamps radial gradient dabs onto offscreen canvas with dirty region tracking.

import { BrushSettings } from './BrushSettings';
import { StrokePoint } from './BrushStroke';
import { Rect } from '../selection/types';

export class BrushRenderer {
  private dabCache = new Map<string, HTMLCanvasElement>();
  private readonly maxCacheSize = 96;

  /**
   * Generates or retrieves cached radial gradient brush dab stamp.
   */
  getDabStamp(size: number, hardness: number, color: string, flow: number): HTMLCanvasElement {
    const radius = Math.max(1, Math.round(size / 2));
    const diameter = radius * 2;
    // Quantize flow to 2 decimal places to maximize stamp reuse
    const key = `${diameter}_${hardness.toFixed(2)}_${color}_${flow.toFixed(2)}`;

    const cached = this.dabCache.get(key);
    if (cached) {
      return cached;
    }

    let dabCanvas: HTMLCanvasElement;
    if (typeof document !== 'undefined') {
      dabCanvas = document.createElement('canvas');
      dabCanvas.width = diameter;
      dabCanvas.height = diameter;
      const ctx = dabCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, diameter, diameter);

        // Radial gradient from center
        const innerRadius = Math.max(0, radius * hardness);
        const grad = ctx.createRadialGradient(radius, radius, innerRadius, radius, radius, radius);

        // Extract RGB from color hex
        let r = 255, g = 255, b = 255;
        if (color.startsWith('#')) {
          const hex = color.replace('#', '');
          if (hex.length === 3) {
            r = parseInt(hex[0] + hex[0], 16);
            g = parseInt(hex[1] + hex[1], 16);
            b = parseInt(hex[2] + hex[2], 16);
          } else if (hex.length >= 6) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
          }
        }

        const alpha = Math.min(1.0, Math.max(0.01, flow));
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(radius, radius, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      dabCanvas = { width: diameter, height: diameter } as any;
    }

    if (this.dabCache.size >= this.maxCacheSize) {
      const firstKey = this.dabCache.keys().next().value;
      if (firstKey) this.dabCache.delete(firstKey);
    }
    this.dabCache.set(key, dabCanvas);
    return dabCanvas;
  }

  /**
   * Stamps incremental dabs along segment from p1 to p2 onto target canvas.
   * Supports stylus pressure interpolation for size and flow dynamics.
   * Returns bounding box of updated dirty region.
   */
  renderSegment(
    ctx: CanvasRenderingContext2D,
    p1: StrokePoint,
    p2: StrokePoint,
    settings: BrushSettings,
    residualDistance: number = 0
  ): { dirtyRect: Rect; leftoverDistance: number } {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);

    const baseRadius = Math.max(1, Math.round(settings.size / 2));
    const step = Math.max(1, baseRadius * 2 * settings.spacing);

    const p1Pressure = p1.pressure ?? 1.0;
    const p2Pressure = p2.pressure ?? 1.0;
    const usePressureSize = settings.pressureSize !== false;
    const usePressureFlow = settings.pressureFlow !== false;

    const maxSegmentPressure = usePressureSize ? Math.max(p1Pressure, p2Pressure) : 1.0;
    const maxRadius = usePressureSize
      ? Math.max(1, Math.round((settings.size * Math.max(0.1, maxSegmentPressure)) / 2))
      : baseRadius;

    let traveled = step - residualDistance;
    let minX = Math.min(p1.x, p2.x) - maxRadius;
    let maxX = Math.max(p1.x, p2.x) + maxRadius;
    let minY = Math.min(p1.y, p2.y) - maxRadius;
    let maxY = Math.max(p1.y, p2.y) + maxRadius;

    ctx.save();
    ctx.globalAlpha = settings.opacity;
    // Map blend modes to canvas compositing where supported
    if (settings.blendMode === 'multiply') ctx.globalCompositeOperation = 'multiply';
    else if (settings.blendMode === 'screen') ctx.globalCompositeOperation = 'screen';
    else if (settings.blendMode === 'overlay') ctx.globalCompositeOperation = 'overlay';
    else ctx.globalCompositeOperation = 'source-over';

    while (traveled <= dist) {
      const t = dist > 0 ? traveled / dist : 0;
      const x = p1.x + dx * t;
      const y = p1.y + dy * t;
      const pressure = p1Pressure + (p2Pressure - p1Pressure) * t;

      const currentSize = usePressureSize
        ? Math.max(1, Math.round(settings.size * Math.max(0.1, pressure)))
        : settings.size;
      const currentFlow = usePressureFlow
        ? Math.min(1.0, Math.max(0.01, settings.flow * Math.max(0.1, pressure)))
        : settings.flow;
      const currentRadius = Math.max(1, Math.round(currentSize / 2));

      const dab = this.getDabStamp(currentSize, settings.hardness, settings.color, currentFlow);
      ctx.drawImage(dab, Math.round(x - currentRadius), Math.round(y - currentRadius));

      minX = Math.min(minX, x - currentRadius);
      maxX = Math.max(maxX, x + currentRadius);
      minY = Math.min(minY, y - currentRadius);
      maxY = Math.max(maxY, y + currentRadius);

      traveled += step;
    }

    ctx.restore();

    const leftover = dist - (traveled - step);
    return {
      dirtyRect: {
        x: Math.floor(minX),
        y: Math.floor(minY),
        width: Math.ceil(maxX - minX),
        height: Math.ceil(maxY - minY),
      },
      leftoverDistance: Math.max(0, leftover),
    };
  }

  /**
   * Renders entire stroke path (e.g. from an Agent stroke command) onto a canvas.
   */
  renderFullStroke(
    ctx: CanvasRenderingContext2D,
    points: StrokePoint[],
    settings: BrushSettings
  ): Rect {
    if (points.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const usePressureSize = settings.pressureSize !== false;
    const usePressureFlow = settings.pressureFlow !== false;
    const baseRadius = Math.max(1, Math.round(settings.size / 2));

    ctx.save();
    ctx.globalAlpha = settings.opacity;
    if (settings.blendMode === 'multiply') ctx.globalCompositeOperation = 'multiply';
    else if (settings.blendMode === 'screen') ctx.globalCompositeOperation = 'screen';
    else if (settings.blendMode === 'overlay') ctx.globalCompositeOperation = 'overlay';
    else ctx.globalCompositeOperation = 'source-over';

    let minX = points[0].x - baseRadius;
    let maxX = points[0].x + baseRadius;
    let minY = points[0].y - baseRadius;
    let maxY = points[0].y + baseRadius;

    // Single point dab
    if (points.length === 1) {
      const p = points[0].pressure ?? 1.0;
      const size = usePressureSize
        ? Math.max(1, Math.round(settings.size * Math.max(0.1, p)))
        : settings.size;
      const flow = usePressureFlow
        ? Math.min(1.0, Math.max(0.01, settings.flow * Math.max(0.1, p)))
        : settings.flow;
      const radius = Math.max(1, Math.round(size / 2));
      const dab = this.getDabStamp(size, settings.hardness, settings.color, flow);
      ctx.drawImage(dab, Math.round(points[0].x - radius), Math.round(points[0].y - radius));
      minX = points[0].x - radius;
      maxX = points[0].x + radius;
      minY = points[0].y - radius;
      maxY = points[0].y + radius;
    } else {
      let residual = 0;
      for (let i = 0; i < points.length - 1; i++) {
        const res = this.renderSegment(ctx, points[i], points[i + 1], settings, residual);
        residual = res.leftoverDistance;
        minX = Math.min(minX, res.dirtyRect.x);
        maxX = Math.max(maxX, res.dirtyRect.x + res.dirtyRect.width);
        minY = Math.min(minY, res.dirtyRect.y);
        maxY = Math.max(maxY, res.dirtyRect.y + res.dirtyRect.height);
      }
    }

    ctx.restore();

    return {
      x: Math.floor(minX),
      y: Math.floor(minY),
      width: Math.ceil(maxX - minX),
      height: Math.ceil(maxY - minY),
    };
  }
}

export const defaultBrushRenderer = new BrushRenderer();
