import { findLayerById, updateLayerInTree } from '../../document/EditDocument';
// src/commands/edit/ToggleLayerVisibilityCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';

export class ToggleLayerVisibilityCommand extends BaseCommand {
  private prevVisible: boolean = true;

  constructor(
    documentId: string,
    public readonly layerId: string,
    private documentManager: IDocumentManager
  ) {
    super('Toggle Layer Visibility', documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error(`Edit document "${this.documentId}" not found.`);

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) throw new Error(`Layer "${this.layerId}" not found.`);

    this.prevVisible = layer.visible;
    const newVisible = !layer.visible;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId ? { ...l, visible: newVisible } : l
    );

    this.documentManager.updateDocument(
      { ...doc, layers: updatedLayers },
      `${newVisible ? 'Show' : 'Hide'} Layer "${layer.name}"`
    );
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId ? { ...l, visible: this.prevVisible } : l
    );

    this.documentManager.updateDocument({ ...doc, layers: updatedLayers }, `Undo ${this.name}`);
  }
}
