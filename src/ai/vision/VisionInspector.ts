// src/ai/vision/VisionInspector.ts
import { VisionSnapshot } from '../types';
import { DocumentManager } from '../../document/DocumentManager';
import { HistogramData } from '../../types/engine';
import type { DocumentObservationService } from './DocumentObservationService';
import type { DocumentObservation, ObservationRequest } from './observationTypes';

export class VisionInspector {
  private cachedCanvas: HTMLCanvasElement | null = null;
  private cachedHistogram: HistogramData | null = null;
  constructor(private observationService?: DocumentObservationService) {}

  setObservationService(service: DocumentObservationService | undefined): void {
    this.observationService = service;
  }

  /** Document-based vision for new callers; existing synchronous canvas APIs remain compatible. */
  observeDocument(request: ObservationRequest, signal?: AbortSignal): Promise<DocumentObservation> {
    if (!this.observationService) return Promise.reject(new Error('Document observation service is unavailable'));
    return this.observationService.observe(request, signal);
  }

  /**
   * Set active canvas reference from current Workspace view.
   */
  setActiveCanvas(canvas: HTMLCanvasElement | null, histogram?: HistogramData | null): void {
    this.cachedCanvas = canvas;
    if (histogram) {
      this.cachedHistogram = histogram;
    }
  }

  /**
   * Generates a downsampled JPEG DataURL (512 or 1024px) for multimodal LLM vision input.
   */
  getCanvasPreview(maxDimension: 512 | 1024 = 512): string | undefined {
    if (!this.cachedCanvas) return undefined;

    try {
      const srcW = this.cachedCanvas.width;
      const srcH = this.cachedCanvas.height;
      if (srcW === 0 || srcH === 0) return undefined;

      const scale = Math.min(1.0, maxDimension / Math.max(srcW, srcH));
      const targetW = Math.round(srcW * scale);
      const targetH = Math.round(srcH * scale);

      const offscreen = document.createElement('canvas');
      offscreen.width = targetW;
      offscreen.height = targetH;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return undefined;

      ctx.drawImage(this.cachedCanvas, 0, 0, targetW, targetH);
      return offscreen.toDataURL('image/jpeg', 0.82);
    } catch (err) {
      console.warn('VisionInspector: failed to capture canvas preview:', err);
      return undefined;
    }
  }

  /**
   * Generates a complete VisionSnapshot payload for the active document.
   */
  captureSnapshot(documentManager: DocumentManager, includeImage: boolean = true): VisionSnapshot {
    const activeDoc = documentManager.getActiveDocument();
    const snapshot: VisionSnapshot = {
      metadata: activeDoc ? {
        id: activeDoc.id,
        name: activeDoc.kind === 'develop' ? activeDoc.fileName : activeDoc.name,
        kind: activeDoc.kind,
        width: activeDoc.width,
        height: activeDoc.height,
      } : {},
      histogram: this.cachedHistogram ? {
        r: Array.from(this.cachedHistogram.r),
        g: Array.from(this.cachedHistogram.g),
        b: Array.from(this.cachedHistogram.b),
        luminance: Array.from(this.cachedHistogram.lum),
      } : undefined,
    };

    if (includeImage) {
      snapshot.preview512 = this.getCanvasPreview(512);
      snapshot.preview1024 = this.getCanvasPreview(1024);
    }

    return snapshot;
  }
}

export const defaultVisionInspector = new VisionInspector();
