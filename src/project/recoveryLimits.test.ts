import { it,expect } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { DocumentManager } from '../document/DocumentManager';
import { createDevelopDocument } from '../document/DevelopDocument';
import { AutosaveManager, type RecoveryEntry } from './AutosaveManager';
it('reads unchanged RAW source only once across autosave ticks',async()=>{
 const docs=new DocumentManager();const doc=createDevelopDocument({sourceUri:'C:\\original.cr3',fileName:'original.cr3',isRaw:true});doc.isDirty=true;docs.openDocument(doc);let reads=0;const records=new Map<string,RecoveryEntry>();const store={put:async(e:RecoveryEntry)=>{records.set(e.documentId,e)},list:async()=>[...records.values()],remove:async(id:string)=>{records.delete(id)}};
 const saver=new AutosaveManager(docs,30000,new AssetManager(),store,()=>{}, {inspect:async()=>({sizeBytes:3,modifiedAt:1}),read:async()=>{reads++;return new Uint8Array([1,2,3])},stage:async()=> 'C:\\recovered.cr3'});
 await saver.performAutosave();await saver.performAutosave();expect(reads).toBe(1);expect(records.get(doc.id)?.rawSource?.size).toBe(3);
});
it('rejects malformed recovery before allocating assets or opening a document',async()=>{
 const docs=new DocumentManager();const saver=new AutosaveManager(docs,30000,new AssetManager(),{put:async()=>{},list:async()=>[],remove:async()=>{}});
 await expect(saver.restore({documentId:'bad',name:'bad',timestamp:Date.now(),data:{kind:'edit',id:'bad',width:-1,height:0},assets:[]} as unknown as RecoveryEntry)).rejects.toThrow();expect(docs.getOpenDocuments()).toHaveLength(0);
});
it('checks RAW size before reading and rejects storage quota overflow',async()=>{
 const docs=new DocumentManager();const doc=createDevelopDocument({sourceUri:'C:\\original.cr3',fileName:'original.cr3',isRaw:true});doc.isDirty=true;docs.openDocument(doc);let reads=0;let puts=0;
 const store={put:async()=>{puts++},list:async()=>[],remove:async()=>{}};
 const tooLarge=new AutosaveManager(docs,30000,new AssetManager(),store,()=>{},{inspect:async()=>({sizeBytes:257*1024*1024}),read:async()=>{reads++;return new Uint8Array(1)},stage:async()=>''});
 await expect(tooLarge.performAutosave()).rejects.toThrow();expect(reads).toBe(0);
 const full=new AutosaveManager(docs,30000,new AssetManager(),store,()=>{},{inspect:async()=>({sizeBytes:3}),read:async()=>new Uint8Array([1,2,3]),stage:async()=>'',estimate:async()=>({quota:2,usage:0})});
 await expect(full.performAutosave()).rejects.toThrow();expect(puts).toBe(0);
});
