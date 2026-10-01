import { describe, expect, it } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { defaultAssetManager } from '../assets/AssetManager';
import { InpaintingService } from '../ai/inpainting/InpaintingService';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument, createGroupLayer, createImageLayer, createSmartObjectLayer } from '../document/EditDocument';
import { createSmartFilter } from '../filters/smartFilters';
import { ProjectSerializer } from './ProjectSerializer';

describe('portable project persistence', () => {
  it('restores image bytes and nested layer references in a fresh asset manager', async () => {
    const sourceAssets = new AssetManager();
    const asset = await sourceAssets.registerBlob(new Blob(['real pixels'], { type: 'image/png' }), 'image', 'portrait.png', { width: 20, height: 30 });
    const layer = createImageLayer({ name: 'portrait', sourceAssetId: asset.id, naturalWidth: 20, naturalHeight: 30 });
    const original = createEditDocument({ name: 'portable', layers: [createGroupLayer({ name: 'folder', children: [layer] })] });
    const packageText = await new ProjectSerializer().serialize(original, sourceAssets);
    const freshAssets = new AssetManager();
    const freshDocuments = new DocumentManager();

    const reopened = await new ProjectSerializer().deserialize(packageText, freshDocuments, freshAssets);

    const reopenedLayer = (reopened.layers[0] as any).children[0];
    expect(reopenedLayer.sourceAssetId).not.toBe(asset.id);
    expect(await (await freshAssets.getBlob(reopenedLayer.sourceAssetId))?.text()).toBe('real pixels');
    expect(freshDocuments.getActiveDocument()).toBe(reopened);
  });

  it('rejects a corrupt embedded asset before changing the active document or assets', async () => {
    const sourceAssets = new AssetManager();
    const asset = await sourceAssets.registerBlob(new Blob(['pixels']), 'image', 'source', { width: 2, height: 2 });
    const original = createEditDocument({ layers: [createImageLayer({ name: 'source', sourceAssetId: asset.id, naturalWidth: 2, naturalHeight: 2 })] });
    const manifest = JSON.parse(await new ProjectSerializer().serialize(original, sourceAssets));
    manifest.embeddedAssets[asset.id].data = 'Y29ycnVwdA==';
    const freshAssets = new AssetManager();
    const documents = new DocumentManager();
    const previous = createEditDocument({ name: 'previous' });
    documents.openDocument(previous);

    await expect(new ProjectSerializer().deserialize(JSON.stringify(manifest), documents, freshAssets)).rejects.toThrow(/资源|校验/);
    expect(documents.getActiveDocument()).toBe(previous);
    expect(freshAssets.listAssets()).toHaveLength(0);
  });

  it('restores an active selection mask with its original grayscale values', async () => {
    const sourceAssets = new AssetManager();
    const mask = await sourceAssets.registerMask(new Uint8ClampedArray([0, 64, 128, 255]), 2, 2, 'selection');
    const original = createEditDocument({ name: 'selected', width: 2, height: 2 });
    original.selection = {
      id: 'selection-1', documentId: original.id, width: 2, height: 2,
      assetId: mask.id, bounds: { x: 0, y: 0, width: 2, height: 2 },
      feather: 0, inverted: false, active: true,
    };
    const project = await new ProjectSerializer().serialize(original, sourceAssets);
    const freshAssets = new AssetManager();

    const reopened = await new ProjectSerializer().hydrate(project, freshAssets);

    expect(reopened.selection?.assetId).not.toBe(mask.id);
    expect(Array.from((await freshAssets.getMask(reopened.selection!.assetId))!)).toEqual([0, 64, 128, 255]);
  });

  it('preserves an ordered Smart Object filter stack across save and reopen', async () => {
    const sourceAssets = new AssetManager();
    const asset = await sourceAssets.registerBlob(new Blob(['smart pixels'], { type: 'image/png' }), 'image', 'smart.png', { width: 8, height: 6 });
    const smartObject = createSmartObjectLayer({ sourceAssetId: asset.id, embeddedAssetId: asset.id, originalWidth: 8, originalHeight: 6 });
    smartObject.smartFilters = [
      createSmartFilter('noise_reduction', { id: 'filter-denoise', settings: { radius: 3, strength: 0.65, preserveEdges: 0.8 } }),
      createSmartFilter('unsharp_mask', { id: 'filter-sharpen', enabled: false, opacity: 0.75, settings: { radius: 2, amount: 1.4, threshold: 6 } }),
    ];
    const original = createEditDocument({ name: 'smart-filter-project', layers: [smartObject] });

    const project = await new ProjectSerializer().serialize(original, sourceAssets);
    const reopened = await new ProjectSerializer().hydrate(project, new AssetManager());
    const reopenedLayer = reopened.layers[0];

    expect(reopenedLayer.type).toBe('smart-object');
    if (reopenedLayer.type !== 'smart-object') throw new Error('Expected smart object');
    expect(reopenedLayer.smartFilters).toEqual(smartObject.smartFilters);
  });

  it('accepts valid Smart Filter settings regardless of object key order', async () => {
    const sourceAssets = new AssetManager();
    const asset = await sourceAssets.registerBlob(new Blob(['smart pixels'], { type: 'image/png' }), 'image', 'smart.png', { width: 2, height: 2 });
    const smartObject = createSmartObjectLayer({ sourceAssetId: asset.id, embeddedAssetId: asset.id, originalWidth: 2, originalHeight: 2 });
    smartObject.smartFilters = [{
      id: 'ordered-differently', type: 'unsharp_mask', name: '智能锐化', enabled: true, opacity: 1,
      settings: { threshold: 4, amount: 1, radius: 2 },
    }];

    await expect(new ProjectSerializer().serialize(createEditDocument({ layers: [smartObject] }), sourceAssets)).resolves.toContain('ordered-differently');
  });

  it('rejects duplicate Smart Object filter IDs', async () => {
    const sourceAssets = new AssetManager();
    const asset = await sourceAssets.registerBlob(new Blob(['smart pixels'], { type: 'image/png' }), 'image', 'smart.png', { width: 2, height: 2 });
    const smartObject = createSmartObjectLayer({ sourceAssetId: asset.id, embeddedAssetId: asset.id, originalWidth: 2, originalHeight: 2 });
    smartObject.smartFilters = [
      createSmartFilter('gaussian_blur', { id: 'duplicate-filter' }),
      createSmartFilter('noise_reduction', { id: 'duplicate-filter' }),
    ];

    await expect(new ProjectSerializer().serialize(createEditDocument({ layers: [smartObject] }), sourceAssets)).rejects.toThrow(/重复|滤镜/);
  });

  it('rejects out-of-range Smart Object filter parameters', async () => {
    const sourceAssets = new AssetManager();
    const asset = await sourceAssets.registerBlob(new Blob(['smart pixels'], { type: 'image/png' }), 'image', 'smart.png', { width: 2, height: 2 });
    const smartObject = createSmartObjectLayer({ sourceAssetId: asset.id, embeddedAssetId: asset.id, originalWidth: 2, originalHeight: 2 });
    smartObject.smartFilters = [{ id: 'bad-filter', type: 'gaussian_blur', name: 'Bad', enabled: true, opacity: 2, settings: { radius: 999 } }];

    await expect(new ProjectSerializer().serialize(createEditDocument({ layers: [smartObject] }), sourceAssets)).rejects.toThrow(/范围|滤镜/);
  });

  it('reopens an inpainting patch after the source selection has been cleared', async () => {
    const sourceMask = await defaultAssetManager.registerMask(new Uint8ClampedArray([0, 255, 64, 128]), 2, 2, 'source selection');
    const patch = await new InpaintingService().createPatchLayer({
      patchBlob: new Blob(['patch pixels'], { type: 'image/png' }), width: 2, height: 2,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      metadata: { provider: 'local', model: 'test', sourceDocumentId: 'source', maskId: sourceMask.id, timestamp: 1 },
    });
    const original = createEditDocument({ name: 'filled', width: 2, height: 2, layers: [patch] });
    defaultAssetManager.releaseAsset(sourceMask.id);
    const project = await new ProjectSerializer().serialize(original, defaultAssetManager);
    const freshAssets = new AssetManager();

    const reopened = await new ProjectSerializer().hydrate(project, freshAssets);

    const reopenedPatch = reopened.layers[0];
    expect(reopenedPatch.type).toBe('generated-patch');
    if (reopenedPatch.type !== 'generated-patch') throw new Error('Expected generated patch');
    expect(Array.from((await freshAssets.getMask(reopenedPatch.maskAssetId))!)).toEqual([0, 255, 64, 128]);
    expect(await (await freshAssets.getBlob(reopenedPatch.sourceAssetId))?.text()).toBe('patch pixels');
    defaultAssetManager.releaseAsset(patch.sourceAssetId);
    defaultAssetManager.releaseAsset(patch.maskAssetId);
  });

  it('rejects an oversized asset instead of creating an unopenable project', async () => {
    const assets = new AssetManager();
    const asset = await assets.registerBlob(new Blob([new Uint8Array(65 * 1024 * 1024)]), 'image', 'huge', { width: 2, height: 2 });
    const doc = createEditDocument({ layers: [createImageLayer({ name: 'huge', sourceAssetId: asset.id, naturalWidth: 2, naturalHeight: 2 })] });
    await expect(new ProjectSerializer().serialize(doc, assets)).rejects.toThrow(/大小|过大/);
  });
});
