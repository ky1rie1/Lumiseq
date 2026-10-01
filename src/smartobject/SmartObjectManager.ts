import { assertLayerEditable, assertCurrentLayer } from '../edit/LayerTree';
// src/smartobject/SmartObjectManager.ts
//! Smart Object & Develop Round-Trip Engine (Phase 6)
//! Enables non-destructive RAW re-editing inside the Edit workspace and layer rasterization.

import { IDocumentManager } from '../types/document';
import { CommandBus } from '../history/CommandBus';
import { BaseCommand } from '../history/Command';
import { DevelopSettings } from '../types/develop';
import { EditDocument, SmartObjectLayer, PaintLayer, Layer, BaseLayer } from '../types/edit';
import { createSmartObjectLayer, createPaintLayer, findLayerById, updateLayerInTree } from '../document/EditDocument';
import { defaultAssetManager } from '../assets/AssetManager';

function layerAppearance(layer: BaseLayer): BaseLayer {
  return structuredClone({ id: layer.id, name: layer.name, type: layer.type,
    visible: layer.visible, opacity: layer.opacity, fillOpacity: layer.fillOpacity,
    blendMode: layer.blendMode, transform: layer.transform, mask: layer.mask,
    locked: layer.locked, clipToBelow: layer.clipToBelow });
}

export class UpdateSmartObjectCommand extends BaseCommand {
  private prevSettings?: DevelopSettings;
  private prevAssetId: string;

  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly newSettings: DevelopSettings,
    public readonly newAssetId: string,
    private documentManager: IDocumentManager
  ) {
    super('Update Smart Object', documentId);
    const doc = documentManager.getEditDocument(documentId);
    const layer = doc ? (findLayerById(doc.layers, layerId) as SmartObjectLayer | null) : null;
    this.prevAssetId = layer?.sourceAssetId || '';
    this.prevSettings = layer?.developSettings ? structuredClone(layer.developSettings) : undefined;
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId) as SmartObjectLayer | null;
    if (!layer || layer.type !== 'smart-object') return;

    const updatedLayer: SmartObjectLayer = {
      ...layer,
      sourceAssetId: this.newAssetId,
      developSettings: structuredClone(this.newSettings),
    };

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);
    this.documentManager.updateDocument({ ...doc, layers: updatedLayers, isDirty: true, updatedAt: Date.now() }, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const layer = findLayerById(doc.layers, this.layerId) as SmartObjectLayer | null;
    if (!layer || layer.type !== 'smart-object') return;

    const updatedLayer: SmartObjectLayer = {
      ...layer,
      sourceAssetId: this.prevAssetId,
      developSettings: this.prevSettings ? structuredClone(this.prevSettings) : undefined,
    };

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);
    this.documentManager.updateDocument({ ...doc, layers: updatedLayers, isDirty: true, updatedAt: Date.now() }, `Undo: ${this.name}`);
  }
}

export class ConvertToSmartObjectCommand extends BaseCommand {
  private originalLayer: Layer | null = null;
  private smartObjectLayer: SmartObjectLayer;

  constructor(
    documentId: string,
    public readonly sourceLayerId: string,
    private documentManager: IDocumentManager
  ) {
    super('Convert to Smart Object', documentId);
    const doc = documentManager.getEditDocument(documentId);
    const layer = doc ? findLayerById(doc.layers, sourceLayerId) : null;
    if (!layer) throw new Error(`Layer ${sourceLayerId} not found`);
    if (!['image', 'paint', 'retouch'].includes(layer.type)) {
      throw new Error('Only image, paint and retouch raster layers currently support Smart Object conversion.');
    }
    this.originalLayer = structuredClone(layer);

    let sourceAssetId = '';
    if ('sourceAssetId' in layer) sourceAssetId = (layer as any).sourceAssetId;
    else if ('rasterAssetId' in layer) sourceAssetId = (layer as any).rasterAssetId;

    this.smartObjectLayer = createSmartObjectLayer({
      id: layer.id,
      name: `${layer.name} (Smart Object)`,
      sourceAssetId,
      originalWidth: layer.transform.width,
      originalHeight: layer.transform.height,
      x: layer.transform.x,
      y: layer.transform.y,
      opacity: layer.opacity,
    });
    this.smartObjectLayer = { ...this.smartObjectLayer, ...layerAppearance(layer), type: 'smart-object', name: this.smartObjectLayer.name };
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;
    assertLayerEditable(doc, this.sourceLayerId);

    const updatedLayers = updateLayerInTree(doc.layers, this.smartObjectLayer);
    this.documentManager.updateDocument({ ...doc, layers: updatedLayers, isDirty: true, updatedAt: Date.now() }, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc || !this.originalLayer) return;

    const updatedLayers = updateLayerInTree(doc.layers, this.originalLayer);
    this.documentManager.updateDocument({ ...doc, layers: updatedLayers, isDirty: true, updatedAt: Date.now() }, `Undo: ${this.name}`);
  }
}

export class RasterizeSmartObjectCommand extends BaseCommand {
  private originalSmartObject: SmartObjectLayer | null = null;
  private rasterLayer?: PaintLayer;

  constructor(
    documentId: string,
    public readonly smartObjectId: string,
    private documentManager: IDocumentManager
  ) {
    super('Rasterize Smart Object', documentId);
    const doc = documentManager.getEditDocument(documentId);
    const layer = doc ? (findLayerById(doc.layers, smartObjectId) as SmartObjectLayer | null) : null;
    if (!layer || layer.type !== 'smart-object') throw new Error(`Smart Object ${smartObjectId} not found`);
    this.originalSmartObject = structuredClone(layer);
  }

  execute(): void | Promise<void> {
    if (!this.rasterLayer) return this.bake();
    this.writeRasterLayer();
  }

  private async bake(): Promise<void> {
    const expected = this.documentManager.getEditDocument(this.documentId);
    if (!expected) throw new Error('Smart Object document is unavailable.');
    assertLayerEditable(expected, this.smartObjectId);
    const original = this.originalSmartObject!;
    if (JSON.stringify(findLayerById(expected.layers, this.smartObjectId)) !== JSON.stringify(original)) throw new Error('Smart Object changed before rasterization.');
    const { defaultImageEngine } = await import('../engine/WebGLImageEngine');
    const rendered = await defaultImageEngine.rasterizeSmartObjectContent(original);
    assertCurrentLayer(this.documentManager, expected, this.smartObjectId);
    const asset = await defaultAssetManager.registerBlob(rendered.blob, 'image', `${original.name} (Rasterized)`, rendered);
    const document = this.documentManager.getEditDocument(this.documentId);
    const current = document ? findLayerById(document.layers, this.smartObjectId) : null;
    if (document !== expected || !current || JSON.stringify(current) !== JSON.stringify(original)) {
      defaultAssetManager.releaseAsset(asset.id);
      throw new Error('Smart Object changed while rasterization was running.');
    }
    try { assertCurrentLayer(this.documentManager, expected, this.smartObjectId); }
    catch (error) { defaultAssetManager.releaseAsset(asset.id); throw error; }
    this.rasterLayer = {
      ...createPaintLayer({ rasterAssetId: asset.id, width: rendered.width, height: rendered.height }),
      ...layerAppearance(original), type: 'paint', name: `${original.name} (Rasterized)`,
    };
    this.writeRasterLayer();
  }

  private writeRasterLayer(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc || !this.rasterLayer) return;
    assertLayerEditable(doc, this.smartObjectId);

    const updatedLayers = updateLayerInTree(doc.layers, this.rasterLayer);
    this.documentManager.updateDocument({ ...doc, layers: updatedLayers, isDirty: true, updatedAt: Date.now() }, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc || !this.originalSmartObject) return;

    const updatedLayers = updateLayerInTree(doc.layers, this.originalSmartObject);
    this.documentManager.updateDocument({ ...doc, layers: updatedLayers, isDirty: true, updatedAt: Date.now() }, `Undo: ${this.name}`);
  }
}

export class SmartObjectManager {
  /**
   * Retrieves develop settings and raw URI for re-editing in Develop workspace.
   */
  getDevelopRoundTripData(doc: EditDocument, layerId: string): {
    rawUri?: string;
    developSettings?: DevelopSettings;
  } | null {
    const layer = findLayerById(doc.layers, layerId);
    if (!layer || layer.type !== 'smart-object') return null;

    const so = layer as SmartObjectLayer;
    return {
      rawUri: so.sourceRawUri,
      developSettings: so.developSettings,
    };
  }

  /**
   * Commits updated settings and rendered asset from Develop workspace back into Smart Object.
   */
  updateSmartObject(params: {
    documentId: string;
    layerId: string;
    newSettings: DevelopSettings;
    newAssetId: string;
    commandBus: CommandBus;
    documentManager: IDocumentManager;
  }): void {
    const cmd = new UpdateSmartObjectCommand(
      params.documentId,
      params.layerId,
      params.newSettings,
      params.newAssetId,
      params.documentManager
    );
    params.commandBus.execute(cmd);
  }

  /**
   * Converts any layer into a Smart Object.
   */
  convertToSmartObject(
    documentId: string,
    layerId: string,
    commandBus: CommandBus,
    documentManager: IDocumentManager
  ): void {
    const cmd = new ConvertToSmartObjectCommand(documentId, layerId, documentManager);
    commandBus.execute(cmd);
  }

  /**
   * Rasterizes Smart Object to a regular PaintLayer.
   */
  rasterize(
    documentId: string,
    layerId: string,
    commandBus: CommandBus,
    documentManager: IDocumentManager
  ): Promise<void> {
    const cmd = new RasterizeSmartObjectCommand(documentId, layerId, documentManager);
    return Promise.resolve(commandBus.execute(cmd));
  }
}

export const defaultSmartObjectManager = new SmartObjectManager();
