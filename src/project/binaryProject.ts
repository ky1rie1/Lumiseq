import type { EditDocument } from '../types/edit';
import type { AssetHandle, IAssetManager } from '../types/asset';
import { APP_VERSION } from '../core/brand';
import { referencedAssetIds, remapDocumentAssets, sha256, validateDocument } from './ProjectSerializer';

const MAX_MANIFEST = 4 * 1024 * 1024;
const MAX_RESOURCE = 512 * 1024 * 1024;
const MAX_PAYLOAD = 1024 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const magic = new TextEncoder().encode('LSQ2');
interface Resource { id: string; handle: AssetHandle; offset: number; length: number; sha256: string }
interface Manifest { format: 'aistudio'; version: '2.0'; appVersion: string; document: EditDocument; resources: Resource[] }

export function isBinaryProject(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && magic.every((value, index) => bytes[index] === value);
}

function validateResource(resource: Resource): void {
  const h = resource?.handle;
  if (!resource || typeof resource.id !== 'string' || !resource.id || !h || h.id !== resource.id ||
      !['image', 'mask', 'preview', 'thumbnail'].includes(h.kind) || typeof h.name !== 'string' || typeof h.mimeType !== 'string' ||
      !Number.isSafeInteger(resource.offset) || resource.offset < 0 || !Number.isSafeInteger(resource.length) ||
      resource.length < 0 || resource.length > MAX_RESOURCE || h.sizeBytes !== resource.length ||
      !/^[a-f0-9]{64}$/.test(resource.sha256)) throw new Error('项目资源清单无效。');
  if (h.kind === 'mask' && (!Number.isSafeInteger(h.width) || !Number.isSafeInteger(h.height) ||
      h.width! <= 0 || h.height! <= 0 || h.width! * h.height! !== resource.length)) throw new Error('项目蒙版尺寸无效。');
}

export async function serializeBinaryProject(doc: EditDocument, assets: IAssetManager): Promise<Uint8Array> {
  doc = structuredClone(doc);
  validateDocument(doc, id => assets.hasAsset(id));
  if (doc.renderingVersion !== 2) throw new Error('高精度项目需要版本 2 文档。');
  const ids = referencedAssetIds(doc);
  if (ids.size > MAX_ENTRIES) throw new Error('项目资源数量过多。');
  const resources: Resource[] = [], blobs: Blob[] = [];
  let offset = 0;
  for (const id of ids) {
    const handle = assets.getHandle(id), blob = await assets.getBlob(id);
    if (!handle || !blob || blob.size > MAX_RESOURCE || offset + blob.size > MAX_PAYLOAD) throw new Error('项目资源缺失或大小超限。');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const resource = { id, handle: { ...handle, sizeBytes: bytes.length }, offset, length: bytes.length, sha256: await sha256(bytes) };
    validateResource(resource);
    resources.push(resource); blobs.push(blob); offset += bytes.length;
  }
  const manifest: Manifest = { format: 'aistudio', version: '2.0', appVersion: APP_VERSION, document: doc, resources };
  const encoded = new TextEncoder().encode(JSON.stringify(manifest));
  if (encoded.length > MAX_MANIFEST) throw new Error('项目清单过大。');
  const output = new Uint8Array(8 + encoded.length + offset);
  output.set(magic); new DataView(output.buffer).setUint32(4, encoded.length, true); output.set(encoded, 8);
  for (let i = 0; i < blobs.length; i++) output.set(new Uint8Array(await blobs[i].arrayBuffer()), 8 + encoded.length + resources[i].offset);
  return output;
}

export async function hydrateBinaryProject(bytes: Uint8Array, assets: IAssetManager): Promise<EditDocument> {
  if (!isBinaryProject(bytes) || bytes.length < 8 || bytes.length > MAX_PAYLOAD + MAX_MANIFEST + 8) throw new Error('项目格式或大小无效。');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (length > MAX_MANIFEST || 8 + length > bytes.length) throw new Error('项目清单已损坏。');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(8, 8 + length))) as Manifest;
  if (manifest?.format !== 'aistudio' || manifest.version !== '2.0' || !Array.isArray(manifest.resources) || manifest.resources.length > MAX_ENTRIES || manifest.document?.renderingVersion !== 2) throw new Error('不支持的项目格式或版本。');
  const refs = referencedAssetIds(manifest.document), ids = new Set<string>();
  let offset = 0;
  for (const resource of manifest.resources) {
    validateResource(resource);
    if (ids.has(resource.id) || !refs.has(resource.id) || resource.offset !== offset) throw new Error('项目资源重复、未引用或偏移无效。');
    ids.add(resource.id); offset += resource.length;
    if (offset > MAX_PAYLOAD || 8 + length + offset > bytes.length) throw new Error('项目资源大小无效。');
  }
  if (offset !== bytes.length - 8 - length) throw new Error('项目存在未登记的资源字节。');
  validateDocument(manifest.document, id => ids.has(id));
  // Verify the entire package before mutating the asset registry.
  for (const resource of manifest.resources) {
    const view = bytes.subarray(8 + length + resource.offset, 8 + length + resource.offset + resource.length);
    if (await sha256(view) !== resource.sha256) throw new Error('项目资源校验失败。');
  }
  const registered: string[] = [], mapping = new Map<string, string>();
  try {
    for (const resource of manifest.resources) {
      const view = bytes.subarray(8 + length + resource.offset, 8 + length + resource.offset + resource.length), h = resource.handle;
      const restored = h.kind === 'mask'
        ? await assets.registerMask(new Uint8ClampedArray(view), h.width!, h.height!, h.name)
        : await assets.registerBlob(new Blob([view as BlobPart], { type: h.mimeType }), h.kind, h.name, { width: h.width, height: h.height });
      registered.push(restored.id); mapping.set(resource.id, restored.id);
    }
    remapDocumentAssets(manifest.document, mapping);
    validateDocument(manifest.document, id => assets.hasAsset(id));
    return manifest.document;
  } catch (error) {
    for (const id of registered) assets.releaseAsset(id);
    throw error;
  }
}
