import { describe, expect, it } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { createDevelopDocument } from '../document/DevelopDocument';
import { rasterizeDevelopMask } from '../develop/maskRaster';
import { DevelopProjectSerializer } from './DevelopProjectSerializer';

describe('RAW develop project', () => {
  it('round-trips edits, local masks and AI history while rebuilding transient mask assets', async () => {
    const assets = new AssetManager();
    const doc = createDevelopDocument({ sourceUri: 'C:\\photos\\sample.cr3', fileName: 'sample.cr3', isRaw: true, width: 800, height: 600 });
    const mask = {
      id: 'local-1', name: '天空', kind: 'linear' as const, geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
      inverted: false, opacity: 0.8, exposure: -0.5, maskAssetId: '',
    };
    mask.maskAssetId = (await assets.registerMask(rasterizeDevelopMask(mask), 512, 512, mask.name)).id;
    doc.settings.exposure = 1.25;
    doc.settings.masks = [mask];
    doc.aiHistory = { usedAI: true, runs: [] };
    const serializer = new DevelopProjectSerializer();
    const json = await serializer.serialize(doc, assets);
    expect(json).not.toContain(mask.maskAssetId);
    expect(json).not.toContain('nativeAssetId');
    const reopenedAssets = new AssetManager();
    const reopened = await serializer.hydrate(json, reopenedAssets, { getRawMetadata: async () => ({ width: 800, height: 600 }) } as any);
    expect(reopened.settings.exposure).toBe(1.25);
    expect(reopened.aiHistory?.usedAI).toBe(true);
    expect(reopened.settings.masks[0].maskAssetId).not.toBe(mask.maskAssetId);
    expect(reopenedAssets.hasAsset(reopened.settings.masks[0].maskAssetId)).toBe(true);
    expect(reopened.rawState).toBe('unloaded');
    expect(reopened.isDirty).toBe(false);
  });

  it('rejects a project whose original RAW can no longer be opened', async () => {
    const serializer = new DevelopProjectSerializer();
    const doc = createDevelopDocument({ sourceUri: 'C:\\photos\\missing.cr3', fileName: 'missing.cr3', isRaw: true });
    const json = await serializer.serialize(doc, new AssetManager());
    await expect(serializer.hydrate(json, new AssetManager(), { getRawMetadata: async () => null } as any)).rejects.toThrow(/RAW|原始/);
  });
});
it('restores non-RAW source pixels without session blob URLs', async()=>{
 const assets=new AssetManager();const h=await assets.registerBlob(new Blob(['jpeg source'],{type:'image/jpeg'}),'image','source',{width:20,height:10});const doc=createDevelopDocument({sourceUri:'blob:old-session',fileName:'photo.jpg',isRaw:false,width:20,height:10});doc.sourceAssetId=h.id;
 const serializer=new DevelopProjectSerializer();const json=await serializer.serialize(doc,assets);const fresh=new AssetManager();const restored=await serializer.hydrate(json,fresh,{getRawMetadata:async()=>null});
 expect(restored.sourceAssetId).toBeDefined();expect(await (await fresh.getBlob(restored.sourceAssetId!))?.text()).toBe('jpeg source');expect(restored.sourceUri).not.toBe('blob:old-session');
});
