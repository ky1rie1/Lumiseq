import { it, expect, vi } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument, createImageLayer } from '../document/EditDocument';
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
