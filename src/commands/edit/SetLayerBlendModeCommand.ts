import { assertLayerEditable } from '../../edit/LayerTree';
import { findLayerById, updateLayerInTree } from '../../document/EditDocument';
// src/commands/edit/SetLayerBlendModeCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { BlendMode } from '../../types/edit';

export class SetLayerBlendModeCommand extends BaseCommand {
  private previousBlendMode: BlendMode = 'normal';

  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly newBlendMode: BlendMode,
    private documentManager: IDocumentManager
  ) {
    super(`Set Layer Blend Mode to "${newBlendMode}"`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) {
      throw new Error(`SetLayerBlendModeCommand: Edit document "${this.documentId}" not found.`);
    }

    assertLayerEditable(doc, this.layerId);
    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) {
      throw new Error(`SetLayerBlendModeCommand: Layer "${this.layerId}" not found.`);
    }

    this.previousBlendMode = layer.blendMode;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId ? { ...l, blendMode: this.newBlendMode } : l
    );

    this.documentManager.updateDocument(
      {
        ...doc,
        layers: updatedLayers,
      },
      this.name
    );
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId ? { ...l, blendMode: this.previousBlendMode } : l
    );

    this.documentManager.updateDocument(
      {
        ...doc,
        layers: updatedLayers,
      },
      `Undo ${this.name}`
    );
  }
}
