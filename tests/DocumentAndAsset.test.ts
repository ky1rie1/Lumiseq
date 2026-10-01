import { describe, it, expect } from 'vitest';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { createEditDocument, createImageLayer } from '../src/document/EditDocument';
import { AssetManager } from '../src/assets/AssetManager';

describe('Document Model & Asset Engine (Rules 3, 5, 6, 7)', () => {
  it('RAW White Balance defaults to mode: "as-shot" (Rule 3)', () => {
    const rawDoc = createDevelopDocument({
      sourceUri: 'raw/photo.dng',
      fileName: 'photo.dng',
      isRaw: true,
    });

    expect(rawDoc.settings.whiteBalance.mode).toBe('as-shot');
    expect(rawDoc.isRaw).toBe(true);
    // Rule 7: Native RAW Engine not attached in frontend MVP
    expect(rawDoc.rawEngineAttached).toBe(false);
  });

  it('Raster White Balance defaults to mode: "custom" (Rule 3)', () => {
    const rasterDoc = createDevelopDocument({
      sourceUri: 'photos/vacation.jpg',
      fileName: 'vacation.jpg',
      isRaw: false,
    });

    expect(rasterDoc.settings.whiteBalance.mode).toBe('custom');
    expect(rasterDoc.settings.whiteBalance.temperature).toBe(5500);
    expect(rasterDoc.isRaw).toBe(false);
  });

  it('AssetManager registers Blobs and generates AssetHandles (Rule 5 & 6)', async () => {
    const assetManager = new AssetManager();
    const fakeBlob = new Blob(['fake image bytes'], { type: 'image/png' });

    const handle = await assetManager.registerBlob(fakeBlob, 'image', 'test.png');
    expect(handle.id).toBeDefined();
    expect(handle.kind).toBe('image');
    expect(assetManager.hasAsset(handle.id)).toBe(true);

    const retrievedBlob = await assetManager.getBlob(handle.id);
    expect(retrievedBlob).toBe(fakeBlob);

    // ImageLayer holds sourceAssetId reference (Rule 5)
    const layer = createImageLayer({
      name: 'Background',
      sourceAssetId: handle.id,
      naturalWidth: 1920,
      naturalHeight: 1080,
    });

    expect(layer.sourceAssetId).toBe(handle.id);
    expect((layer as any).dataUrl).toBeUndefined(); // Rule 5: NO DataURL in layer!

    // Release asset
    assetManager.releaseAsset(handle.id);
    expect(assetManager.hasAsset(handle.id)).toBe(false);
  });
});
