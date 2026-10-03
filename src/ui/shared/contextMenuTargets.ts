import type { IDocumentManager } from '../../types/document';
import type { EditDocument } from '../../types/edit';
import { assertLayerEditable, locateLayer } from '../../edit/LayerTree';
export function guardMenuDocument(documents:IDocumentManager,id:string,expected?:object) {
 const doc=documents.getDocument(id);
 if(!doc||documents.getActiveDocument()?.id!==id||(expected&&doc!==expected))throw new Error('菜单目标文档已切换或修改，请重新打开菜单。');
 return doc;
}
export function guardMenuLayer(documents:IDocumentManager,expected:EditDocument,id:string,locks:'all'|'ancestors'|'none'='all') {
 const doc=guardMenuDocument(documents,expected.id,expected) as EditDocument;
 if(locks==='none') {const found=locateLayer(doc.layers,id);if(!found)throw new Error('图层已删除。');return found;}
 return assertLayerEditable(doc,id,locks==='all'?'content':'ancestors');
}
