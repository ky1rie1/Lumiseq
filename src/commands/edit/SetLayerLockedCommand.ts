import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { updateLayerInTree } from '../../document/EditDocument';
import { assertLayerEditable } from '../../edit/LayerTree';

export class SetLayerLockedCommand extends BaseCommand {
  private before?: boolean;
  constructor(documentId: string, readonly layerId: string, readonly locked: boolean, private documents: IDocumentManager) { super(locked ? '锁定图层' : '解锁图层', documentId); }
  execute(): void {
    const doc = this.documents.getEditDocument(this.documentId);
    if (!doc) throw new Error('图层文档不存在。');
    const { layer } = assertLayerEditable(doc, this.layerId, 'ancestors');
    this.before = layer.locked;
    this.documents.updateDocument({ ...doc, layers: updateLayerInTree(doc.layers, { ...layer, locked: this.locked }) }, this.name);
  }
  undo(): void {
    const doc = this.documents.getEditDocument(this.documentId);
    if (doc) this.documents.updateDocument({ ...doc, layers: updateLayerInTree(doc.layers, this.layerId, layer => ({ ...layer, locked: this.before })) }, `撤销 ${this.name}`);
  }
}
