// src/selection/SelectionRenderer.ts
//! High-performance Canvas/WebGL Marching Ants and Mask Overlay View Renderer

import { SelectionMask, SelectionViewMode } from './types';
import { defaultAssetManager } from '../assets/AssetManager';
import { buildSelectionOutline } from './selectionBoundary';

export class SelectionRenderer {
  private dashOffset: number = 0;
  private animFrameId: number | null = null;
  private isAnimating: boolean = false;
  private outlineCache: { assetId: string; path: Path2D } | null = null;

  startAnimation(onFrame: () => void): void {
    if (this.isAnimating) return;
    this.isAnimating = true;

    const loop = () => {
      this.dashOffset = (this.dashOffset + 0.5) % 8;
      onFrame();
      if (this.isAnimating) {
        this.animFrameId = requestAnimationFrame(loop);
      }
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  stopAnimation(): void {
    this.isAnimating = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /**
   * Render selection view effects on top of the document view
   */
  async renderSelectionOverlay(
    ctx: CanvasRenderingContext2D,
    selection: SelectionMask | null,
    viewMode: SelectionViewMode,
    scale: number,
    offsetX: number,
    offsetY: number,
    docWidth: number,
    docHeight: number
  ): Promise<void> {
    if (!selection || !selection.active || selection.bounds.width <= 0) return;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Build the outline once per mask asset; animation only changes its dash offset.
    let mask: Uint8ClampedArray | null = null;
    if (this.outlineCache?.assetId !== selection.assetId || viewMode === 'mask-overlay') {
      mask = await defaultAssetManager.getMask(selection.assetId);
    }
    if (mask && this.outlineCache?.assetId !== selection.assetId) {
      this.outlineCache = { assetId: selection.assetId, path: buildSelectionOutline(mask, docWidth, docHeight) };
    }

    // 1. Mask-Overlay View Mode (Rubylith red overlay over unselected areas)
    if (viewMode === 'mask-overlay') {
      if (mask) {
        this.drawRubylithOverlay(ctx, mask, docWidth, docHeight);
      }
    }

    // 2. Marching Ants on actual mask contours
    if (this.outlineCache?.assetId === selection.assetId) this.drawMarchingAnts(ctx, this.outlineCache.path);

    ctx.restore();
  }

  /**
   * Draw classic alternating black & white marching ants
   */
  private drawMarchingAnts(ctx: CanvasRenderingContext2D, path: Path2D): void {
    ctx.save();
    ctx.lineWidth = 1.5 / ctx.getTransform().a; // 1.5px constant visual width regardless of zoom

    // Black background stroke
    ctx.strokeStyle = '#000000';
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this.dashOffset;
    ctx.stroke(path);

    // White foreground stroke
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -this.dashOffset + 4;
    ctx.stroke(path);

    ctx.restore();
  }

  /**
   * Rubylith mask overlay
   */
  private drawRubylithOverlay(
    ctx: CanvasRenderingContext2D,
    mask: Uint8ClampedArray,
    width: number,
    height: number
  ): void {
    // Render semi-transparent red where mask value is < 128
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    const imgData = tempCtx.createImageData(width, height);
    const data = imgData.data;

    for (let i = 0; i < mask.length; i++) {
      const idx = i * 4;
      const maskVal = mask[i];
      if (maskVal < 255) {
        data[idx] = 255;     // R
        data[idx + 1] = 0;   // G
        data[idx + 2] = 0;   // B
        data[idx + 3] = Math.round((255 - maskVal) * 0.45); // Semi-transparent red
      }
    }

    tempCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0);
  }
}

export const defaultSelectionRenderer = new SelectionRenderer();
