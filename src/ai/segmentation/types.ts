// src/ai/segmentation/types.ts
//! Data contracts and interfaces for AI-driven image segmentation

import { Rect } from '../../selection/types';

export interface SegmentationResult {
  mask: Uint8ClampedArray; // 8-bit grayscale mask (0 = background, 255 = foreground)
  width: number;
  height: number;
  confidence: number;      // 0.0 - 1.0 confidence score
  bounds: Rect;            // Tight bounding box of the detected subject/object
  provider: string;        // Provider identifier (e.g., 'mobilesam-local', 'saliency-fast')
  model: string;           // Model name / architecture
  durationMs: number;      // Inference time in milliseconds
}

export interface SegmentationOptions {
  threshold?: number;      // 0.0 - 1.0 binarization cutoff (default 0.5)
  featherRadius?: number;  // Soft edge radius
  removeIslands?: boolean; // Clean disconnected specks
  fillHoles?: boolean;     // Clean interior holes
  signal?: AbortSignal;    // Cancellation signal
}

export interface ISegmentationProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  /** Check if backend / weights are ready for inference */
  isReady(): Promise<boolean>;

  /** Segment main subject / foreground from image */
  segmentSubject(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    options?: SegmentationOptions
  ): Promise<SegmentationResult>;

  /** Interactive object segmentation from a prompt point (x, y) */
  segmentPoint(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    x: number,
    y: number,
    options?: SegmentationOptions
  ): Promise<SegmentationResult>;

  /** Object segmentation within a bounding box */
  segmentBox(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    box: Rect,
    options?: SegmentationOptions
  ): Promise<SegmentationResult>;

  /** Text-prompted semantic segmentation */
  segmentPrompt(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    prompt: string,
    options?: SegmentationOptions
  ): Promise<SegmentationResult>;

  /** Sky detection and segmentation */
  segmentSky(
    image: ImageData | HTMLImageElement | HTMLCanvasElement,
    options?: SegmentationOptions
  ): Promise<SegmentationResult>;
}
