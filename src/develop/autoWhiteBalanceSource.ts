import type { IAssetManager } from '../types/asset';
import type { DevelopDocument } from '../types/develop';
import { getPlatformBridge } from '../platform';
import { srgbToLinear } from '../engine/developColorMath';

/** Always unedited source pixels. RAW sampling bypasses 8-bit preview and canvas. */
export async function readAutoWhiteBalanceSource(doc: DevelopDocument, assets: IAssetManager): Promise<number[][]> {
  if (doc.isRaw) {
    if (!doc.nativeAssetId || doc.rawState !== 'ready') throw new Error('Automatic white balance requires a decoded RAW source');
    const bridge = getPlatformBridge();
    if (!bridge.getRawLinearSample) throw new Error('Automatic white balance source sampling is unavailable');
    return bridge.getRawLinearSample(doc.nativeAssetId);
  }
  const blob = doc.sourceAssetId ? await assets.getBlob(doc.sourceAssetId) : null;
  if (!blob || typeof createImageBitmap === 'undefined') throw new Error('Automatic white balance source pixels are unavailable');
  const bitmap = await createImageBitmap(blob);
  try {
    const width = Math.min(128, bitmap.width), height = Math.min(128, bitmap.height);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Automatic white balance pixel sampling is unavailable');
    // Nearest samples avoid creating gray pixels by averaging strongly colored objects.
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const samples: number[][] = [];
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 250) continue;
      samples.push([srgbToLinear(rgba[i] / 255), srgbToLinear(rgba[i + 1] / 255), srgbToLinear(rgba[i + 2] / 255)]);
    }
    return samples;
  } finally { bitmap.close(); }
}
