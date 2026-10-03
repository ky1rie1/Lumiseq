import { it, expect, vi } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument, createImageLayer } from '../document/EditDocument';
import { createDevelopDocument, createDefaultDevelopSettings } from '../document/DevelopDocument';
import type { DevelopMask } from '../types/develop';
import type { DevelopSmartObjectLayer } from '../types/edit';
import { AutosaveManager, type RecoveryEntry } from './AutosaveManager';
it('restores all dirty documents with embedded image bytes after the asset session is lost', async()=>{
 const records = new Map<string,RecoveryEntry>(); const store={put:async(e:RecoveryEntry)=>{records.set(e.documentId,e)},list:async()=>[...records.values()],remove:async(id:string)=>{records.delete(id)}};
 const assets=new AssetManager(); const image=await assets.registerBlob(new Blob(['image pixels']),'image','source',{width:10,height:10}); const docs=new DocumentManager();
 const doc=createEditDocument({name:'one',layers:[createImageLayer({name:'image',sourceAssetId:image.id,naturalWidth:10,naturalHeight:10})]}); doc.isDirty=true; docs.openDocument(doc); const second=createEditDocument({name:'two'}); second.isDirty=true; docs.openDocument(second);
 const saver=new AutosaveManager(docs,30000,assets,store); await saver.performAutosave(); expect(records.size).toBe(2);
 const freshAssets=new AssetManager(); const freshDocs=new DocumentManager(); const recovery=new AutosaveManager(freshDocs,30000,freshAssets,store); await recovery.restore((await recovery.checkForRecovery())[0]);
 const restored=freshDocs.getOpenDocuments()[0]; if(restored.kind!=='edit'||restored.layers[0].type!=='image') throw Error('wrong document'); expect(await (await freshAssets.getBlob(restored.layers[0].sourceAssetId))?.text()).toBe('image pixels');
});

it('does not recreate recovery when a document closes during asynchronous resource reads', async()=>{
 const records=new Map<string,RecoveryEntry>(); const store={put:async(e:RecoveryEntry)=>{records.set(e.documentId,e)},list:async()=>[...records.values()],remove:async(id:string)=>{records.delete(id)}};
 const assets=new AssetManager();const image=await assets.registerBlob(new Blob(['image']),'image','source',{width:10,height:10});const docs=new DocumentManager();const doc=createEditDocument({name:'closing',layers:[createImageLayer({name:'source',sourceAssetId:image.id,naturalWidth:10,naturalHeight:10})]});doc.isDirty=true;docs.openDocument(doc);
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r);const original=assets.getBlob.bind(assets);assets.getBlob=async id=>{await waiting;return original(id)};
 const saver=new AutosaveManager(docs,30000,assets,store);const saving=saver.performAutosave();docs.closeDocument(doc.id);release();await saving;expect(records.size).toBe(0);
});
it('continues recovering other documents when one document has missing resources', async()=>{
 const records=new Map<string,RecoveryEntry>();const store={put:async(e:RecoveryEntry)=>{records.set(e.documentId,e)},list:async()=>[...records.values()],remove:async(id:string)=>{records.delete(id)}};const docs=new DocumentManager();const bad=createEditDocument({name:'broken',layers:[createImageLayer({name:'missing',sourceAssetId:'lost',naturalWidth:1,naturalHeight:1})]});bad.isDirty=true;docs.openDocument(bad);const good=createEditDocument({name:'good'});good.isDirty=true;docs.openDocument(good);
 const saver=new AutosaveManager(docs,30000,new AssetManager(),store);await expect(saver.performAutosave()).rejects.toThrow();expect(records.has(good.id)).toBe(true);
});

function incrementalSetup() {
 const records: RecoveryEntry[] = [];
 const store = { put: async (entry: RecoveryEntry) => { records.push(entry); }, list: async () => records, remove: async (id: string) => { for (let i = records.length - 1; i >= 0; i--) if (records[i].documentId === id) records.splice(i, 1); } };
 const docs = new DocumentManager();
 const doc = createEditDocument({ name: 'incremental' }); doc.isDirty = true; docs.openDocument(doc);
 const saver = new AutosaveManager(docs, 30000, new AssetManager(), store, () => {});
 return { records, store, docs, doc, saver };
}

it('writes an unchanged dirty document once and detects later content changes even with identical timestamps', async () => {
 const { records, saver, docs, doc } = incrementalSetup();
 await saver.performAutosave(); await saver.performAutosave();
 expect(records).toHaveLength(1);
 docs.openDocument({ ...doc, name: 'edited', updatedAt: doc.updatedAt });
 await saver.performAutosave(); await saver.performAutosave();
 expect(records).toHaveLength(2);
 expect(records[1].name).toBe('edited');
});

it('retries a failed recovery write without marking that document persisted', async () => {
 const { records, saver, store } = incrementalSetup();
 const put = store.put; let failures = 1;
 store.put = async entry => { if (failures-- > 0) throw Error('storage unavailable'); await put(entry); };
 await expect(saver.performAutosave()).rejects.toThrow();
 await saver.performAutosave(); await saver.performAutosave();
 expect(records).toHaveLength(1);
});

it('coalesces overlapping saves and picks up edits made while the first write is in flight', async () => {
 const { records, saver, store, docs, doc } = incrementalSetup();
 let release!: () => void; let entered!: () => void;
 const waiting = new Promise<void>(r => release = r); const writing = new Promise<void>(r => entered = r);
 const put = store.put; let calls = 0;
 store.put = async entry => { calls++; if (calls === 1) { entered(); await waiting; } await put(entry); };
 const first = saver.performAutosave(); await writing;
 const overlapping = saver.performAutosave();
 docs.updateDocument({ ...doc, name: 'latest' });
 const latest = saver.performAutosave(); release();
 await Promise.all([first, overlapping, latest]);
 expect(records.map(entry => entry.name)).toEqual(['incremental', 'latest']);
});

it('coalesces overlapping calls without duplicate packing of an unchanged document', async () => {
 const { records, saver, store } = incrementalSetup();
 let release!: () => void; let entered!: () => void;
 const waiting = new Promise<void>(r => release = r); const writing = new Promise<void>(r => entered = r);
 const put = store.put;
 store.put = async entry => { entered(); await waiting; await put(entry); };
 const first = saver.performAutosave(); await writing;
 const second = saver.performAutosave(); release(); await Promise.all([first, second]);
 expect(records).toHaveLength(1);
});

it('changes an active recovery interval while retaining one timer and the save/close subscription', async () => {
 vi.useFakeTimers();
 const { records, saver, docs, doc } = incrementalSetup();
 try {
  saver.start(); saver.setIntervalMs(15000); saver.setIntervalMs(60000);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(59000); expect(records).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1000); expect(records).toHaveLength(1);
  docs.markSaved(doc.id); await vi.advanceTimersByTimeAsync(0); expect(records).toHaveLength(0);
  saver.stop(); expect(vi.getTimerCount()).toBe(0);
  saver.setIntervalMs(15000); expect(vi.getTimerCount()).toBe(0);
  for (const value of [0, -1, NaN, Infinity, 1.5]) expect(() => saver.setIntervalMs(value)).toThrow();
 } finally { saver.stop(); vi.useRealTimers(); }
});

it('writes a dirty document again after its recovery package has been discarded', async () => {
 const { records, saver, doc } = incrementalSetup();
 await saver.performAutosave(); await saver.discard(doc.id); await saver.performAutosave();
 expect(records).toHaveLength(1);
});

it('does not write a discarded package if a document saves during asynchronous quota inspection', async () => {
 const { records, store, docs, doc } = incrementalSetup();
 let release!: () => void; let entered!: () => void;
 const waiting = new Promise<void>(r => release = r); const checking = new Promise<void>(r => entered = r);
 const saver = new AutosaveManager(docs, 30000, new AssetManager(), store, () => {}, {
  inspect: async () => ({ sizeBytes: 1 }), read: async () => new Uint8Array(1), stage: async () => '',
  estimate: async () => { entered(); await waiting; return {}; }
 });
 const saving = saver.performAutosave(); await checking; docs.markSaved(doc.id); release(); await saving;
 expect(records).toHaveLength(0);
});

it('removes a package if a document closes while the storage write itself is in flight', async () => {
 const { records, saver, store, docs, doc } = incrementalSetup();
 let release!: () => void; let entered!: () => void;
 const waiting = new Promise<void>(r => release = r); const writing = new Promise<void>(r => entered = r);
 const put = store.put;
 store.put = async entry => { entered(); await waiting; await put(entry); };
 const saving = saver.performAutosave(); await writing; docs.closeDocument(doc.id); release(); await saving;
 expect(records).toHaveLength(0);
});

function recoveryStoreFixture() {
 const records = new Map<string, RecoveryEntry>();
 const store = { put: async (entry: RecoveryEntry) => { records.set(entry.documentId, entry); }, list: async () => [...records.values()], remove: async (id: string) => { records.delete(id); } };
 return { records, store };
}

const recoveryMask = (id: string): DevelopMask => ({ id: 'mask-' + id, name: 'Saved mask', maskAssetId: id, kind: 'brush', geometry: {}, strokes: [], inverted: false, opacity: 1, exposure: .7 });

it('recovers the immutable original RAW once even after the source path changes', async () => {
 const { records, store } = recoveryStoreFixture(), assets = new AssetManager(), docs = new DocumentManager();
 const original = await assets.registerBlob(new Blob(['immutable sensor original']), 'image', 'camera.arw');
 const raw = createDevelopDocument({ fileName: 'camera.arw', sourceUri: 'C:\\changed.arw', isRaw: true, width: 2, height: 1 });
 raw.originalRawAssetId = original.id; raw.isDirty = true; docs.openDocument(raw);
 const sources = { inspect: async () => { throw Error('Original RAW path was removed'); }, read: async () => { throw Error('Original RAW path was replaced'); }, stage: async () => 'C:\\restored.arw' };
 await new AutosaveManager(docs, 30000, assets, store, () => {}, sources).performAutosave();
 const entry = records.get(raw.id)!;
 expect(entry.rawSource).toBeUndefined();
 expect(entry.assets).toHaveLength(1);
 expect(await entry.assets[0].blob.text()).toBe('immutable sensor original');
 const freshAssets = new AssetManager(), freshDocs = new DocumentManager();
 const recoverySources = { inspect: async () => ({ sizeBytes: 25 }), read: async () => { throw Error('Original recovery must not reread disk'); }, stage: async (_name: string, blob: Blob) => { expect(await blob.text()).toBe('immutable sensor original'); return 'C:\\restored.arw'; } };
 await new AutosaveManager(freshDocs, 30000, freshAssets, store, () => {}, recoverySources).restore(entry);
 const restored = freshDocs.getDevelopDocument(raw.id)!;
 expect(await (await freshAssets.getBlob(restored.originalRawAssetId!))!.text()).toBe('immutable sensor original');
 expect(records.get(raw.id)!.rawSource).toBeUndefined();
});

it('restores legacy RAW recovery into an immutable source asset and keeps one copy on the next autosave', async () => {
 const { records, store } = recoveryStoreFixture(), docs = new DocumentManager(), assets = new AssetManager();
 const doc = createDevelopDocument({ fileName: 'legacy.arw', sourceUri: 'C:\\missing.arw', isRaw: true, width: 2, height: 2 });
 const entry: RecoveryEntry = { documentId: doc.id, name: doc.fileName, timestamp: 1, data: doc, assets: [], rawSource: new Blob(['legacy original bytes']) };
 const sources = { inspect: async () => { throw Error('Missing source path'); }, read: async () => { throw Error('Missing source path'); }, stage: async (_name: string, blob: Blob) => { expect(await blob.text()).toBe('legacy original bytes'); return 'C:\\restored.arw'; } };
 await new AutosaveManager(docs, 30000, assets, store, () => {}, sources).restore(entry);
 const restored = docs.getDevelopDocument(doc.id)!;
 expect(await (await assets.getBlob(restored.originalRawAssetId!))!.text()).toBe('legacy original bytes');
 expect(records.get(doc.id)!.assets).toHaveLength(1);
 expect(records.get(doc.id)!.rawSource).toBeUndefined();
});

it('restores saved Develop mask bytes and snapshot masks without regenerating them', async () => {
 const { records, store } = recoveryStoreFixture(), assets = new AssetManager(), docs = new DocumentManager();
 const image = await assets.registerBlob(new Blob(['image']), 'image', 'image.png', { width: 2, height: 2 });
 const mask = await assets.registerMask(new Uint8ClampedArray([0, 37, 149, 255]), 2, 2);
 const snapshotMask = await assets.registerMask(new Uint8ClampedArray([255, 11, 23, 0]), 2, 2);
 const doc = createDevelopDocument({ sourceUri: 'blob:source', fileName: 'image.png', isRaw: false, width: 2, height: 2, sourceAssetId: image.id });
 doc.settings.masks = [recoveryMask(mask.id)];
 doc.settingsSnapshots = [{ id: 'saved-settings', name: 'Snapshot', createdAt: 1, settings: { ...createDefaultDevelopSettings(false), masks: [recoveryMask(snapshotMask.id)] } }];
 doc.isDirty = true; docs.openDocument(doc);
 await new AutosaveManager(docs, 30000, assets, store).performAutosave();
 const freshAssets = new AssetManager(), freshDocs = new DocumentManager();
 await new AutosaveManager(freshDocs, 30000, freshAssets, store).restore(records.get(doc.id)!);
 const restored = freshDocs.getDevelopDocument(doc.id)!;
 expect(await freshAssets.getMask(restored.settings.masks[0].maskAssetId)).toEqual(new Uint8ClampedArray([0, 37, 149, 255]));
 expect(await freshAssets.getMask(restored.settingsSnapshots![0].settings.masks[0].maskAssetId)).toEqual(new Uint8ClampedArray([255, 11, 23, 0]));
});

it.each([
 { renderingVersion: 2, bitDepth: 16, workingProfile: 'linear-srgb' },
 { renderingVersion: 2, bitDepth: 32, workingProfile: 'unknown' },
 { renderingVersion: 3, bitDepth: 32, workingProfile: 'linear-srgb' },
 { renderingVersion: 1, bitDepth: 32, workingProfile: 'linear-srgb' },
])('rejects invalid Edit recovery precision before restoring any assets: %j', async precision => {
 const sourceAssets = new AssetManager(), image = await sourceAssets.registerBlob(new Blob(['original']), 'image', 'original.png');
 const doc = { ...createEditDocument({ width: 2, height: 2, layers: [createImageLayer({ name: 'Image', sourceAssetId: image.id, naturalWidth: 2, naturalHeight: 2 })] }), ...precision } as RecoveryEntry['data'];
 const entry = { documentId: doc.id, name: 'Corrupt precision', timestamp: 1, data: doc, assets: [{ handle: image, blob: (await sourceAssets.getBlob(image.id))! }] };
 const freshAssets = new AssetManager(), freshDocs = new DocumentManager(), { store } = recoveryStoreFixture();
 await expect(new AutosaveManager(freshDocs, 30000, freshAssets, store).restore(entry)).rejects.toThrow();
 expect(freshAssets.listAssets()).toHaveLength(0);
 expect(freshDocs.getOpenDocuments()).toHaveLength(0);
});

it('recovers a v2 RAW smart object with its exact original, recipe mask and layer mask', async () => {
 const { records, store } = recoveryStoreFixture(), assets = new AssetManager(), docs = new DocumentManager();
 const raw = await assets.registerBlob(new Blob(['exact RAW original']), 'image', 'camera.arw', { width: 2, height: 2 });
 const recipeMask = await assets.registerMask(new Uint8ClampedArray([17, 33, 67, 129]), 2, 2);
 const layerMask = await assets.registerMask(new Uint8ClampedArray([255, 0, 255, 0]), 2, 2);
 const layer: DevelopSmartObjectLayer = { ...createImageLayer({ name: 'RAW', sourceAssetId: raw.id, naturalWidth: 2, naturalHeight: 2 }), type: 'develop-smart-object', sourceRawUri: 'C:\\camera.arw', rawProcessingVersion: 2, rawCorrectionMode: 'camera', developSettings: { ...createDefaultDevelopSettings(true), exposure: 1.2, masks: [recoveryMask(recipeMask.id)] }, mask: { id: 'layer-mask', assetId: layerMask.id, enabled: true, linked: true, density: .7, feather: 0 } };
 const doc = createEditDocument({ width: 2, height: 2, renderingVersion: 2, layers: [layer] }); doc.isDirty = true; docs.openDocument(doc);
 await new AutosaveManager(docs, 30000, assets, store).performAutosave();
 const freshAssets = new AssetManager(), freshDocs = new DocumentManager();
 await new AutosaveManager(freshDocs, 30000, freshAssets, store).restore(records.get(doc.id)!);
 const restored = freshDocs.getEditDocument(doc.id)!, restoredLayer = restored.layers[0] as DevelopSmartObjectLayer;
 expect(restored.renderingVersion).toBe(2); expect(restored.bitDepth).toBe(32); expect(restored.workingProfile).toBe('linear-srgb');
 expect(await (await freshAssets.getBlob(restoredLayer.sourceAssetId!))!.text()).toBe('exact RAW original');
 expect(restoredLayer.developSettings.exposure).toBe(1.2);
 expect(await freshAssets.getMask(restoredLayer.developSettings.masks[0].maskAssetId)).toEqual(new Uint8ClampedArray([17, 33, 67, 129]));
 expect(await freshAssets.getMask(restoredLayer.mask!.assetId)).toEqual(new Uint8ClampedArray([255, 0, 255, 0]));
});
