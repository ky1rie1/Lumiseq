import { expect, it, vi } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument, createImageLayer } from '../document/EditDocument';
import { bindFloatEditSourcesToDocuments, getFloatEditSources } from './FloatEditSources';

it('releases decoded leases on final document close while retaining original bytes', async () => {
  const assets = new AssetManager(), documents = new DocumentManager();
  bindFloatEditSourcesToDocuments(documents, assets);
  const asset = await assets.registerBlob(new Blob(['original']), 'image', 'source');
  const release = vi.fn(async () => {});
  getFloatEditSources(assets).adopt(asset.id, { assetId: 'native', width: 1, height: 1, bitDepth: 16 }, { releaseEditSource: release } as any);
  const doc = createEditDocument({ renderingVersion: 2, layers: [createImageLayer({ name: 'source', sourceAssetId: asset.id, naturalWidth: 1, naturalHeight: 1 })] });
  const copy = { ...doc, id: 'copy' }; documents.openDocument(doc); documents.openDocument(copy);
  documents.closeDocument(doc.id); await Promise.resolve(); expect(release).not.toHaveBeenCalled();
  documents.closeDocument(copy.id); await Promise.resolve(); expect(release).toHaveBeenCalledWith('native');
  expect(await (await assets.getBlob(asset.id))!.text()).toBe('original');
});
