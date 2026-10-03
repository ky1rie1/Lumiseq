import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { createEditDocument, createImageLayer, createPaintLayer } from '../document/EditDocument';
import { ProjectSerializer } from './ProjectSerializer';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';
import type { DevelopSmartObjectLayer } from '../types/edit';

async function fixture() {
  const assets = new AssetManager();
  const original = new Uint8Array([0, 1, 127, 128, 255, 254, 42, 16]);
  const asset = await assets.registerBlob(new Blob([original]), 'image', 'source16.tiff', { width: 2, height: 1 });
  const doc = { ...createEditDocument({ width: 2, height: 1, layers: [createImageLayer({ name: 'source', sourceAssetId: asset.id, naturalWidth: 2, naturalHeight: 1 })] }), renderingVersion: 2 as const, bitDepth: 32 as const, workingProfile: 'linear-srgb' as const };
  return { assets, original, doc, serializer: new ProjectSerializer() };
}

function mutateManifest(bytes: Uint8Array, mutate: (manifest: any) => void): Uint8Array {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  mutate(manifest);
  const encoded = new TextEncoder().encode(JSON.stringify(manifest));
  const result = new Uint8Array(8 + encoded.length + bytes.length - 8 - length);
  result.set(bytes.subarray(0, 4));
  new DataView(result.buffer).setUint32(4, encoded.length, true);
  result.set(encoded, 8);
  result.set(bytes.subarray(8 + length), 8 + encoded.length);
  return result;
}

describe('binary precision projects', () => {
  it.each(['recipe-version', 'uncorrected-legacy'])('rejects invalid RAW %s before registering original bytes', async mode => {
    const { assets, doc, serializer } = await fixture();
    doc.layers[0] = { ...doc.layers[0], type: 'develop-smart-object',
      developSettings: createDefaultDevelopSettings(true), rawProcessingVersion: 2, rawCorrectionMode: 'camera',
    } as DevelopSmartObjectLayer;
    const bytes = mutateManifest(await serializer.serializeBinary(doc, assets), manifest => {
      const layer = manifest.document.layers[0];
      if (mode === 'recipe-version') layer.developSettings.renderingVersion = 3;
      else { layer.rawProcessingVersion = 1; layer.rawCorrectionMode = 'uncorrected'; }
    });
    const fresh = new AssetManager(), register = vi.spyOn(fresh, 'registerBlob');
    await expect(serializer.hydrateBinary(bytes, fresh)).rejects.toThrow();
    expect(register).not.toHaveBeenCalled();
    expect(fresh.listAssets()).toHaveLength(0);
  });

  it('round trips an untouched paint layer without inventing a PNG resource', async () => {
    const assets = new AssetManager(), serializer = new ProjectSerializer();
    const doc = createEditDocument({renderingVersion: 2, width: 2, height: 2, layers: [createPaintLayer({rasterAssetId: '', width: 2, height: 2})]});
    const bytes = await serializer.serializeBinary(doc, assets);
    const reopened = await serializer.hydrateBinary(bytes, new AssetManager());
    expect(reopened.layers).toEqual(doc.layers); expect(assets.listAssets()).toHaveLength(0);
  });
  it('round trips original bytes, precision and transforms without a float cache', async () => {
    const { assets, original, doc, serializer } = await fixture();
    doc.layers[0].opacity = 0.37;
    const bytes = await serializer.serializeBinary(doc, assets);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('LSQ2');
    const fresh = new AssetManager();
    const reopened = await serializer.hydrateBinary(bytes, fresh);
    expect(reopened.renderingVersion).toBe(2);
    expect(reopened.bitDepth).toBe(32);
    expect(reopened.layers[0].opacity).toBe(0.37);
    const id = (reopened.layers[0] as any).sourceAssetId;
    expect(new Uint8Array(await (await fresh.getBlob(id))!.arrayBuffer())).toEqual(original);
    expect(bytes.length).toBeLessThan(4096);
  });

  it.each(['hash', 'offset', 'version', 'precision', 'dimensions', 'unreferenced', 'size'])('rejects %s corruption before registration', async mode => {
    const { assets, doc, serializer } = await fixture();
    let bytes = await serializer.serializeBinary(doc, assets);
    if (mode === 'hash') bytes[bytes.length - 1] ^= 1;
    else bytes = mutateManifest(bytes, manifest => {
      if (mode === 'offset') manifest.resources[0].offset = 1;
      if (mode === 'version') manifest.version = '3.0';
      if (mode === 'precision') manifest.document.workingProfile = 'unknown';
      if (mode === 'dimensions') manifest.document.width = 150_000_001;
      if (mode === 'unreferenced') manifest.document.layers = [];
      if (mode === 'size') manifest.resources[0].length = 513 * 1024 * 1024;
    });
    const fresh = new AssetManager();
    const register = vi.spyOn(fresh, 'registerBlob');
    await expect(serializer.hydrateBinary(bytes, fresh)).rejects.toThrow();
    expect(register).not.toHaveBeenCalled();
    expect(fresh.listAssets()).toHaveLength(0);
  });

  it('releases partial registrations if the asset store fails', async () => {
    const { assets, doc, serializer } = await fixture();
    const second = await assets.registerBlob(new Blob(['second']), 'image', 'second');
    doc.layers.push(createImageLayer({ name: 'second', sourceAssetId: second.id, naturalWidth: 1, naturalHeight: 1 }));
    const bytes = await serializer.serializeBinary(doc, assets);
    const fresh = new AssetManager();
    const originalRegister = fresh.registerBlob.bind(fresh);
    vi.spyOn(fresh, 'registerBlob').mockImplementationOnce(originalRegister).mockRejectedValueOnce(new Error('store full'));
    await expect(serializer.hydrateBinary(bytes, fresh)).rejects.toThrow('store full');
    expect(fresh.listAssets()).toHaveLength(0);
  });
});
