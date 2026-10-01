// src/engine/HistogramScheduler.ts
import { HistogramData } from '../types/engine';
import { computeHistogramFromImageData } from './histogram';

export type HistogramCallback = (data: HistogramData) => void;

export class HistogramScheduler {
  private lastRunTime: number = 0;
  private readonly throttleIntervalMs: number = 100; // ~10 FPS for histogram while preview is 60 FPS
  private pendingTimer: any = null;
  private currentGeneration: number = 0;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private isProcessing: boolean = false;

  constructor(throttleIntervalMs = 100) {
    this.throttleIntervalMs = throttleIntervalMs;
  }

  /**
   * Schedules an asynchronous, downsampled histogram computation.
   * Cancels any stale pending work and throttles GPU readbacks.
   */
  schedule(sourceCanvas: HTMLCanvasElement, callback: HistogramCallback): void {
    this.currentGeneration += 1;
    const generation = this.currentGeneration;

    const now = performance.now();
    const elapsed = now - this.lastRunTime;

    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }

    if (elapsed >= this.throttleIntervalMs && !this.isProcessing) {
      this.execute(sourceCanvas, generation, callback);
    } else {
      const waitTime = Math.max(10, this.throttleIntervalMs - elapsed);
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        this.execute(sourceCanvas, generation, callback);
      }, waitTime);
    }
  }

  private async execute(
    sourceCanvas: HTMLCanvasElement,
    generation: number,
    callback: HistogramCallback
  ): Promise<void> {
    if (generation !== this.currentGeneration) {
      return; // Stale work discarded
    }

    this.isProcessing = true;
    this.lastRunTime = performance.now();

    try {
      // At most 262144 preview pixels; never upscale small images.
      const maxDim = Math.min(512, Math.max(sourceCanvas.width, sourceCanvas.height));
      if (!maxDim) return;
      const aspect = (sourceCanvas.width || 1) / (sourceCanvas.height || 1);
      const targetW = aspect >= 1 ? maxDim : Math.max(1, Math.round(maxDim * aspect));
      const targetH = aspect >= 1 ? Math.max(1, Math.round(maxDim / aspect)) : maxDim;

      if (!this.offscreenCanvas) {
        if (typeof document !== 'undefined') {
          this.offscreenCanvas = document.createElement('canvas');
        } else return;
      }

      if (this.offscreenCanvas) {
        this.offscreenCanvas.width = targetW;
        this.offscreenCanvas.height = targetH;
        const ctx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(sourceCanvas, 0, 0, targetW, targetH);
          const imgData = ctx.getImageData(0, 0, targetW, targetH);

          // If a newer generation has arrived while drawing/reading, discard
          if (generation === this.currentGeneration) {
            const histData = computeHistogramFromImageData(imgData.data, imgData.data.length);
            callback(histData);
          }
        }
      }
    } catch (err) {
      // Ignore security or context lost errors
    } finally {
      this.isProcessing = false;
    }
  }

  cancel(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.currentGeneration += 1;
  }
}

export const defaultHistogramScheduler = new HistogramScheduler(100);
