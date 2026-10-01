import { assertLayerEditable } from '../../edit/LayerTree';
import { findLayerById, updateLayerInTree } from '../../document/EditDocument';
// src/commands/edit/ScaleLayerCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class ScaleLayerCommand extends BaseCommand {
  private prevScaleX: number = 1.0;
  private prevScaleY: number = 1.0;

  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly newScaleX: number,
    public readonly newScaleY: number,
    private documentManager: IDocumentManager
  ) {
    super(`Scale Layer (${newScaleX.toFixed(2)}x)`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error(`Edit document "${this.documentId}" not found.`);
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) throw new Error(`Layer "${this.layerId}" not found.`);

    this.prevScaleX = layer.transform.scaleX;
    this.prevScaleY = layer.transform.scaleY;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId
        ? { ...l, transform: { ...l.transform, scaleX: this.newScaleX, scaleY: this.newScaleY } }
        : l
    );

    this.documentManager.updateDocument({ ...doc, layers: updatedLayers }, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId
        ? { ...l, transform: { ...l.transform, scaleX: this.prevScaleX, scaleY: this.prevScaleY } }
        : l
    );

    this.documentManager.updateDocument({ ...doc, layers: updatedLayers }, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (
      previousCommand instanceof ScaleLayerCommand &&
      previousCommand.documentId === this.documentId &&
      previousCommand.layerId === this.layerId
    ) {
      this.prevScaleX = previousCommand.prevScaleX;
      this.prevScaleY = previousCommand.prevScaleY;
      return true;
    }
    return false;
  }
}
