// src/commands/edit/CreateLayerCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { Layer } from '../../types/edit';

export class CreateLayerCommand extends BaseCommand {
  constructor(
    documentId: string,
    public readonly layer: Layer,
    private documentManager: IDocumentManager
  ) {
    super(`Create Layer "${layer.name}"`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) {
      throw new Error(`CreateLayerCommand: Edit document "${this.documentId}" not found.`);
    }

    const updatedLayers = [...doc.layers, this.layer];

    const updatedDoc = {
      ...doc,
      layers: updatedLayers,
      selectedLayerId: this.layer.id,
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = doc.layers.filter(l => l.id !== this.layer.id);
    const updatedDoc = {
      ...doc,
      layers: updatedLayers,
      selectedLayerId: updatedLayers.length > 0 ? updatedLayers[updatedLayers.length - 1].id : null,
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }
}
