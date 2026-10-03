import type { IDocumentManager } from '../types/document';
import type { IAssetManager } from '../types/asset';
import type { ICommandBus } from '../types/history';
import type { DevelopSmartObjectLayer } from '../types/edit';
import type { DevelopSettings } from '../types/develop';
import { createEditDocument, findLayerById, updateLayerInTree } from '../document/EditDocument';
import { createDevelopDocument } from '../document/DevelopDocument';
import { assertLayerEditable } from '../edit/LayerTree';
import { BaseCommand } from '../history/Command';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultCommandBus } from '../history/CommandBus';
import { defaultAssetManager } from '../assets/AssetManager';
import { getPlatformBridge } from '../platform';

export function rawRecipeRevision(layer: DevelopSmartObjectLayer): string {
  return JSON.stringify([layer.sourceAssetId, layer.rawProcessingVersion, layer.rawCorrectionMode, layer.developSettings]);
}

class UpdateRawRecipeCommand extends BaseCommand {
  private previous?: DevelopSettings;
  constructor(documentId: string, private layerId: string, private settings: DevelopSettings, private revision: string, private documents: IDocumentManager, private initialGuard?: () => void) { super('更新 RAW 智能对象', documentId); }
  execute(): void {
    this.initialGuard?.();
    const doc = this.documents.getEditDocument(this.documentId);
    if (!doc) throw new Error('原图像工程已关闭。');
    const layer = assertLayerEditable(doc, this.layerId).layer;
    if (layer.type !== 'develop-smart-object' || rawRecipeRevision(layer) !== this.revision) throw new Error('RAW 智能对象已改变，请重新打开参数。');
    this.previous = structuredClone(layer.developSettings);
    this.documents.updateDocument({ ...doc, layers: updateLayerInTree(doc.layers, { ...layer, developSettings: structuredClone(this.settings), cachedRenderAssetId: undefined }) }, this.name);
    this.initialGuard = undefined;
  }
  undo(): void {
    const doc = this.documents.getEditDocument(this.documentId), layer = doc ? findLayerById(doc.layers, this.layerId) : null;
    if (doc && layer?.type === 'develop-smart-object' && this.previous) this.documents.updateDocument({ ...doc, layers: updateLayerInTree(doc.layers, { ...layer, developSettings: structuredClone(this.previous) }) }, `撤销 ${this.name}`);
  }
}

interface RawSourcePorts { read(path: string): Promise<Uint8Array>; stage(name: string, blob: Blob): Promise<string>; remove?(path: string): Promise<void> }
function checkSignal(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Operation cancelled', 'AbortError'); }
function cancellable<T>(promise: Promise<T>, signal?: AbortSignal, late?: (value: T) => void): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let cancelled = signal.aborted;
    const abort = () => { cancelled = true;signal.removeEventListener('abort', abort);reject(new DOMException('Operation cancelled', 'AbortError')); };
    if (cancelled) abort();else signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort);if (cancelled) late?.(value);else resolve(value); }, error => { signal.removeEventListener('abort', abort);reject(error); });
  });
}
type StagedResource = { path: string; remove: (path: string) => Promise<void> };
const stagedByManager = new WeakMap<IDocumentManager, Map<string, StagedResource>>();
function trackStaged(documents: IDocumentManager, id: string, resource: StagedResource): void {
  let paths = stagedByManager.get(documents);
  if (!paths) {
    paths = new Map();stagedByManager.set(documents, paths);
    const tracked = paths;
    documents.subscribe(event => {
      if (event.type !== 'closed') return;
      const staged = tracked.get(event.documentId);if (!staged) return;
      tracked.delete(event.documentId);void staged.remove(staged.path).catch(() => {});
    });
  }
  paths.set(id, resource);
}
export class RawSmartObjectService {
  constructor(private documents: IDocumentManager, private commands: ICommandBus, private assets: IAssetManager, private source: RawSourcePorts) {}

  async transfer(id: string) {
    const original = this.documents.getDevelopDocument(id);
    if (!original?.isRaw || !original.nativeAssetId || original.rawState !== 'ready') throw new Error('请等待 RAW 原始解码完成。');
    const snapshot = structuredClone(original);
    let blob = snapshot.originalRawAssetId ? await this.assets.getBlob(snapshot.originalRawAssetId) : null;
    if (snapshot.originalRawAssetId && !blob) throw new Error('RAW 原文件资源丢失，无法使用磁盘上的替代文件。');
    if (!blob) blob = new Blob([await this.source.read(snapshot.sourceUri) as BlobPart]);
    if (!blob.size || blob.size > 256 * 1024 * 1024) throw new Error('RAW 原文件缺失或超过 256 MiB 接入上限。');
    const handle = await this.assets.registerBlob(blob, 'image', snapshot.fileName, { width: snapshot.width, height: snapshot.height });
    try {
      if (this.documents.getDevelopDocument(id) !== original) throw new Error('调色文档已改变，请重新转入。');
      const layer: DevelopSmartObjectLayer = {
        id: crypto.randomUUID(), name: snapshot.fileName, type: 'develop-smart-object', sourceAssetId: handle.id,
        sourceRawUri: snapshot.sourceUri, rawProcessingVersion: snapshot.rawProcessingVersion ?? 1, rawCorrectionMode: snapshot.rawCorrectionMode ?? 'camera',
        developSettings: structuredClone(snapshot.settings), visible: true, opacity: 1, blendMode: 'normal',
        transform: { x: 0, y: 0, width: snapshot.width, height: snapshot.height, rotation: 0, scaleX: 1, scaleY: 1 },
      };
      const edit = createEditDocument({ name: snapshot.fileName.replace(/\.[^.]+$/, '') + '_Composite', width: snapshot.width, height: snapshot.height, renderingVersion: 2, layers: [layer] });
      this.documents.openDocument(edit); return edit;
    } catch (error) { this.assets.releaseAsset(handle.id); throw error; }
  }

  async openRecipe(documentId: string, layerId: string, signal?: AbortSignal) {
    checkSignal(signal);
    const doc = this.documents.getEditDocument(documentId);
    if (!doc || doc.renderingVersion !== 2) throw new Error('需要高精度图像工程。');
    const layer = assertLayerEditable(doc, layerId).layer;
    if (layer.type !== 'develop-smart-object' || !layer.sourceAssetId) throw new Error('请选择 RAW 智能对象。');
    const active = this.documents.getActiveDocument();
    let switched = false;
    const stopWatching = signal ? this.documents.subscribe(event => { if (event.type === 'activated') switched = true; }) : () => {};
    const remove = async (path: string) => { try { await this.source.remove?.(path); } catch { /* Cleanup cannot replace the operation error. */ } };
    let path: string | undefined;
    try {
    const snapshot = structuredClone(layer), blob = await cancellable(this.assets.getBlob(snapshot.sourceAssetId!), signal);
    if (!blob) throw new Error('RAW 原文件资源丢失。');
    checkSignal(signal);
    path = await cancellable(this.source.stage(this.assets.getHandle(snapshot.sourceAssetId!)?.name ?? 'source.raw', blob), signal, latePath => { void remove(latePath); });
    checkSignal(signal);
    const current = this.documents.getEditDocument(documentId), latest = current ? findLayerById(current.layers, layerId) : null;
    if (current !== doc || latest?.type !== 'develop-smart-object' || rawRecipeRevision(latest) !== rawRecipeRevision(snapshot) ||
      (signal && (switched || this.documents.getActiveDocument() !== active))) throw new Error('RAW 智能对象已改变。');
    const variant = createDevelopDocument({ sourceUri: path, fileName: snapshot.name, isRaw: true, width: snapshot.transform.width, height: snapshot.transform.height });
    variant.settings = structuredClone(snapshot.developSettings); variant.originalRawAssetId = snapshot.sourceAssetId;
    variant.rawProcessingVersion = snapshot.rawProcessingVersion ?? 1; variant.rawCorrectionMode = snapshot.rawCorrectionMode ?? 'camera';
    variant.rawSmartObjectLink = { documentId, layerId, sourceRevision: rawRecipeRevision(snapshot) };
    stopWatching();
    this.documents.openDocument(variant);
    trackStaged(this.documents, variant.id, { path, remove });
    path = undefined;
    return variant;
    } catch (error) { if (path) await remove(path);throw error; }
    finally { stopWatching(); }
  }

  async applyRecipe(variantId: string, signal?: AbortSignal): Promise<string> {
    checkSignal(signal);
    const variant = this.documents.getDevelopDocument(variantId), link = variant?.rawSmartObjectLink;
    if (!variant || !link) throw new Error('当前调色文档没有 RAW 智能对象关联。');
    const active = this.documents.getActiveDocument();let switched = false;
    const stopWatching = signal ? this.documents.subscribe(event => { if (event.type === 'activated') switched = true; }) : () => {};
    const guard = () => {
      checkSignal(signal);
      if (this.documents.getDevelopDocument(variantId) !== variant || (signal && (switched || this.documents.getActiveDocument() !== active))) throw new Error('RAW 调色文档已改变。');
    };
    try {
    await cancellable(Promise.resolve(this.commands.execute(new UpdateRawRecipeCommand(link.documentId, link.layerId, structuredClone(variant.settings), link.sourceRevision, this.documents, guard))), signal);
    guard();
    const doc = this.documents.getEditDocument(link.documentId)!, layer = findLayerById(doc.layers, link.layerId) as DevelopSmartObjectLayer;
    this.documents.updateDocument({ ...variant, rawSmartObjectLink: { ...link, sourceRevision: rawRecipeRevision(layer) } }, 'RAW 参数已应用');
    stopWatching();this.documents.setActiveDocument(link.documentId); return link.documentId;
    } finally { stopWatching(); }
  }
}

export const defaultRawSmartObjects = new RawSmartObjectService(defaultDocumentManager, defaultCommandBus, defaultAssetManager, {
  remove: async path => { await getPlatformBridge().deleteFile(path); },
  read: path => getPlatformBridge().readBinaryFile(path), stage: (name, blob) => {
    const platform = getPlatformBridge();
    if (!platform.stageRawSource) throw new Error('RAW 智能对象需要桌面版。');
    return platform.stageRawSource(name, blob);
  },
});
