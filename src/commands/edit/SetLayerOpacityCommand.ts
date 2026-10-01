import { assertLayerEditable } from '../../edit/LayerTree';
import { findLayerById, updateLayerInTree } from '../../document/EditDocument';
// src/commands/edit/SetLayerOpacityCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class SetLayerOpacityCommand extends BaseCommand {
  private prevOpacity: number = 1.0;

  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly newOpacity: number,
    private documentManager: IDocumentManager
  ) {
    super(`Set Layer Opacity (${Math.round(newOpacity * 100)}%)`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) {
      throw new Error(`SetLayerOpacityCommand: Edit document "${this.documentId}" not found.`);
    }

    assertLayerEditable(doc, this.layerId);
    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) {
      throw new Error(`Layer "${this.layerId}" not found in document "${this.documentId}".`);
    }

    this.prevOpacity = layer.opacity;
    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId ? { ...l, opacity: this.newOpacity } : l
    );

    const updatedDoc = {
      ...doc,
      layers: updatedLayers,
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId ? { ...l, opacity: this.prevOpacity } : l
    );

    const updatedDoc = {
      ...doc,
      layers: updatedLayers,
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (
      previousCommand instanceof SetLayerOpacityCommand &&
      previousCommand.documentId === this.documentId &&
      previousCommand.layerId === this.layerId
    ) {
      this.prevOpacity = previousCommand.prevOpacity;
      return true;
    }
    return false;
  }
}
