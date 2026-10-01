import { it, expect } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument } from '../document/EditDocument';
import { ProjectOperationService } from './ProjectOperationService';
it('keeps edits made during saving dirty and serializes an isolated snapshot', async () => {
 const manager = new DocumentManager(); const doc = createEditDocument({name:'before'}); manager.openDocument(doc);
 let release!: () => void; const wait = new Promise<void>(r => {release=r}); let serialized = '';
 const service = new ProjectOperationService({serialize: async snapshot => {await wait; serialized = JSON.stringify(snapshot); return serialized},write:async()=>{}, markSaved: (id, snapshot) => manager.markSaved(id, snapshot),record:()=>{}});
 const saving = service.save(doc, 'C:\\work\\test.aistudio'); doc.name = 'mutated'; manager.updateDocument({...doc,name:'later'}); release(); await saving;
 expect(JSON.parse(serialized).name).toBe('before'); expect(manager.getDocument(doc.id)?.isDirty).toBe(true);
});
it('orders writes sharing a path even when serialization is asynchronous', async()=>{
 const first=createEditDocument({name:'first'}),second=createEditDocument({name:'second'});let release!:()=>void;const wait=new Promise<void>(r=>release=r);const writes:string[]=[];
 const service=new ProjectOperationService({serialize:async doc=>{if(doc.kind==='edit'&&doc.name==='first')await wait;return doc.kind==='edit'?doc.name:''},write:async(_path,bytes)=>{writes.push(new TextDecoder().decode(bytes))},markSaved:()=>{},record:()=>{}});
 const one=service.save(first,'C:\\work\\same.aistudio');const two=service.save(second,'C:\\work\\same.aistudio');await Promise.resolve();expect(writes).toEqual([]);release();await Promise.all([one,two]);expect(writes).toEqual(['first','second']);
});
