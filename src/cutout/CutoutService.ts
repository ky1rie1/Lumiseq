import type { EditDocument, Layer } from '../types/edit';
import { defaultAssetManager } from '../assets/AssetManager';
import { defaultLocalCutoutProvider } from './LocalCutoutProvider';
import { maskBounds } from './cutoutMath';
import { CUTOUT_MODEL } from './CutoutModelStore';
import { planCutoutRegion, placeRegionMask } from './cutoutRegion';

export function alphaCanvas(alpha: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  if (alpha.length !== width * height) throw new Error('蒙版尺寸不符。');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建蒙版预览。');
  const data = context.createImageData(width, height);
  for (let i = 0; i < alpha.length; i++) {
    data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = alpha[i]; data.data[i * 4 + 3] = 255;
  }
  context.putImageData(data, 0, 0); return canvas;
}

export function resizeAlpha(alpha: Uint8ClampedArray, width: number, height: number, targetWidth: number, targetHeight: number): Uint8ClampedArray {
  if (width === targetWidth && height === targetHeight) return new Uint8ClampedArray(alpha);
  const source = alphaCanvas(alpha, width, height), canvas = document.createElement('canvas');
  canvas.width = targetWidth; canvas.height = targetHeight;
  const context = canvas.getContext('2d'); if (!context) throw new Error('无法调整蒙版尺寸。');
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  const rgba = context.getImageData(0, 0, targetWidth, targetHeight).data;
  const output = new Uint8ClampedArray(targetWidth * targetHeight);
  for (let i = 0; i < output.length; i++) output[i] = rgba[i * 4];
  return output;
}

/** Segment the selected source alone in document coordinates, including its affine transform. */
export async function renderCutoutSource(doc: EditDocument, layer: Layer): Promise<HTMLCanvasElement> {
  if (!['image', 'paint', 'retouch', 'smart-object', 'generated-patch'].includes(layer.type)) throw new Error('请选择图像、绘画或修复图层。');
  if (doc.width * doc.height > 40_000_000) throw new Error('当前抠图工作台支持最多 4000 万像素，请先缩小画布。');
  const item = layer as unknown as { sourceAssetId?: string; rasterAssetId?: string };
  const blob = await defaultAssetManager.getBlob(item.sourceAssetId || item.rasterAssetId || '');
  if (!blob) throw new Error('目标图层的原始图像资源已丢失。');
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas'); canvas.width = doc.width; canvas.height = doc.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法读取目标图层。');
    const path = (layers: Layer[], id: string): Layer[] | undefined => {
      for (const candidate of layers) {
        if (candidate.id === id) return [candidate];
        if (candidate.type === 'group') { const children = path(candidate.children, id); if (children) return [candidate, ...children]; }
      }
      return undefined;
    };
    for (const target of path(doc.layers, layer.id) ?? [layer]) {
      ctx.translate(target.transform.x, target.transform.y);
      ctx.rotate(target.transform.rotation * Math.PI / 180);
      ctx.scale(target.transform.scaleX, target.transform.scaleY);
    }
    ctx.drawImage(bitmap, 0, 0, layer.transform.width, layer.transform.height);
    return canvas;
  } finally { bitmap.close(); }
}

export async function segmentForeground(image: ImageData | Blob | HTMLCanvasElement | HTMLImageElement, signal = new AbortController().signal) {
  let canvas: HTMLCanvasElement;
  if (image instanceof HTMLCanvasElement) canvas = image;
  else {
    canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法读取图像像素。');
    if (image instanceof Blob) {
      const bitmap = await createImageBitmap(image);
      canvas.width = bitmap.width; canvas.height = bitmap.height; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    } else if ('data' in image) {
      canvas.width = image.width; canvas.height = image.height; ctx.putImageData(image, 0, 0);
    } else {
      if (!image.complete || !image.naturalWidth) await image.decode();
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; ctx.drawImage(image, 0, 0);
    }
  }
  const start = performance.now();
  const mask = await inferForegroundCanvas(canvas, signal);
  signal.throwIfAborted();
  const bounds = maskBounds(mask, canvas.width, canvas.height);
  if (!bounds.width) throw new Error('未识别到前景，可重新选择目标或使用手动精修。');
  return { mask, width: canvas.width, height: canvas.height, bounds, confidence: 0, provider: 'birefnet-local', model: CUTOUT_MODEL.name, durationMs: performance.now() - start };
}

/** Give the fixed-size model the actual layer footprint when a document has transparent margins. */
export async function inferForegroundCanvas(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Uint8ClampedArray> {
  const thumbnail = document.createElement('canvas');
  const factor = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
  thumbnail.width = Math.max(1, Math.ceil(canvas.width * factor));
  thumbnail.height = Math.max(1, Math.ceil(canvas.height * factor));
  const context = thumbnail.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法读取抠图源图像。');
  context.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  const rgba = context.getImageData(0, 0, thumbnail.width, thumbnail.height).data;
  const alpha = new Uint8ClampedArray(thumbnail.width * thumbnail.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  const region = planCutoutRegion(alpha, thumbnail.width, thumbnail.height, canvas.width, canvas.height);
  const isFull = region.x === 0 && region.y === 0 && region.width === canvas.width && region.height === canvas.height;
  const input = isFull ? canvas : document.createElement('canvas');
  if (!isFull) {
    input.width = region.width;
    input.height = region.height;
    const cropContext = input.getContext('2d');
    if (!cropContext) throw new Error('无法裁切抠图源区域。');
    cropContext.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  }
  signal.throwIfAborted();
  const regionMask = await defaultLocalCutoutProvider.inferRefined(input, signal);
  signal.throwIfAborted();
  return placeRegionMask(regionMask, region, canvas.width, canvas.height);
}
