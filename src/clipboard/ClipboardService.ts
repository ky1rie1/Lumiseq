// src/clipboard/ClipboardService.ts
//! Native Clipboard Service for Windows Desktop (Stage 1A)
//! Provides high-performance RGBA bitmap encoding, layer/selection copying,
//! and native image pasting integrated into CommandBus undo/redo.

import { defaultAssetManager } from '../assets/AssetManager';
import { PasteImageCommand } from '../commands/edit/PasteImageCommand';
import { createImageLayer } from '../document/EditDocument';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultCommandBus } from '../history/CommandBus';
import { getPlatformBridge, IPlatformBridge } from '../platform';
import { IAssetManager } from '../types/asset';
import { IDocumentManager } from '../types/document';
import { ImageLayer } from '../types/edit';
import { ICommandBus } from '../types/history';

export interface ClipboardServiceDeps {
  bridge?: IPlatformBridge;
  assetManager?: IAssetManager;
  documentManager?: IDocumentManager;
  commandBus?: ICommandBus;
}

/**
 * Pure, zero-dependency 32-bit uncompressed BMP encoder.
 * Encodes RGBA bytes into a valid image/bmp Blob.
 * Works synchronously in Node.js, Vitest, Web Workers, and browsers.
 */
export function rgbaToBmpBlob(rgba: Uint8Array | number[], width: number, height: number): Blob {
  if (width <= 0 || height <= 0) {
    throw new RangeError(`Invalid image dimensions: ${width}x${height}`);
  }

  const pixelCount = width * height;
  const headerSize = 54;
  const imageSize = pixelCount * 4;
  const fileSize = headerSize + imageSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  // --- BMP File Header (14 bytes) ---
  // Signature 'BM'
  view.setUint8(0, 0x42);
  view.setUint8(1, 0x4d);
  // Total file size
  view.setUint32(2, fileSize, true);
  // Reserved (0)
  view.setUint32(6, 0, true);
  // Offset to pixel array (54)
  view.setUint32(10, headerSize, true);

  // --- DIB Header (BITMAPINFOHEADER - 40 bytes) ---
  // Header size (40)
  view.setUint32(14, 40, true);
  // Width
  view.setInt32(18, width, true);
  // Negative height = top-down row order (no vertical flipping required)
  view.setInt32(22, -height, true);
  // Color planes (1)
  view.setUint16(26, 1, true);
  // Bits per pixel (32 for BGRA)
  view.setUint16(28, 32, true);
  // Compression (0 = BI_RGB)
  view.setUint32(30, 0, true);
  // Image size
  view.setUint32(34, imageSize, true);
  // Horizontal resolution (2835 ppm ~ 72 DPI)
  view.setInt32(38, 2835, true);
  // Vertical resolution (2835 ppm ~ 72 DPI)
  view.setInt32(42, 2835, true);
  // Colors in palette
  view.setUint32(46, 0, true);
  // Important colors
  view.setUint32(50, 0, true);

  // --- Pixel Data (BGRA format) ---
  let src = 0;
  let dst = headerSize;
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[src++];
    const g = rgba[src++];
    const b = rgba[src++];
    const a = rgba[src++];
    out[dst++] = b;
    out[dst++] = g;
    out[dst++] = r;
    out[dst++] = a;
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

/**
 * Extracts raw RGBA pixels from an HTML Image, Canvas, or Blob.
 */
export async function extractRgbaFromBlob(blob: Blob): Promise<{ width: number; height: number; rgba: Uint8Array } | null> {
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(blob);
      const w = bitmap.width;
      const h = bitmap.height;
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          const imgData = ctx.getImageData(0, 0, w, h);
          bitmap.close();
          return { width: w, height: h, rgba: new Uint8Array(imgData.data.buffer) };
        }
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          const imgData = ctx.getImageData(0, 0, w, h);
          bitmap.close();
          return { width: w, height: h, rgba: new Uint8Array(imgData.data.buffer) };
        }
      }
      bitmap.close();
    } catch (e) {
      console.warn('extractRgbaFromBlob via createImageBitmap failed:', e);
    }
  }

  // Fallback: check if the blob is already our raw BMP format
  if (blob.type === 'image/bmp' && blob.size >= 54) {
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    if (view.getUint8(0) === 0x42 && view.getUint8(1) === 0x4d) {
      const w = Math.abs(view.getInt32(18, true));
      const h = Math.abs(view.getInt32(22, true));
      const pixelCount = w * h;
      const out = new Uint8Array(pixelCount * 4);
      const raw = new Uint8Array(buffer, 54);
      let src = 0;
      let dst = 0;
      for (let i = 0; i < pixelCount; i++) {
        const b = raw[src++];
        const g = raw[src++];
        const r = raw[src++];
        const a = raw[src++];
        out[dst++] = r;
        out[dst++] = g;
        out[dst++] = b;
        out[dst++] = a;
      }
      return { width: w, height: h, rgba: out };
    }
  }

  return null;
}

/**
 * Reads image data from system clipboard and inserts it as a new ImageLayer
 * into the target document via PasteImageCommand.
 */
export async function pasteClipboardImageToDocument(
  documentId: string,
  deps: ClipboardServiceDeps = {}
): Promise<ImageLayer | null> {
  const bridge = deps.bridge || getPlatformBridge();
  const assetMgr = deps.assetManager || defaultAssetManager;
  const docMgr = deps.documentManager || defaultDocumentManager;
  const bus = deps.commandBus || defaultCommandBus;

  const clip = await bridge.readClipboardImage();
  if (!clip || clip.width <= 0 || clip.height <= 0 || !clip.rgbaBytes || clip.rgbaBytes.length === 0) {
    return null;
  }

  const doc = docMgr.getEditDocument(documentId);
  if (!doc) {
    console.warn(`[ClipboardService] Cannot paste: Edit document "${documentId}" not found.`);
    return null;
  }

  // Convert raw RGBA into standard BMP Blob for AssetManager
  const blob = rgbaToBmpBlob(clip.rgbaBytes, clip.width, clip.height);
  const handle = await assetMgr.registerBlob(blob, 'image', `粘贴图像 ${clip.width}×${clip.height}`, {
    width: clip.width,
    height: clip.height,
  });

  // Calculate centered placement in canvas
  const x = Math.max(0, Math.round((doc.width - clip.width) / 2));
  const y = Math.max(0, Math.round((doc.height - clip.height) / 2));

  const layer = createImageLayer({
    name: `粘贴图层 ${doc.layers.length + 1}`,
    sourceAssetId: handle.id,
    naturalWidth: clip.width,
    naturalHeight: clip.height,
    x,
    y,
  });

  // Execute through CommandBus for single-step Undo/Redo
  const cmd = new PasteImageCommand(documentId, layer, docMgr);
  bus.execute(cmd);

  return layer;
}

/**
 * Copies the currently selected layer's pixel content to the native clipboard.
 */
export async function copyActiveLayerToClipboard(
  documentId: string,
  deps: ClipboardServiceDeps = {}
): Promise<boolean> {
  const bridge = deps.bridge || getPlatformBridge();
  const assetMgr = deps.assetManager || defaultAssetManager;
  const docMgr = deps.documentManager || defaultDocumentManager;

  const doc = docMgr.getEditDocument(documentId);
  if (!doc || !doc.selectedLayerId) return false;

  const layer = doc.layers.find((l) => l.id === doc.selectedLayerId);
  if (!layer) return false;

  let sourceAssetId: string | undefined;
  if (layer.type === 'image') {
    sourceAssetId = layer.sourceAssetId;
  } else if (layer.type === 'paint' || layer.type === 'retouch') {
    sourceAssetId = layer.rasterAssetId;
  } else if (layer.type === 'generated-patch') {
    sourceAssetId = layer.sourceAssetId;
  }

  if (!sourceAssetId) {
    // Other layer types (text/adjustment) copy text or description
    if (layer.type === 'text') {
      await bridge.writeClipboardText(layer.text);
      return true;
    }
    return false;
  }

  const blob = await assetMgr.getBlob(sourceAssetId);
  if (!blob) return false;

  const extracted = await extractRgbaFromBlob(blob);
  if (!extracted) return false;

  await bridge.writeClipboardImage(extracted.width, extracted.height, extracted.rgba);
  return true;
}
