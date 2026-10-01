// tests/NativeAssetLifecycle.test.ts
import { describe, it, expect } from 'vitest';
import { AssetManager } from '../src/assets/AssetManager';

describe('AssetManager Lifecycle & Boundary (Stage 1A)', () => {
  it('manages asset refCounting and releases objectUrls upon zero references', async () => {
    const manager = new AssetManager();
    const blob = new Blob(['sample-image-data'], { type: 'image/jpeg' });
    const handle = await manager.registerBlob(blob, 'image', 'Test.jpg', { width: 800, height: 600 });

    expect(manager.hasAsset(handle.id)).toBe(true);
    expect(manager.listAssets().length).toBe(1);

    // Acquire an extra ref
    manager.acquireRef(handle.id);

    // Release once (refCount goes from 2 to 1)
    manager.releaseAsset(handle.id);
    expect(manager.hasAsset(handle.id)).toBe(true);

    // Release second time (refCount goes from 1 to 0, asset disposed)
    manager.releaseAsset(handle.id);
    expect(manager.hasAsset(handle.id)).toBe(false);
    expect(manager.listAssets().length).toBe(0);
  });

  it('manages raw mask cache and zero-copy access', async () => {
    const manager = new AssetManager();
    const maskData = new Uint8ClampedArray([0, 128, 255, 64]);
    const handle = await manager.registerMask(maskData, 2, 2, 'Layer Mask');

    expect(handle.kind).toBe('mask');
    expect(handle.sizeBytes).toBe(4);

    const retrieved = await manager.getMask(handle.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.length).toBe(4);
    expect(retrieved?.[1]).toBe(128);

    manager.releaseAsset(handle.id);
    expect(manager.hasAsset(handle.id)).toBe(false);
  });

  it('handles requestTile full match by incrementing refCount without re-allocating', async () => {
    const manager = new AssetManager();
    const blob = new Blob(['sample'], { type: 'image/jpeg' });
    const handle = await manager.registerBlob(blob, 'image', 'Full.jpg', { width: 1920, height: 1080 });

    const tileHandle = await manager.requestTile({
      assetId: handle.id,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });

    expect(tileHandle).not.toBeNull();
    expect(tileHandle?.id).toBe(handle.id);

    // Release tile
    manager.releaseAsset(tileHandle!.id);
    // Base handle should still be alive because refCount was incremented
    expect(manager.hasAsset(handle.id)).toBe(true);

    // Release base handle
    manager.releaseAsset(handle.id);
    expect(manager.hasAsset(handle.id)).toBe(false);
  });

  it('handles requestPreview when image is already smaller than maxDimension', async () => {
    const manager = new AssetManager();
    const blob = new Blob(['small'], { type: 'image/jpeg' });
    const handle = await manager.registerBlob(blob, 'image', 'Small.jpg', { width: 400, height: 300 });

    const previewHandle = await manager.requestPreview({
      assetId: handle.id,
      maxDimension: 1200,
    });

    expect(previewHandle).not.toBeNull();
    expect(previewHandle?.id).toBe(handle.id);

    manager.releaseAsset(previewHandle!.id);
    manager.releaseAsset(handle.id);
    expect(manager.hasAsset(handle.id)).toBe(false);
  });
});
