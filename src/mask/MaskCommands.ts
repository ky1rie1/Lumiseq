import { BaseCommand } from '../history/Command';
import { IDocumentManager } from '../types/document';
import { LayerMask } from '../types/edit';
import { findLayerById, updateLayerInTree } from '../document/EditDocument';
import { assertLayerEditable, assertCurrentLayer } from '../edit/LayerTree';
import { defaultAssetManager } from '../assets/AssetManager';
import { defaultSelectionManager } from '../selection/SelectionManager';
import { SelectionUtils } from '../selection/SelectionUtils';

abstract class LayerMaskCommand extends BaseCommand {
  protected before?: LayerMask;
  protected after?: LayerMask;
  constructor(name: string, documentId: string, protected layerId: string, protected documentManager: IDocumentManager) { super(name, documentId); }
  protected write(mask: LayerMask | undefined, summary: string): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc || !findLayerById(doc.layers, this.layerId)) return;
    this.documentManager.updateDocument({ ...doc, layers: updateLayerInTree(doc.layers, this.layerId, layer => ({ ...layer, mask: mask ? structuredClone(mask) : undefined })) }, summary);
  }
  undo(): void { this.write(this.before, `Undo ${this.name}`); }
  redo(): void { this.write(this.after, `Redo ${this.name}`); }
}

export class CreateMaskFromSelectionCommand extends LayerMaskCommand {
  constructor(documentId: string, layerId: string, private mode: 'reveal' | 'hide' = 'reveal', documents: IDocumentManager) { super(`Add Layer Mask (${mode})`, documentId, layerId, documents); }
  async execute(): Promise<void> {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error('Edit document not found.');
    const { layer } = assertLayerEditable(doc, this.layerId);
    this.before = layer.mask ? structuredClone(layer.mask) : undefined;
    const selection = doc.selection || defaultSelectionManager.getSelection(this.documentId);
    const source = selection ? await defaultAssetManager.getMask(selection.assetId) : null;
    const revealed = source ? new Uint8ClampedArray(source) : SelectionUtils.createFullMask(doc.width, doc.height);
    const data = this.mode === 'hide' ? SelectionUtils.invertMask(revealed) : revealed;
    assertCurrentLayer(this.documentManager, doc, this.layerId);
    const asset = await defaultAssetManager.registerMask(data, doc.width, doc.height, `LayerMask_${layer.name}`);
    try {
      assertCurrentLayer(this.documentManager, doc, this.layerId);
      this.after = { id: `mask_${crypto.randomUUID()}`, assetId: asset.id, enabled: true, linked: true, density: 1, feather: 0, inverted: false };
      this.write(this.after, this.name);
    } catch (error) { defaultAssetManager.releaseAsset(asset.id); throw error; }
  }
}

export class RemoveLayerMaskCommand extends LayerMaskCommand {
  constructor(documentId: string, layerId: string, documents: IDocumentManager) { super('Delete Layer Mask', documentId, layerId, documents); }
  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error('Edit document not found.');
    const { layer } = assertLayerEditable(doc, this.layerId);
    this.before = layer.mask ? structuredClone(layer.mask) : undefined; this.after = undefined;
    this.write(this.after, this.name);
  }
}

export class ToggleLayerMaskCommand extends LayerMaskCommand {
  constructor(documentId: string, layerId: string, documents: IDocumentManager) { super('Toggle Layer Mask', documentId, layerId, documents); }
  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error('Edit document not found.');
    const { layer } = assertLayerEditable(doc, this.layerId);
    this.before = layer.mask ? structuredClone(layer.mask) : undefined;
    this.after = layer.mask ? { ...structuredClone(layer.mask), enabled: !layer.mask.enabled } : undefined;
    this.write(this.after, this.name);
  }
}

export class InvertLayerMaskCommand extends LayerMaskCommand {
  constructor(documentId: string, layerId: string, documents: IDocumentManager) { super('Invert Layer Mask', documentId, layerId, documents); }
  async execute(): Promise<void> {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error('Edit document not found.');
    const { layer } = assertLayerEditable(doc, this.layerId);
    if (!layer.mask) throw new Error('Layer mask not found.');
    this.before = structuredClone(layer.mask);
    const source = await defaultAssetManager.getMask(layer.mask.assetId);
    if (!source) throw new Error('Layer mask asset not found.');
    assertCurrentLayer(this.documentManager, doc, this.layerId);
    const handle = defaultAssetManager.getHandle(layer.mask.assetId);
    const asset = await defaultAssetManager.registerMask(SelectionUtils.invertMask(source), handle?.width ?? doc.width, handle?.height ?? doc.height, 'InvertedMask');
    try {
      assertCurrentLayer(this.documentManager, doc, this.layerId);
      // Invert the pixels once; retaining the interpretation flag avoids double inversion in rendering.
      this.after = { ...structuredClone(layer.mask), assetId: asset.id };
      this.write(this.after, this.name);
    } catch (error) { defaultAssetManager.releaseAsset(asset.id); throw error; }
  }
}
