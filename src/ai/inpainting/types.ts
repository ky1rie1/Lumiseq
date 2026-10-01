// src/ai/inpainting/types.ts
//! Contracts and interfaces for AI Inpainting, Object Removal, and Generative Fill

import { Rect } from '../../selection/types';

export interface InpaintingOptions {
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  contextPaddingRatio?: number; // default 0.30 (30% padding around selection)
  maxDimension?: number;        // default 1024
  signal?: AbortSignal;
}

export interface InpaintingResult {
  patchBlob: Blob;
  width: number;
  height: number;
  bounds: Rect; // Document coordinate space placement
  metadata: {
    provider: string;
    model: string;
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    sourceDocumentId: string;
    sourceLayerId?: string;
    selectionId?: string;
    maskId?: string;
    timestamp: number;
  };
}

export interface ImageProviderCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  inpainting: boolean;
  outpainting: boolean;
  maskInput: boolean;
  seed: boolean;
  maxPixels: number;
}

export interface IImageGenerationProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;
  readonly capabilities: ImageProviderCapabilities;

  /**
   * Execute inpainting / content-aware fill on a cropped context image and mask
   */
  inpaint(
    contextImageBlob: Blob,
    maskBlob: Blob,
    options?: InpaintingOptions
  ): Promise<Blob>;
}
