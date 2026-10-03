import { serializeWrites } from './ProjectOperationService';
import type { PixelData, Layer as PsdLayer, Psd } from 'ag-psd';
import type { EditDocument, Layer } from '../types/edit';
import { defaultImageEngine } from '../engine/WebGLImageEngine';
import { getPlatformBridge } from '../platform';
import { defaultProjectSerializer } from '../project/ProjectSerializer';
import { defaultAssetManager } from '../assets/AssetManager';
import type { IAssetManager } from '../types/asset';
import { createEditDocument, createImageLayer } from '../document/EditDocument';

type RenderPixels = (layer?: Layer) => Promise<PixelData>;

const unsupported = new Set(['adjustment', 'develop-smart-object']);
const RESOURCE_ID = 0x7f58;
const MAX_PRIVATE_BYTES = 192 * 1024 * 1024;
const psdBlendMode = (mode: string): PsdLayer['blendMode'] => mode.replaceAll('-', ' ') as PsdLayer['blendMode'];

/** PSD keeps separate paintable layers; unsupported parametric layers are rejected, never silently discarded. */
export async function encodeLayeredPsd(document: EditDocument, render: RenderPixels): Promise<Uint8Array> {
  if (!Number.isInteger(document.width) || !Number.isInteger(document.height) || document.width < 1 || document.height < 1 || document.width > 30000 || document.height > 30000) {
    throw new Error('PSD 画布尺寸必须在 1 至 30000 像素之间。');
  }
  const findUnsupported = (layers: Layer[]): Layer | undefined => {
    for (const layer of layers) {
      if (unsupported.has(layer.type)) return layer;
      if (layer.type === 'group') {
        const child = findUnsupported(layer.children);
        if (child) return child;
      }
    }
    return undefined;
  };
  const unsupportedLayer = findUnsupported(document.layers);
  if (unsupportedLayer) throw new Error(`图层“${unsupportedLayer.name}”尚不能无损写入 PSD。请保存为影序项目。`);
  const children: PsdLayer[] = [];
  for (const layer of [...document.layers].reverse()) {
    children.push({
      name: layer.name,
      hidden: !layer.visible,
      opacity: Math.round(Math.max(0, Math.min(1, layer.opacity)) * 255),
      blendMode: psdBlendMode(layer.blendMode),
      imageData: await render(layer),
    });
  }
  const psd: Psd = { width: document.width, height: document.height, imageData: await render(), children };
  const { writePsdUint8Array } = await import('ag-psd');
  return writePsdUint8Array(psd, { noBackground: true });
}

function imageResourceOffset(bytes: Uint8Array): number {
  if (bytes.length < 34 || String.fromCharCode(...bytes.subarray(0, 4)) !== '8BPS') throw new Error('PSD 文件头无效。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colorLength = view.getUint32(26, false);
  const offset = 30 + colorLength;
  if (offset + 4 > bytes.length) throw new Error('PSD 颜色模式数据已损坏。');
  return offset;
}

async function compressProject(json: string): Promise<Uint8Array> {
  const input = new TextEncoder().encode(json);
  if (input.length > MAX_PRIVATE_BYTES) throw new Error('项目元数据过大。');
  if (typeof CompressionStream === 'undefined') return input;
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Unknown private image resource: Photoshop skips it; Studio restores its full native project. */
export async function embedStudioProject(psd: Uint8Array, projectJson: string): Promise<Uint8Array> {
  const offset = imageResourceOffset(psd);
  const oldLength = new DataView(psd.buffer, psd.byteOffset, psd.byteLength).getUint32(offset, false);
  const end = offset + 4 + oldLength;
  if (end > psd.length) throw new Error('PSD 图像资源长度无效。');
  const payload = await compressProject(projectJson);
  const compressed = typeof CompressionStream !== 'undefined';
  const dataLength = 6 + payload.length;
  const blockLength = 12 + dataLength + (dataLength & 1);
  const output = new Uint8Array(psd.length + blockLength);
  output.set(psd.subarray(0, end), 0);
  output.set(psd.subarray(end), end + blockLength);
  const view = new DataView(output.buffer);
  view.setUint32(offset, oldLength + blockLength, false);
  output.set([0x38, 0x42, 0x49, 0x4d], end); // 8BIM
  view.setUint16(end + 4, RESOURCE_ID, false);
  // Empty Pascal name + padding occupies two bytes.
  view.setUint32(end + 8, dataLength, false);
  output.set([0x59, 0x58, 0x53, 0x54, 1, compressed ? 1 : 0], end + 12); // YXST
  output.set(payload, end + 18);
  return output;
}

async function decompressProject(payload: Uint8Array, compressed: boolean): Promise<string> {
  if (!compressed) return new TextDecoder('utf-8', { fatal: true }).decode(payload);
  if (typeof DecompressionStream === 'undefined') throw new Error('当前系统不支持读取压缩的影序项目数据。');
  const reader = new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PRIVATE_BYTES) { await reader.cancel(); throw new Error('PSD 中的项目数据过大。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function extractStudioProject(psd: Uint8Array): Promise<string | null> {
  const offset = imageResourceOffset(psd);
  const view = new DataView(psd.buffer, psd.byteOffset, psd.byteLength);
  const end = offset + 4 + view.getUint32(offset, false);
  if (end > psd.length) throw new Error('PSD 图像资源长度无效。');
  let cursor = offset + 4;
  while (cursor + 12 <= end) {
    if (String.fromCharCode(...psd.subarray(cursor, cursor + 4)) !== '8BIM') break;
    const id = view.getUint16(cursor + 4, false);
    const nameBytes = view.getUint8(cursor + 6);
    const nameLength = (1 + nameBytes + 1) & ~1;
    const lengthAt = cursor + 6 + nameLength;
    if (lengthAt + 4 > end) break;
    const dataLength = view.getUint32(lengthAt, false);
    const dataAt = lengthAt + 4;
    if (dataAt + dataLength > end) break;
    if (id === RESOURCE_ID && dataLength >= 6 && String.fromCharCode(...psd.subarray(dataAt, dataAt + 4)) === 'YXST') {
      if (view.getUint8(dataAt + 4) !== 1 || dataLength > MAX_PRIVATE_BYTES) throw new Error('PSD 中的影序项目数据版本或大小不受支持。');
      return decompressProject(psd.subarray(dataAt + 6, dataAt + dataLength), view.getUint8(dataAt + 5) === 1);
    }
    cursor = dataAt + dataLength + (dataLength & 1);
  }
  return null;
}

async function renderDocumentPixels(document: EditDocument, layer?: Layer): Promise<PixelData> {
  const canvas = window.document.createElement('canvas');
  canvas.width = document.width;
  canvas.height = document.height;
  const isolated = layer ? {
    ...document,
    backgroundColor: '#00000000',
    layers: [{ ...layer, opacity: 1, blendMode: 'normal' as const }],
  } : document;
  await defaultImageEngine.renderEdit(isolated, canvas);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法读取画布像素。');
  return context.getImageData(0, 0, document.width, document.height);
}

export async function saveLayeredPsd(document: EditDocument, path: string): Promise<void> {
  if (document.renderingVersion === 2) throw new Error('当前 PSD 写入器仅支持 8 位。请保存 .lsq 高精度工程或导出 16 位 TIFF / PNG。');
  if (!/\.psd$/i.test(path)) throw new Error('请选择 .psd 文件路径。');
  document = structuredClone(document);
  return serializeWrites([document.id, path.toLowerCase()], async () => {
  const visiblePsd = await encodeLayeredPsd(document, layer => renderDocumentPixels(document, layer));
  const projectJson = await defaultProjectSerializer.serialize({ ...document, isDirty: false }, defaultAssetManager);
  const bytes = await embedStudioProject(visiblePsd, projectJson);
  await getPlatformBridge().writeBinaryFile(path, bytes);
  });
}

/** Full-fidelity Studio projects are restored from the private resource; ordinary PSDs import as raster layers. */
export async function openLayeredPsd(blob: Blob, assets: IAssetManager): Promise<EditDocument> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const nativeProject = await extractStudioProject(bytes);
  if (nativeProject) return defaultProjectSerializer.hydrate(nativeProject, assets);
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(bytes, { useImageData: true, skipThumbnail: true });
  const layers: Layer[] = [];
  const registered: string[] = [];
  try {
    const visit = async (items: PsdLayer[]) => {
      for (const entry of [...items].reverse()) {
        if (entry.children?.length) { await visit(entry.children); continue; }
        const pixels = entry.imageData;
        if (!pixels) continue;
        if (!(pixels.data instanceof Uint8Array || pixels.data instanceof Uint8ClampedArray)) {
          throw new Error('暂不支持导入此 PSD 的高位深图层。');
        }
        const canvas = window.document.createElement('canvas');
        canvas.width = pixels.width;
        canvas.height = pixels.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法解码 PSD 图层。');
        ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法编码 PSD 图层。')), 'image/png'));
        const asset = await assets.registerBlob(png, 'image', entry.name ?? '图层', { width: pixels.width, height: pixels.height });
        registered.push(asset.id);
        const layer = createImageLayer({ name: entry.name ?? '图层', sourceAssetId: asset.id,
          naturalWidth: pixels.width, naturalHeight: pixels.height,
          x: entry.left ?? 0, y: entry.top ?? 0,
          opacity: (entry.opacity ?? 255) / 255 });
        layer.visible = !entry.hidden;
        layers.push(layer);
      }
    };
    await visit(psd.children ?? []);
    return createEditDocument({ name: 'Photoshop 文档', width: psd.width, height: psd.height, layers });
  } catch (error) {
    for (const id of registered) assets.releaseAsset(id);
    throw error;
  }
}
