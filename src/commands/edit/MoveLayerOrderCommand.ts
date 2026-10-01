import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { assertLayerEditable, locateLayer, replaceSiblings } from '../../edit/LayerTree';

export class MoveLayerOrderCommand extends BaseCommand {
  private beforeIndex = 0;
  constructor(documentId: string, readonly layerId: string, readonly toIndex: number, private documentManager: IDocumentManager) { super('Move Layer Order', documentId); }
  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error(`Edit document "${this.documentId}" not found.`);
    if (!Number.isInteger(this.toIndex)) throw new Error('Layer order must be an integer.');
    const location = assertLayerEditable(doc, this.layerId); this.beforeIndex = location.index;
    const siblings = location.siblings.filter(layer => layer.id !== this.layerId);
    siblings.splice(Math.max(0, Math.min(this.toIndex, siblings.length)), 0, location.layer);
    this.documentManager.updateDocument({ ...doc, layers: replaceSiblings(doc.layers, location.parent, siblings) }, this.name);
  }
  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    const location = doc && locateLayer(doc.layers, this.layerId);
    if (!doc || !location) return;
    const siblings = location.siblings.filter(layer => layer.id !== this.layerId);
    siblings.splice(this.beforeIndex, 0, location.layer);
    this.documentManager.updateDocument({ ...doc, layers: replaceSiblings(doc.layers, location.parent, siblings) }, `Undo ${this.name}`);
  }
}
