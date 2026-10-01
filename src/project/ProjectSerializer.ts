import type { EditDocument, Layer } from '../types/edit';
import type { AssetHandle, IAssetManager } from '../types/asset';
import type { IDocumentManager } from '../types/document';
import { APP_VERSION } from '../core/brand';
import { validateTextEffects } from '../text/TextEffects';
import { validateMaskReference } from '../engine/editTransforms';
import { normalizeSmartFilter } from '../filters/smartFilters';

const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_PACKAGE_CHARS = 192 * 1024 * 1024;

interface EmbeddedAsset { data: string; sha256: string }
export interface ProjectManifest {
  version: '1.0'; format: 'aistudio'; appVersion: string; createdAt: number; updatedAt: number;
  document: EditDocument; assets: Record<string, AssetHandle>;
  embeddedAssets?: Record<string, EmbeddedAsset>;
}

const assetFields = ['sourceAssetId', 'rasterAssetId', 'maskAssetId', 'embeddedAssetId', 'cachedRenderAssetId'] as const;

function referencedAssetIds(doc: EditDocument): Set<string> {
  const ids = new Set<string>();
  const visit = (layers: Layer[]) => {
    for (const layer of layers) {
      const item = layer as unknown as Record<string, unknown>;
      for (const field of assetFields) if (typeof item[field] === 'string' && item[field]) ids.add(item[field] as string);
      if (layer.mask?.assetId) ids.add(layer.mask.assetId);
      if (layer.type === 'group') visit(layer.children);
    }
  };
  visit(doc.layers);
  if (doc.selection?.assetId) ids.add(doc.selection.assetId);
  return ids;
}

function validateDocument(doc: EditDocument, hasAsset: (id: string) => boolean): void {
  const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!doc || doc.kind !== 'edit' || typeof doc.id !== 'string' || !doc.id ||
      typeof doc.name !== 'string' || !positive(doc.width) || !positive(doc.height) ||
      !positive(doc.dpi) || !Array.isArray(doc.layers) || typeof doc.backgroundColor !== 'string') {
    throw new Error('项目文档已损坏或缺少必要字段。');
  }
  const layerIds = new Set<string>();
  const resource = (id: unknown) => {
    if (typeof id !== 'string' || !id || !hasAsset(id)) throw new Error(`项目缺少图像资源：${String(id)}。`);
  };
  const visit = (layers: Layer[]) => {
    for (const layer of layers) {
      if (!layer || typeof layer.id !== 'string' || !layer.id || layerIds.has(layer.id) ||
          typeof layer.name !== 'string' ||
          !['image', 'text', 'paint', 'retouch', 'adjustment', 'smart-object', 'group', 'develop-smart-object', 'generated-patch'].includes(layer.type) ||
          !layer.transform || !['x', 'y', 'width', 'height', 'rotation', 'scaleX', 'scaleY'].every(k => Number.isFinite((layer.transform as any)[k])) ||
          typeof layer.visible !== 'boolean' || !Number.isFinite(layer.opacity) || typeof layer.blendMode !== 'string') {
        throw new Error('项目包含无效的图层。');
      }
      layerIds.add(layer.id);
      const item = layer as unknown as Record<string, unknown>;
      if (['image', 'smart-object', 'generated-patch'].includes(layer.type)) resource(item.sourceAssetId);
      if (['paint', 'retouch'].includes(layer.type)) resource(item.rasterAssetId);
      if (layer.type === 'develop-smart-object') resource(item.cachedRenderAssetId);
      if (layer.type === 'generated-patch') resource(item.maskAssetId);
      for (const field of ['embeddedAssetId', 'cachedRenderAssetId']) if (item[field]) resource(item[field]);
      if (layer.mask) { resource(layer.mask.assetId); validateMaskReference(layer.mask); }
      if (layer.type === 'text' && (typeof layer.text !== 'string' || !positive(layer.fontSize) || typeof layer.fontFamily !== 'string' || typeof layer.color !== 'string')) throw new Error('项目包含无效的文字图层。');
      if (layer.type === 'text') validateTextEffects(layer);
      if (layer.type === 'adjustment' && (!layer.settings || !layer.settings.values)) throw new Error('项目包含无效的调整图层。');
      if (layer.type === 'smart-object' && layer.smartFilters != null) {
        if (!Array.isArray(layer.smartFilters)) throw new Error('项目包含无效的智能滤镜。');
        const filterIds = new Set<string>();
        for (const filter of layer.smartFilters) {
          if (!filter || typeof filter !== 'object' || typeof filter.id !== 'string' || !filter.id.trim() ||
              typeof filter.name !== 'string' || !filter.name.trim() || typeof filter.enabled !== 'boolean' ||
              !Number.isFinite(filter.opacity) || !filter.settings || typeof filter.settings !== 'object') {
            throw new Error('项目包含无效的智能滤镜。');
          }
          const normalized = normalizeSmartFilter(filter);
          const expectedSettings = normalized.settings as unknown as Record<string, number>;
          const actualSettings = filter.settings as unknown as Record<string, number>;
          const settingKeys = Object.keys(expectedSettings);
          const settingsMatch = settingKeys.length === Object.keys(actualSettings).length &&
            settingKeys.every(key => Object.hasOwn(actualSettings, key) && actualSettings[key] === expectedSettings[key]);
          if (normalized.id !== filter.id.trim() || normalized.name !== filter.name ||
              normalized.opacity !== filter.opacity || !settingsMatch) {
            throw new Error('项目包含超出范围的智能滤镜参数。');
          }
          if (filterIds.has(normalized.id)) throw new Error('项目包含重复的智能滤镜。');
          filterIds.add(normalized.id);
        }
      }
      if (layer.type === 'group') {
        if (!Array.isArray(layer.children)) throw new Error('项目包含无效的图层组。');
        visit(layer.children);
      }
    }
  };
  visit(doc.layers);
  if (doc.selection) resource(doc.selection.assetId);
  if (doc.selectedLayerId != null && !layerIds.has(doc.selectedLayerId)) throw new Error('项目选择了不存在的图层。');
}

function parseManifest(jsonString: string): ProjectManifest {
  if (jsonString.length > MAX_PACKAGE_CHARS) throw new Error('项目文件过大。');
  const manifest = JSON.parse(jsonString) as ProjectManifest;
  if (!manifest || manifest.format !== 'aistudio' || manifest.version !== '1.0') throw new Error('不支持的项目格式或版本。');
  return manifest;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(chunks.join(''));
}

function base64ToBytes(base64: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('项目资源编码已损坏。');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function remapDocumentAssets(doc: EditDocument, ids: Map<string, string>): void {
  const replace = (item: Record<string, unknown>, field: string) => {
    const current = item[field];
    if (typeof current === 'string' && ids.has(current)) item[field] = ids.get(current)!;
  };
  const visit = (layers: Layer[]) => {
    for (const layer of layers) {
      const item = layer as unknown as Record<string, unknown>;
      for (const field of assetFields) replace(item, field);
      if (layer.mask) replace(layer.mask as unknown as Record<string, unknown>, 'assetId');
      if (layer.type === 'group') visit(layer.children);
    }
  };
  visit(doc.layers);
  if (doc.selection) replace(doc.selection as unknown as Record<string, unknown>, 'assetId');
}

export class ProjectSerializer {
  /** Legacy synchronous validation for projects whose assets are already loaded. */
  parse(jsonString: string, assetManager: IAssetManager): EditDocument {
    const manifest = parseManifest(jsonString);
    validateDocument(manifest.document, id => assetManager.hasAsset(id));
    return manifest.document;
  }

  /** Embed every referenced asset. An oversized or missing asset rejects the save. */
  async serialize(doc: EditDocument, assetManager: IAssetManager): Promise<string> {
    const assets: Record<string, AssetHandle> = {};
    const embeddedAssets: Record<string, EmbeddedAsset> = {};
    validateDocument(doc, id => assetManager.hasAsset(id));
    let totalBytes = 0;
    for (const id of referencedAssetIds(doc)) {
      const handle = assetManager.getHandle(id);
      const blob = await assetManager.getBlob(id);
      if (!handle || !blob) throw new Error(`项目缺少图像资源：${id}。`);
      if (blob.size > MAX_ASSET_BYTES || (totalBytes += blob.size) > MAX_TOTAL_ASSET_BYTES) throw new Error('项目资源大小超过保存上限。');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      assets[id] = { ...handle, sizeBytes: bytes.byteLength };
      embeddedAssets[id] = { data: bytesToBase64(bytes), sha256: await sha256(bytes) };
    }
    const manifest: ProjectManifest = {
      version: '1.0', format: 'aistudio', appVersion: APP_VERSION,
      createdAt: Date.now(), updatedAt: doc.updatedAt, document: doc, assets, embeddedAssets,
    };
    const result = JSON.stringify(manifest);
    if (result.length > MAX_PACKAGE_CHARS) throw new Error('项目文件过大。');
    return result;
  }

  /** Validate all embedded bytes before registering assets; release partial registrations on failure. */
  async hydrate(jsonString: string, assetManager: IAssetManager): Promise<EditDocument> {
    const manifest = parseManifest(jsonString);
    if (!Object.hasOwn(manifest, 'embeddedAssets')) return this.parse(jsonString, assetManager);
    if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets) ||
        !manifest.embeddedAssets || typeof manifest.embeddedAssets !== 'object' || Array.isArray(manifest.embeddedAssets)) throw new Error('项目资源清单已损坏。');
    validateDocument(manifest.document, id => Object.hasOwn(manifest.embeddedAssets!, id) && Object.hasOwn(manifest.assets, id));
    const referenced = referencedAssetIds(manifest.document);
    const decoded = new Map<string, { handle: AssetHandle; bytes: Uint8Array }>();
    let totalBytes = 0;
    for (const id of referenced) {
      const handle = manifest.assets[id];
      const embedded = manifest.embeddedAssets[id];
      if (!handle || handle.id !== id || !['image', 'mask', 'preview', 'thumbnail'].includes(handle.kind) ||
          typeof handle.name !== 'string' || typeof handle.mimeType !== 'string' ||
          !Number.isSafeInteger(handle.sizeBytes) || handle.sizeBytes < 0 || handle.sizeBytes > MAX_ASSET_BYTES ||
          !embedded || typeof embedded.data !== 'string' || typeof embedded.sha256 !== 'string') throw new Error(`项目资源清单已损坏：${id}。`);
      if ((totalBytes += handle.sizeBytes) > MAX_TOTAL_ASSET_BYTES) throw new Error('项目资源大小超过打开上限。');
      if (embedded.data.length > Math.ceil(handle.sizeBytes / 3) * 4) throw new Error(`项目资源大小校验失败：${id}。`);
      const bytes = base64ToBytes(embedded.data);
      if (bytes.byteLength !== handle.sizeBytes || await sha256(bytes) !== embedded.sha256) throw new Error(`项目资源校验失败：${id}。`);
      if (handle.kind === 'mask' && (!Number.isSafeInteger(handle.width) || !Number.isSafeInteger(handle.height) || handle.width! <= 0 || handle.height! <= 0 || handle.width! * handle.height! !== bytes.byteLength)) throw new Error(`项目蒙版资源已损坏：${id}。`);
      decoded.set(id, { handle, bytes });
    }
    const registered: string[] = [];
    const idMap = new Map<string, string>();
    try {
      for (const [id, { handle, bytes }] of decoded) {
        const restored = handle.kind === 'mask'
          ? await assetManager.registerMask(new Uint8ClampedArray(bytes), handle.width!, handle.height!, handle.name)
          : await assetManager.registerBlob(new Blob([bytes as BlobPart], { type: handle.mimeType }), handle.kind, handle.name, { width: handle.width, height: handle.height });
        registered.push(restored.id);
        idMap.set(id, restored.id);
      }
      remapDocumentAssets(manifest.document, idMap);
      validateDocument(manifest.document, id => assetManager.hasAsset(id));
      return manifest.document;
    } catch (error) {
      for (const id of registered) assetManager.releaseAsset(id);
      throw error;
    }
  }

  async deserialize(jsonString: string, documentManager: IDocumentManager, assetManager: IAssetManager): Promise<EditDocument> {
    const doc = await this.hydrate(jsonString, assetManager);
    documentManager.openDocument(doc, true);
    return doc;
  }
}

export const defaultProjectSerializer = new ProjectSerializer();
