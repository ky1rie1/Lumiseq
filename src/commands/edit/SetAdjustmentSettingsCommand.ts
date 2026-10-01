import { assertLayerEditable } from '../../edit/LayerTree';
// src/commands/edit/SetAdjustmentSettingsCommand.ts
//! Non-destructive Adjustment Layer Parameter Modification Command (Phase 6)

import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { AdjustmentLayer, AdjustmentSettings } from '../../types/edit';
import { findLayerById, updateLayerInTree } from '../../document/EditDocument';

export class SetAdjustmentSettingsCommand extends BaseCommand {
  private prevSettings: AdjustmentSettings | null = null;

  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly newSettings: AdjustmentSettings,
    private documentManager: IDocumentManager
  ) {
    super(`Set Adjustment Settings`, documentId);
    const doc = documentManager.getEditDocument(documentId);
    const layer = doc ? (findLayerById(doc.layers, layerId) as AdjustmentLayer | null) : null;
    if (layer?.settings) {
      this.prevSettings = structuredClone(layer.settings);
    }
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId) as AdjustmentLayer | null;
    if (!layer || layer.type !== 'adjustment') return;

    const updatedLayer: AdjustmentLayer = {
      ...layer,
      settings: structuredClone(this.newSettings),
    };

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);
    this.documentManager.updateDocument({ ...doc, layers: updatedLayers, isDirty: true, updatedAt: Date.now() }, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc || !this.prevSettings) return;

    const layer = findLayerById(doc.layers, this.layerId) as AdjustmentLayer | null;
    if (!layer || layer.type !== 'adjustment') return;

    const updatedLayer: AdjustmentLayer = {
      ...layer,
      settings: structuredClone(this.prevSettings),
    };

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);
    this.documentManager.updateDocument({ ...doc, layers: updatedLayers, isDirty: true, updatedAt: Date.now() }, `Undo: ${this.name}`);
  }
}
