// src/commands/edit/AddGeneratedPatchLayerCommand.ts
//! Command to non-destructively insert a GeneratedPatchLayer into an Edit document

import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { EditDocument, GeneratedPatchLayer } from '../../types/edit';
import { assertLayerEditable, assertCurrentLayer } from '../../edit/LayerTree';

export class AddGeneratedPatchLayerCommand extends BaseCommand {
  private committed = false;
  constructor(
    documentId: string,
    public patchLayer: GeneratedPatchLayer,
    private documentManager: IDocumentManager,
    private expectedDocument?: EditDocument
  ) {
    super(`Add Generated Patch: ${patchLayer.name}`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) {
      throw new Error(`AddGeneratedPatchLayerCommand: Document "${this.documentId}" not found.`);
    }
    const sourceId = this.patchLayer.generationMetadata.sourceLayerId;
    if (sourceId) {
      // Prepared assets must match the first commit; history replay uses the current document.
      if (this.expectedDocument && !this.committed) assertCurrentLayer(this.documentManager, this.expectedDocument, sourceId);
      else assertLayerEditable(doc, sourceId);
    }

    const updatedLayers = [...doc.layers, this.patchLayer];

    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      selectedLayerId: this.patchLayer.id,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
    this.committed = true;
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = doc.layers.filter((l) => l.id !== this.patchLayer.id);
    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      selectedLayerId: updatedLayers.length > 0 ? updatedLayers[updatedLayers.length - 1].id : null,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }
}
