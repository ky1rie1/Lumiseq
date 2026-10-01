import { assertLayerEditable } from '../../edit/LayerTree';
import { findLayerById, updateLayerInTree } from '../../document/EditDocument';
// src/commands/edit/RenameLayerCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';

export class RenameLayerCommand extends BaseCommand {
  private prevName: string = '';

  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly newName: string,
    private documentManager: IDocumentManager
  ) {
    super(`Rename Layer to "${newName}"`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error(`Edit document "${this.documentId}" not found.`);
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) throw new Error(`Layer "${this.layerId}" not found.`);

    this.prevName = layer.name;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId ? { ...l, name: this.newName } : l
    );

    this.documentManager.updateDocument({ ...doc, layers: updatedLayers }, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId ? { ...l, name: this.prevName } : l
    );

    this.documentManager.updateDocument({ ...doc, layers: updatedLayers }, `Undo ${this.name}`);
  }
}
