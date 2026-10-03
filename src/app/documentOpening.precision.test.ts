import { describe, expect, it } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument, createImageLayer } from '../document/EditDocument';
import { ProjectSerializer } from '../project/ProjectSerializer';
import { openSelectedFile } from './documentOpening';

describe('high precision document opening', () => {
  it('sniffs binary projects and retains original bytes', async () => {
    const source = new AssetManager();
    const handle = await source.registerBlob(new Blob(['16bit original']), 'image', 'original.tiff');
    const doc = createEditDocument({ renderingVersion: 2, layers: [createImageLayer({ name: 'source', sourceAssetId: handle.id, naturalWidth: 3, naturalHeight: 2 })] });
    const bytes = await new ProjectSerializer().serializeBinary(doc, source);
    const assets = new AssetManager(), documents = new DocumentManager();
    const reopened = await openSelectedFile({ name: 'portable.lsq', blob: new Blob([bytes as BlobPart]), sizeBytes: bytes.length }, { assets, documents });
    expect(reopened.kind).toBe('edit');
    expect(reopened.kind === 'edit' && reopened.renderingVersion).toBe(2);
    expect(await (await assets.getBlob((reopened as any).layers[0].sourceAssetId))!.text()).toBe('16bit original');
  });

  it('uses native original decoding for 16-bit imports without browser decoding', async () => {
    const assets = new AssetManager(), documents = new DocumentManager();
    const blob = new Blob(['original TIFF bytes']);
    const platform = { decodeEditSource: async (bytes: Uint8Array) => {
      expect(new TextDecoder().decode(bytes)).toBe('original TIFF bytes');
      return { assetId: 'native-16', width: 300, height: 200, bitDepth: 16 };
    }, releaseEditSource: async () => {} } as any;
    const doc = await openSelectedFile({ name: 'source.tif', blob, sizeBytes: blob.size }, { assets, documents, platform, decodeImage: async () => { throw new Error('browser quantization'); } });
    expect(doc.width).toBe(300);
    expect(doc.kind === 'edit' && doc.renderingVersion).toBe(2);
  });
});
