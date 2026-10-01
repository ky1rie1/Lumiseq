import { it,expect } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument } from '../document/EditDocument';
import { prepareWindowClose } from './prepareWindowClose';
it('rechecks documents edited while asynchronous close cleanup runs', async()=>{
 const manager=new DocumentManager();const doc=createEditDocument({name:'saved'});manager.openDocument(doc);const paths=new Map([[doc.id,'C:\\saved.aistudio']]);
 const pending=await prepareWindowClose(()=>manager.getOpenDocuments(),paths,[],async()=>{manager.updateDocument({...doc,name:'new edits'});});
 expect(pending.map(d=>d.id)).toEqual([doc.id]);expect(manager.getDocument(doc.id)?.isDirty).toBe(true);
});
