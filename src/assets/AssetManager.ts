import { AssetHandle, AssetKind, IAssetManager, PreviewRequest, TileRequest } from '../types/asset';

interface AssetItem {
  handle: AssetHandle;
  blob: Blob;
  objectUrl: string | null;
  refCount: number;
  thumbnailUrl?: string;
  previewUrl?: string;
}

/**
 * Helper to probe raster image width and height from Blob
 */
async function probeImageDimensions(blob: Blob): Promise<{ width?: number; height?: number }> {
  try {
    if (typeof createImageBitmap !== 'undefined') {
      const bitmap = await createImageBitmap(blob);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      return { width, height };
    }

    if (typeof Image !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
      return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          URL.revokeObjectURL(url);
          resolve({ width: w, height: h });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({});
        };
        img.src = url;
      });
    }
  } catch (err) {
    console.warn('Could not probe image dimensions:', err);
  }

  return {};
}

export class AssetManager implements IAssetManager {
  private assets: Map<string, AssetItem> = new Map();
  private rawMaskCache: Map<string, Uint8ClampedArray> = new Map();

  async registerBlob(
    blob: Blob,
    kind: AssetKind,
    name: string,
    dimensions?: { width?: number; height?: number }
  ): Promise<AssetHandle> {
    const id = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const objectUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : null;

    let width = dimensions?.width;
    let height = dimensions?.height;

    // Automatically inspect dimensions if not provided and asset is an image
    if (kind === 'image' && (!width || !height)) {
      const probed = await probeImageDimensions(blob);
      if (probed.width) width = probed.width;
      if (probed.height) height = probed.height;
    }

    const handle: AssetHandle = {
      id,
      kind,
      name,
      mimeType: blob.type || 'application/octet-stream',
      sizeBytes: blob.size,
      width,
      height,
      createdAt: Date.now(),
    };

    this.assets.set(id, {
      handle,
      blob,
      objectUrl,
      refCount: 1,
    });

    return handle;
  }

  async registerMask(
    mask: Uint8ClampedArray,
    width: number,
    height: number,
    name: string = 'Mask'
  ): Promise<AssetHandle> {
    const id = `mask_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    // Cache the raw byte array in memory for zero-copy sync access
    this.rawMaskCache.set(id, new Uint8ClampedArray(mask));

    // Also wrap in Blob for standard asset operations
    const copyBuffer = new ArrayBuffer(mask.byteLength);
    new Uint8Array(copyBuffer).set(new Uint8Array(mask.buffer, mask.byteOffset, mask.byteLength));
    const blob = new Blob([copyBuffer], { type: 'application/octet-stream' });
    const handle: AssetHandle = {
      id,
      kind: 'mask',
      name,
      mimeType: 'application/octet-stream',
      sizeBytes: mask.byteLength,
      width,
      height,
      createdAt: Date.now(),
    };

    this.assets.set(id, {
      handle,
      blob,
      objectUrl: null,
      refCount: 1,
    });

    return handle;
  }

  async getMask(assetId: string): Promise<Uint8ClampedArray | null> {
    if (this.rawMaskCache.has(assetId)) {
      return this.rawMaskCache.get(assetId)!;
    }
    const item = this.assets.get(assetId);
    if (!item) return null;
    const arrayBuffer = await item.blob.arrayBuffer();
    const mask = new Uint8ClampedArray(arrayBuffer);
    this.rawMaskCache.set(assetId, mask);
    return mask;
  }

  getDisplayUrl(assetId: string): string | null {
    const item = this.assets.get(assetId);
    if (!item) return null;
    if (!item.objectUrl && typeof URL !== 'undefined' && URL.createObjectURL) {
      item.objectUrl = URL.createObjectURL(item.blob);
    }
    return item.objectUrl;
  }

  async getBlob(assetId: string): Promise<Blob | null> {
    const item = this.assets.get(assetId);
    return item ? item.blob : null;
  }

  async requestTile(request: TileRequest): Promise<AssetHandle | null> {
    const item = this.assets.get(request.assetId);
    if (!item) return null;

    const origW = item.handle.width || 0;
    const origH = item.handle.height || 0;
    if (request.width <= 0 || request.height <= 0) return null;

    // Full region match optimization
    if (request.x === 0 && request.y === 0 && origW === request.width && origH === request.height) {
      item.refCount += 1;
      return item.handle;
    }

    try {
      if (typeof createImageBitmap !== 'undefined') {
        const bitmap = await createImageBitmap(item.blob, request.x, request.y, request.width, request.height);
        if (typeof OffscreenCanvas !== 'undefined') {
          const canvas = new OffscreenCanvas(request.width, request.height);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const blob = await canvas.convertToBlob({ type: 'image/png' });
            return await this.registerBlob(blob, 'preview', `${item.handle.name}_tile_${request.x}_${request.y}`, {
              width: request.width,
              height: request.height,
            });
          }
        } else if (typeof document !== 'undefined') {
          const canvas = document.createElement('canvas');
          canvas.width = request.width;
          canvas.height = request.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
            if (blob) {
              return await this.registerBlob(blob, 'preview', `${item.handle.name}_tile_${request.x}_${request.y}`, {
                width: request.width,
                height: request.height,
              });
            }
          }
        }
        bitmap.close();
      }
    } catch (err) {
      console.warn('requestTile crop failed, falling back to full asset:', err);
    }

    item.refCount += 1;
    return item.handle;
  }

  async requestPreview(request: PreviewRequest): Promise<AssetHandle | null> {
    const item = this.assets.get(request.assetId);
    if (!item) return null;

    const w = item.handle.width || 0;
    const h = item.handle.height || 0;
    const maxDim = Math.max(w, h);

    if (maxDim <= request.maxDimension || maxDim === 0) {
      item.refCount += 1;
      return item.handle;
    }

    const scale = request.maxDimension / maxDim;
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));

    try {
      if (typeof createImageBitmap !== 'undefined') {
        const bitmap = await createImageBitmap(item.blob, {
          resizeWidth: targetW,
          resizeHeight: targetH,
          resizeQuality: 'medium',
        });
        if (typeof OffscreenCanvas !== 'undefined') {
          const canvas = new OffscreenCanvas(targetW, targetH);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
            return await this.registerBlob(blob, 'preview', `${item.handle.name}_preview_${request.maxDimension}`, {
              width: targetW,
              height: targetH,
            });
          }
        } else if (typeof document !== 'undefined') {
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
            if (blob) {
              return await this.registerBlob(blob, 'preview', `${item.handle.name}_preview_${request.maxDimension}`, {
                width: targetW,
                height: targetH,
              });
            }
          }
        }
        bitmap.close();
      }
    } catch (err) {
      console.warn('requestPreview resize failed, returning full asset:', err);
    }

    item.refCount += 1;
    return item.handle;
  }

  getHandle(assetId: string): AssetHandle | null {
    const item = this.assets.get(assetId);
    return item ? item.handle : null;
  }

  acquireRef(assetId: string): void {
    const item = this.assets.get(assetId);
    if (item) {
      item.refCount += 1;
    }
  }

  releaseAsset(assetId: string): void {
    const item = this.assets.get(assetId);
    if (item) {
      item.refCount -= 1;
      if (item.refCount <= 0) {
        if (item.objectUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(item.objectUrl);
        }
        if (item.thumbnailUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(item.thumbnailUrl);
        }
        if (item.previewUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(item.previewUrl);
        }
        this.assets.delete(assetId);
        this.rawMaskCache.delete(assetId);
      }
    }
  }

  listAssets(): AssetHandle[] {
    return Array.from(this.assets.values()).map(item => item.handle);
  }

  hasAsset(assetId: string): boolean {
    return this.assets.has(assetId);
  }

  /** Calculates total bytes of all currently cached Blobs */
  getTotalByteSize(): number {
    let sum = 0;
    for (const item of this.assets.values()) {
      sum += item.blob?.size || 0;
    }
    return sum;
  }

  /** Clears all assets and revokes their URLs */
  dispose(): void {
    for (const [id] of this.assets) {
      this.releaseAsset(id);
    }
    this.assets.clear();
    this.rawMaskCache.clear();
  }

  /** Safe runtime cache purge (distinct from dev build cache) */
  clearRuntimeCache(): void {
    this.dispose();
  }
}

// Global default singleton for the workspace
export const defaultAssetManager = new AssetManager();
