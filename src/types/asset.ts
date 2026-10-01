// src/types/asset.ts

export type AssetKind = 'image' | 'mask' | 'preview' | 'thumbnail';

export interface AssetHandle {
  id: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface TileRequest {
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  targetResolution?: { width: number; height: number };
}

export interface PreviewRequest {
  assetId: string;
  maxDimension: number;
}

export interface IAssetManager {
  /** Register an in-memory Blob/File and return an AssetHandle */
  registerBlob(blob: Blob, kind: AssetKind, name: string, dimensions?: { width?: number; height?: number }): Promise<AssetHandle>;

  /** Register an 8-bit grayscale mask byte array and return an AssetHandle */
  registerMask(mask: Uint8ClampedArray, width: number, height: number, name?: string): Promise<AssetHandle>;

  /** Retrieve the 8-bit grayscale mask byte array */
  getMask(assetId: string): Promise<Uint8ClampedArray | null>;

  /** Get a transient URL for rendering (e.g. ObjectURL or WebGL texture source) */
  getDisplayUrl(assetId: string): string | null;

  /** Retrieve the raw Blob */
  getBlob(assetId: string): Promise<Blob | null>;

  /** Request a display tile for a bounded region of an asset */
  requestTile(request: TileRequest): Promise<AssetHandle | null>;

  /** Request a downsampled preview handle without decoding full resolution */
  requestPreview(request: PreviewRequest): Promise<AssetHandle | null>;

  /** Release an asset from memory and revoke transient URLs */
  releaseAsset(assetId: string): void;

  /** List all registered asset handles */
  listAssets(): AssetHandle[];

  /** Get handle for an asset ID */
  getHandle(assetId: string): AssetHandle | null;

  /** Check if an asset exists */
  hasAsset(assetId: string): boolean;
}
