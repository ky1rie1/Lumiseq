import { assertLayerEditable } from '../../edit/LayerTree';
import { findLayerById, updateLayerInTree } from '../../document/EditDocument';
// src/commands/edit/MoveLayerCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class MoveLayerCommand extends BaseCommand {
  private prevX: number = 0;
  private prevY: number = 0;

  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly newX: number,
    public readonly newY: number,
    private documentManager: IDocumentManager
  ) {
    super(`Move Layer (${Math.round(newX)}, ${Math.round(newY)})`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error(`Edit document "${this.documentId}" not found.`);
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) throw new Error(`Layer "${this.layerId}" not found.`);

    this.prevX = layer.transform.x;
    this.prevY = layer.transform.y;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId
        ? { ...l, transform: { ...l.transform, x: this.newX, y: this.newY } }
        : l
    );

    this.documentManager.updateDocument({ ...doc, layers: updatedLayers }, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = updateLayerInTree(doc.layers, this.layerId, l =>
      l.id === this.layerId
        ? { ...l, transform: { ...l.transform, x: this.prevX, y: this.prevY } }
        : l
    );

    this.documentManager.updateDocument({ ...doc, layers: updatedLayers }, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (
      previousCommand instanceof MoveLayerCommand &&
      previousCommand.documentId === this.documentId &&
      previousCommand.layerId === this.layerId
    ) {
      this.prevX = previousCommand.prevX;
      this.prevY = previousCommand.prevY;
      return true;
    }
    return false;
  }
}
