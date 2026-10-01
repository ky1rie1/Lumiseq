// src/ai/inpainting/InpaintingService.ts
//! High-level Inpainting and Object Removal Orchestrator with Context-Crop and Non-Destructive Layer Generation

import { Rect } from '../../selection/types';
import { EditDocument, GeneratedPatchLayer } from '../../types/edit';
import { defaultAssetManager } from '../../assets/AssetManager';
import { defaultLocalInpaintingProvider } from './LocalInpaintingProvider';
import { IImageGenerationProvider, InpaintingOptions, InpaintingResult } from './types';
import { defaultCapabilityRouter } from '../capabilities/CapabilityRouter';
import { assertLayerEditable } from '../../edit/LayerTree';

export class InpaintingService {
  private activeProvider: IImageGenerationProvider = defaultLocalInpaintingProvider;

  setProvider(provider: IImageGenerationProvider): void {
    this.activeProvider = provider;
  }

  getProvider(): IImageGenerationProvider {
    return this.activeProvider;
  }

  /**
   * Execute context-aware inpainting for a given selection mask
   */
  async executeInpaint(
    document: EditDocument,
    sourceLayerId: string,
    selectionBounds: Rect,
    maskAssetId: string,
    options?: InpaintingOptions
  ): Promise<InpaintingResult> {
    assertLayerEditable(document, sourceLayerId);
    const paddingRatio = options?.contextPaddingRatio ?? 0.30;
    const maxDim = options?.maxDimension ?? 1024;

    // 1. Calculate padded Context-Crop Bounds in Document Coordinate Space (Section 35)
    const padW = selectionBounds.width * paddingRatio;
    const padH = selectionBounds.height * paddingRatio;

    const cropX = Math.max(0, Math.floor(selectionBounds.x - padW));
    const cropY = Math.max(0, Math.floor(selectionBounds.y - padH));
    const cropW = Math.min(document.width - cropX, Math.ceil(selectionBounds.width + padW * 2));
    const cropH = Math.min(document.height - cropY, Math.ceil(selectionBounds.height + padH * 2));

    const cropBounds: Rect = {
      x: cropX,
      y: cropY,
      width: Math.max(16, cropW),
      height: Math.max(16, cropH),
    };

    // 2. Render Context Crop and Mask Crop
    const { contextBlob, maskBlob } = await this.renderContextAndMaskCrops(
      document,
      sourceLayerId,
      cropBounds,
      maskAssetId,
      maxDim
    );

    // 3. Dispatch to Active Inpainting Capability via CapabilityRouter
    const imageEditCap = defaultCapabilityRouter.resolveImageEdit();
    const patchBlob = await imageEditCap.inpaint(contextBlob, maskBlob, options);

    const providerLabel = (imageEditCap.isLocalFallback || this.activeProvider.isLocal)
      ? this.activeProvider.id
      : (this.activeProvider.name || 'External API');

    // 4. Return result with metadata (No secrets/API keys stored!)
    return {
      patchBlob,
      width: cropBounds.width,
      height: cropBounds.height,
      bounds: cropBounds,
      metadata: {
        provider: providerLabel,
        model: imageEditCap.isLocalFallback ? 'Classical Diffusion Fallback' : this.activeProvider.name,
        prompt: options?.prompt,
        negativePrompt: options?.negativePrompt,
        seed: options?.seed,
        sourceDocumentId: document.id,
        sourceLayerId,
        maskId: maskAssetId,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Create a non-destructive GeneratedPatchLayer from inpainting result
   */
  async createPatchLayer(
    result: InpaintingResult,
    layerName: string = 'AI Removed Patch'
  ): Promise<GeneratedPatchLayer> {
    const sourceMaskId = result.metadata.maskId;
    const sourceMask = sourceMaskId ? defaultAssetManager.getHandle(sourceMaskId) : null;
    const maskBytes = sourceMaskId ? await defaultAssetManager.getMask(sourceMaskId) : null;
    if (!sourceMask || sourceMask.kind !== 'mask' || !maskBytes ||
        !Number.isSafeInteger(sourceMask.width) || !Number.isSafeInteger(sourceMask.height) ||
        sourceMask.width! <= 0 || sourceMask.height! <= 0 ||
        sourceMask.width! * sourceMask.height! !== maskBytes.length) {
      throw new Error('生成补丁缺少有效的选区蒙版。');
    }

    const patchAsset = await defaultAssetManager.registerBlob(
      result.patchBlob, 'image', `${layerName}_${Date.now()}`
    );
    let maskAsset;
    try {
      // Keep a snapshot: the active selection may be cleared or changed after generation.
      maskAsset = await defaultAssetManager.registerMask(
        maskBytes, sourceMask.width!, sourceMask.height!, `Mask_${Date.now()}`
      );
    } catch (error) {
      defaultAssetManager.releaseAsset(patchAsset.id);
      throw error;
    }

    return {
      id: `layer_patch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: layerName,
      type: 'generated-patch',
      visible: true,
      opacity: 1.0,
      blendMode: 'normal',
      sourceAssetId: patchAsset.id,
      maskAssetId: maskAsset.id,
      bounds: result.bounds,
      transform: {
        x: result.bounds.x,
        y: result.bounds.y,
        width: result.bounds.width,
        height: result.bounds.height,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      },
      generationMetadata: result.metadata,
    };
  }

  /**
   * Render context crop and mask crop into Blobs for the inpainting backend
   */
  private async renderContextAndMaskCrops(
    document: EditDocument,
    sourceLayerId: string,
    cropBounds: Rect,
    maskAssetId: string,
    _maxDim: number
  ): Promise<{ contextBlob: Blob; maskBlob: Blob }> {
    if (typeof window === 'undefined') {
      const dummy = new Blob([''], { type: 'image/png' });
      return { contextBlob: dummy, maskBlob: dummy };
    }

    const { width, height } = cropBounds;

    // 1. Context Image Canvas
    const ctxCanvas = window.document.createElement('canvas');
    ctxCanvas.width = width;
    ctxCanvas.height = height;
    const ctx2d = ctxCanvas.getContext('2d')!;

    // Find layer to crop from
    const targetLayer = document.layers.find((l) => l.id === sourceLayerId) || document.layers[0];
    if (targetLayer && targetLayer.type === 'image') {
      const url = defaultAssetManager.getDisplayUrl(targetLayer.sourceAssetId);
      if (url) {
        const img = new Image();
        img.src = url;
        await new Promise((resolve) => {
          if (img.complete) resolve(true);
          else img.onload = () => resolve(true);
        });
        // Draw slice matching cropBounds
        ctx2d.drawImage(
          img,
          cropBounds.x - targetLayer.transform.x,
          cropBounds.y - targetLayer.transform.y,
          width,
          height,
          0,
          0,
          width,
          height
        );
      }
    }

    // 2. Mask Crop Canvas
    const maskCanvas = window.document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const mask2d = maskCanvas.getContext('2d')!;

    const maskData = await defaultAssetManager.getMask(maskAssetId);
    if (maskData) {
      const imgData = mask2d.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        const docY = cropBounds.y + y;
        if (docY >= document.height) continue;
        const srcRow = docY * document.width;
        const dstRow = y * width;
        for (let x = 0; x < width; x++) {
          const docX = cropBounds.x + x;
          if (docX >= document.width) continue;
          const val = maskData[srcRow + docX];
          const dstIdx = (dstRow + x) * 4;
          imgData.data[dstIdx] = val;
          imgData.data[dstIdx + 1] = val;
          imgData.data[dstIdx + 2] = val;
          imgData.data[dstIdx + 3] = 255;
        }
      }
      mask2d.putImageData(imgData, 0, 0);
    }

    const contextBlob = await new Promise<Blob>((res) => ctxCanvas.toBlob((b) => res(b!), 'image/png'));
    const maskBlob = await new Promise<Blob>((res) => maskCanvas.toBlob((b) => res(b!), 'image/png'));

    return { contextBlob, maskBlob };
  }
}

export const defaultInpaintingService = new InpaintingService();
