// src/commands/edit/PasteImageCommand.ts
//! Command to paste an image layer into an Edit document with full Undo/Redo support via CommandBus.

import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { EditDocument, ImageLayer } from '../../types/edit';

export class PasteImageCommand extends BaseCommand {
  private prevSelectedLayerId: string | null = null;

  constructor(
    documentId: string,
    public readonly layer: ImageLayer,
    private documentManager: IDocumentManager
  ) {
    super(`粘贴图层 "${layer.name}"`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) {
      throw new Error(`PasteImageCommand: Edit document "${this.documentId}" not found.`);
    }

    this.prevSelectedLayerId = doc.selectedLayerId;
    const updatedLayers = [...doc.layers, this.layer];

    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      selectedLayerId: this.layer.id,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = doc.layers.filter((l) => l.id !== this.layer.id);
    const restoredSelection =
      this.prevSelectedLayerId && updatedLayers.some((l) => l.id === this.prevSelectedLayerId)
        ? this.prevSelectedLayerId
        : updatedLayers.length > 0
        ? updatedLayers[updatedLayers.length - 1].id
        : null;

    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      selectedLayerId: restoredSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, `撤销 ${this.name}`);
  }

  redo(): void {
    this.execute();
  }
}
