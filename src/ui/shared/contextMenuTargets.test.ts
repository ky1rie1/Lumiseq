import { expect,it } from 'vitest';
import { DocumentManager } from '../../document/DocumentManager';
import { createEditDocument,createGroupLayer,createTextLayer } from '../../document/EditDocument';
import { guardMenuLayer } from './contextMenuTargets';
it('rejects deleted, changed, locked and inherited locked captured layer targets',()=>{
 const docs=new DocumentManager(),child=createTextLayer({id:'child',text:'x'}),group={...createGroupLayer({children:[child]}),locked:true};
 const doc=createEditDocument({id:'menu-target',layers:[group]});docs.openDocument(doc);
 expect(()=>guardMenuLayer(docs,doc,child.id)).toThrow();
 expect(()=>guardMenuLayer(docs,doc,'missing','none')).toThrow();
 expect(guardMenuLayer(docs,doc,child.id,'none').layer.id).toBe(child.id);
 docs.updateDocument({...doc,layers:[]},'delete');expect(()=>guardMenuLayer(docs,doc,child.id,'none')).toThrow();
 docs.closeDocument(doc.id);expect(()=>guardMenuLayer(docs,doc,child.id,'none')).toThrow();
});
