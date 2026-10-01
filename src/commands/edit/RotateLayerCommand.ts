import { assertLayerEditable } from '../../edit/LayerTree';
import { findLayerById, updateLayerInTree } from '../../document/EditDocument';
// src/commands/edit/RotateLayerCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class RotateLayerCommand extends BaseCommand {
  private prevRotation: number = 0;

  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly newRotation: number,
    private documentManager: IDocumentManager
  ) {
    super(`Rotate Layer (${Math.round(newRotation)}°)`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error(`Edit document "${this.documentId}" not found.`);
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) throw new Error(`Layer "${this.layerId}" not found.`);

    this.prevRotation = layer.transform.rotation;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId
        ? { ...l, transform: { ...l.transform, rotation: this.newRotation } }
        : l
    );

    this.documentManager.updateDocument({ ...doc, layers: updatedLayers }, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId
        ? { ...l, transform: { ...l.transform, rotation: this.prevRotation } }
        : l
    );

    this.documentManager.updateDocument({ ...doc, layers: updatedLayers }, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (
      previousCommand instanceof RotateLayerCommand &&
      previousCommand.documentId === this.documentId &&
      previousCommand.layerId === this.layerId
    ) {
      this.prevRotation = previousCommand.prevRotation;
      return true;
    }
    return false;
  }
}
