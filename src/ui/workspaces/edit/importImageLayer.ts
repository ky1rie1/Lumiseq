import type { IAssetManager } from '../../../types/asset';

export interface PreparedImageLayer {
  id: string;
  width: number;
  height: number;
}

export interface ImageLayerDependencies {
  assets: IAssetManager;
  decodeOriginal?: (id: string, blob: Blob) => Promise<{ width: number; height: number }>;
  /** Decode the registered blob and report its real pixel dimensions. */
  decode: (url: string) => Promise<{ width: number; height: number }>;
  /** Upload the blob into the render engine under the given asset id. */
  load: (id: string, blob: Blob) => Promise<unknown>;
}

/**
 * Registers an imported image, decodes it and reports its real size for the new layer.
 * A failed load or decode releases the asset so a rejected import leaves nothing behind.
 */
export async function prepareImageLayer(
  blob: Blob,
  name: string,
  dependencies: ImageLayerDependencies
): Promise<PreparedImageLayer> {
  const handle = await dependencies.assets.registerBlob(blob, 'image', name);
  try {
    if (dependencies.decodeOriginal) {
      const decoded = await dependencies.decodeOriginal(handle.id, blob);
      if (!decoded.width || !decoded.height) throw new Error(`无法读取图片尺寸：${name}`);
      handle.width = decoded.width; handle.height = decoded.height;
      return { id: handle.id, width: decoded.width, height: decoded.height };
    }
    await dependencies.load(handle.id, blob);
    const url = dependencies.assets.getDisplayUrl(handle.id);
    const decoded = url ? await dependencies.decode(url) : null;
    const width = decoded?.width || handle.width || 0;
    const height = decoded?.height || handle.height || 0;
    if (!width || !height) throw new Error(`无法读取图片尺寸：${name}`);
    return { id: handle.id, width, height };
  } catch (reason) {
    dependencies.assets.releaseAsset(handle.id);
    throw reason;
  }
}
