import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { Layer } from '../../types/edit';
import { assertLayerEditable, locateLayer, replaceSiblings } from '../../edit/LayerTree';
import { flattenLayerTree } from '../../document/EditDocument';

export class DeleteLayerCommand extends BaseCommand {
  private deletedLayer: Layer | null = null;
  private index = 0;
  private parentId: string | null = null;
  private selectedBefore: string | null = null;
  constructor(documentId: string, readonly layerId: string, private documentManager: IDocumentManager) { super('Delete Layer', documentId); }
  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error(`Edit document "${this.documentId}" not found.`);
    const location = assertLayerEditable(doc, this.layerId);
    this.deletedLayer = structuredClone(location.layer); this.index = location.index;
    this.parentId = location.parent?.id ?? null; this.selectedBefore = doc.selectedLayerId;
    const siblings = location.siblings.filter(layer => layer.id !== this.layerId);
    const selectedLayerId = flattenLayerTree([location.layer]).some(layer => layer.id === doc.selectedLayerId)
      ? siblings[Math.min(this.index, siblings.length - 1)]?.id ?? this.parentId : doc.selectedLayerId;
    this.documentManager.updateDocument({ ...doc, layers: replaceSiblings(doc.layers, location.parent, siblings), selectedLayerId }, this.name);
  }
  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc || !this.deletedLayer) return;
    const parent = this.parentId ? locateLayer(doc.layers, this.parentId)?.layer : null;
    if (parent && parent.type !== 'group') throw new Error('Original parent is unavailable.');
    const siblings = [...(parent?.type === 'group' ? parent.children : doc.layers)];
    siblings.splice(this.index, 0, structuredClone(this.deletedLayer));
    this.documentManager.updateDocument({ ...doc, layers: replaceSiblings(doc.layers, parent?.type === 'group' ? parent : null, siblings), selectedLayerId: this.selectedBefore }, `Undo ${this.name}`);
  }
}
