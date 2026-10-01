import { assertLayerEditable } from '../edit/LayerTree';
// src/brush/BrushCommands.ts
//! Brush Stroke & Mask Paint History Commands (Phase 6)
//! Implements strict Rule 2 (one MouseDown->MouseUp gesture = ONE undo step).

import { BaseCommand } from '../history/Command';
import { IDocumentManager } from '../types/document';
import { EditDocument, Layer } from '../types/edit';
import { BrushStroke } from './BrushStroke';
import { findLayerById, updateLayerInTree } from '../document/EditDocument';

export class BrushStrokeCommand extends BaseCommand {
  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly stroke: BrushStroke,
    public readonly initialAssetId: string,
    public readonly finalAssetId: string,
    private documentManager: IDocumentManager
  ) {
    super('Brush Stroke', documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) return;

    const updatedLayer = {
      ...layer,
      rasterAssetId: this.finalAssetId,
    } as Layer;

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);

    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, 'Brush Stroke Applied');
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) return;

    const updatedLayer = {
      ...layer,
      rasterAssetId: this.initialAssetId,
    } as Layer;

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);

    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, 'Undo: Brush Stroke');
  }
}

export class PaintMaskCommand extends BaseCommand {
  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly stroke: BrushStroke,
    public readonly initialMaskAssetId: string,
    public readonly finalMaskAssetId: string,
    private documentManager: IDocumentManager
  ) {
    super('Paint on Mask', documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer || !layer.mask) return;

    const updatedLayer = {
      ...layer,
      mask: {
        ...layer.mask,
        assetId: this.finalMaskAssetId,
      },
    } as Layer;

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);

    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, 'Mask Painted');
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer || !layer.mask) return;

    const updatedLayer = {
      ...layer,
      mask: {
        ...layer.mask,
        assetId: this.initialMaskAssetId,
      },
    } as Layer;

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);

    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, 'Undo: Paint on Mask');
  }
}
