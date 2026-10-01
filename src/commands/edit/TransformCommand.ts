import { assertLayerEditable } from '../../edit/LayerTree';
// src/commands/edit/TransformCommand.ts
//! Unified Free Transform Command (Phase 6)
//! Supports scale, rotation, translation, and size modifications with full undo/redo.

import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { EditDocument, LayerTransform, Layer } from '../../types/edit';
import { findLayerById, updateLayerInTree } from '../../document/EditDocument';

export class TransformCommand extends BaseCommand {
  private prevTransform: LayerTransform | null = null;
  public readonly targetTransform: Partial<LayerTransform>;

  constructor(
    documentId: string,
    public readonly layerId: string,
    transformUpdate: Partial<LayerTransform>,
    private documentManager: IDocumentManager
  ) {
    super(`Transform Layer`, documentId);
    // Omitted properties retain the layer's current values at execution time.
    this.targetTransform = Object.fromEntries(
      Object.entries(transformUpdate).filter(([, value]) => value !== undefined)
    ) as Partial<LayerTransform>;
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error(`Edit document "${this.documentId}" not found.`);
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) throw new Error(`Layer "${this.layerId}" not found.`);

    if (!this.prevTransform) {
      this.prevTransform = { ...layer.transform };
    }

    const updatedTransform: LayerTransform = {
      ...layer.transform,
      ...this.targetTransform,
    };

    const updatedLayer: Layer = {
      ...layer,
      transform: updatedTransform,
    };

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);
    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc || !this.prevTransform) return;

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) return;

    const updatedLayer: Layer = {
      ...layer,
      transform: { ...this.prevTransform },
    };

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);
    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, `Undo: ${this.name}`);
  }
}
