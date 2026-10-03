import type { IAssetManager } from '../types/asset';
import type { DevelopDocument } from '../types/develop';
import type { IPlatformBridge } from '../platform';
import { createDevelopDocument } from '../document/DevelopDocument';
import { rasterizeDevelopMask } from '../develop/maskRaster';
import { APP_VERSION } from '../core/brand';

const MAX_PROJECT_CHARS = 192 * 1024 * 1024;
const MAX_MASKS = 256;

export function isDevelopProjectManifest(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  if (!manifest.document || typeof manifest.document !== 'object') return false;
  return (manifest.document as Record<string, unknown>).kind === 'develop';
}

/** A RAW project stores adjustments and source path; transient decoded pixels are rebuilt on open. */
export class DevelopProjectSerializer {
  async serialize(doc: DevelopDocument, assets: IAssetManager): Promise<string> {
    if (!doc.sourceUri || (doc.isRaw && !(/^[A-Za-z]:[\\/]/.test(doc.sourceUri) || doc.sourceUri.startsWith('\\\\') || doc.sourceUri.startsWith('/')))) {
      throw new Error('RAW 项目需要有效的本地原始文件路径。');
    }
    if (doc.settings.masks.length > MAX_MASKS) throw new Error('局部蒙版数量超过保存上限。');
    for (const mask of doc.settings.masks) {
      if (!assets.hasAsset(mask.maskAssetId)) throw new Error(`局部蒙版资源已丢失：${mask.name}。`);
    }
    let sourceImage: {data:string; mimeType:string; sha256:string} | undefined;
    if (!doc.isRaw) {
      const blob = doc.sourceAssetId ? await assets.getBlob(doc.sourceAssetId) : null;
      if (!blob?.size || blob.size > 64 * 1024 * 1024) throw new Error('Source image is missing or exceeds the 64 MiB project limit.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const chunks:string[]=[];
      for(let i=0;i<bytes.length;i+=32768) chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      sourceImage = {data:btoa(chunks.join('')),mimeType:blob.type,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
    }
    if (doc.settings.renderingVersion!==undefined && doc.settings.renderingVersion!==1 && doc.settings.renderingVersion!==2) throw new Error('Unsupported rendering version.');
    if ((doc.settingsSnapshots??[]).some(snapshot=>snapshot.settings.renderingVersion!==undefined && snapshot.settings.renderingVersion!==1 && snapshot.settings.renderingVersion!==2))throw new Error('Unsupported snapshot rendering version.');
    const settings = structuredClone(doc.settings);
    // Mask bitmaps are deterministic from geometry and strokes, so no session asset IDs belong on disk.
    settings.masks = settings.masks.map(mask => ({ ...mask, maskAssetId: '' }));
    const document = {
      id: doc.id, kind: 'develop' as const, sourceUri: doc.sourceUri, fileName: doc.fileName,
      fileSizeBytes: doc.fileSizeBytes, width: doc.width, height: doc.height,
      isRaw: doc.isRaw, exif: doc.exif, settings, aiHistory: doc.aiHistory,
      rawProcessingVersion:doc.isRaw ? (doc.rawProcessingVersion ?? 1) : undefined,
      rawCorrectionMode:doc.isRaw ? (doc.rawCorrectionMode ?? 'camera') : undefined,
      settingsSnapshots: (doc.settingsSnapshots ?? []).map(snapshot => ({ ...structuredClone(snapshot), settings: { ...structuredClone(snapshot.settings), masks: snapshot.settings.masks.map(mask => ({ ...structuredClone(mask), maskAssetId: '' })) } })),
      updatedAt: doc.updatedAt,
    };
    const result = JSON.stringify({ version: '1.0', format: 'aistudio', appVersion: APP_VERSION,
      createdAt: Date.now(), updatedAt: doc.updatedAt, document, sourceImage });
    if (result.length > MAX_PROJECT_CHARS) throw new Error('项目文件过大。');
    return result;
  }

  async hydrate(json: string, assets: IAssetManager, platform: Pick<IPlatformBridge, 'getRawMetadata'>): Promise<DevelopDocument> {
    if (json.length > MAX_PROJECT_CHARS) throw new Error('项目文件过大。');
    const manifest = JSON.parse(json) as Record<string, unknown>;
    if (manifest?.format !== 'aistudio' || manifest.version !== '1.0' || !isDevelopProjectManifest(manifest)) {
      throw new Error('不支持的 RAW 项目格式或版本。');
    }
    const source = manifest.document as Partial<DevelopDocument>;
    if (source.rawProcessingVersion!==undefined && source.rawProcessingVersion!==1 && source.rawProcessingVersion!==2) throw new Error('Unsupported RAW processing version.');
    if (source.rawCorrectionMode!==undefined && source.rawCorrectionMode!=='camera' && source.rawCorrectionMode!=='uncorrected') throw new Error('Unsupported RAW correction mode.');
    if (source.rawProcessingVersion!==2 && source.rawCorrectionMode==='uncorrected') throw new Error('Uncorrected inspection requires RAW processing version 2.');
    if (typeof source.id !== 'string' || !source.id || typeof source.fileName !== 'string' || !source.fileName ||
        typeof source.sourceUri !== 'string' || !source.sourceUri || typeof source.isRaw !== 'boolean' ||
        !Number.isFinite(source.width) || (source.width ?? 0) <= 0 || !Number.isFinite(source.height) || (source.height ?? 0) <= 0 ||
        !source.settings || typeof source.settings !== 'object' || !Array.isArray(source.settings.masks) ||
        source.settings.masks.length > MAX_MASKS) throw new Error('RAW 项目文档已损坏。');
    if (source.settings.renderingVersion!==undefined && source.settings.renderingVersion!==1 && source.settings.renderingVersion!==2) throw new Error('Unsupported rendering version.');
    if (source.isRaw) {
      if (!(/^[A-Za-z]:[\\/]/.test(source.sourceUri) || source.sourceUri.startsWith('\\\\') || source.sourceUri.startsWith('/'))) {
        throw new Error('RAW 项目原始文件路径无效。');
      }
      const metadata = await platform.getRawMetadata(source.sourceUri);
      if (!metadata?.width || !metadata.height) throw new Error('找不到 RAW 原始文件，或无法读取其元数据。');
    }
    const restored = createDevelopDocument({ id: source.id, sourceUri: source.sourceUri,
      fileName: source.fileName, fileSizeBytes: source.fileSizeBytes,
      width: source.width, height: source.height, isRaw: source.isRaw,
      rawProcessingVersion:source.rawProcessingVersion ?? 1,
      rawCorrectionMode:source.rawCorrectionMode ?? 'camera',
      exif: source.exif, settings: source.settings });
    if (source.settingsSnapshots !== undefined && (!Array.isArray(source.settingsSnapshots) || source.settingsSnapshots.length > 64 || source.settingsSnapshots.some(snapshot => !snapshot || typeof snapshot.id !== 'string' || typeof snapshot.name !== 'string' || !snapshot.settings || !Array.isArray(snapshot.settings.masks) || snapshot.settings.masks.length > MAX_MASKS))) throw new Error('RAW 项目快照已损坏。');
    if (Array.isArray(source.settingsSnapshots) && source.settingsSnapshots.some(s=>s.settings.renderingVersion!==undefined && s.settings.renderingVersion!==1 && s.settings.renderingVersion!==2)) throw new Error('Unsupported snapshot rendering version.');
    restored.settingsSnapshots = structuredClone(source.settingsSnapshots ?? []);
    restored.aiHistory = source.aiHistory;
    restored.updatedAt = source.updatedAt ?? Date.now();
    const registered: string[] = [];
    try {
      if (!restored.isRaw) {
        const embedded = manifest.sourceImage as {data?:string;mimeType?:string;sha256?:string} | undefined;
        if (!embedded || typeof embedded.data !== 'string' || typeof embedded.mimeType !== 'string' || typeof embedded.sha256 !== 'string' || embedded.data.length > 90 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(embedded.data)) throw new Error('Project source image is missing or corrupt.');
        const decoded = atob(embedded.data); const bytes = Uint8Array.from(decoded,c=>c.charCodeAt(0));
        const digest = await crypto.subtle.digest('SHA-256',bytes);
        if (!bytes.length || Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('') !== embedded.sha256) throw new Error('Project source image checksum failed.');
        const handle = await assets.registerBlob(new Blob([bytes],{type:embedded.mimeType}),'image',restored.fileName,{width:restored.width,height:restored.height});
        registered.push(handle.id);restored.sourceAssetId=handle.id;restored.sourceUri=assets.getDisplayUrl(handle.id) ?? '';
        if (!restored.sourceUri) throw new Error('Cannot load project source image.');
      }
      for (const mask of [restored.settings, ...(restored.settingsSnapshots ?? []).map(snapshot => snapshot.settings)].flatMap(settings => settings.masks)) {
        if (!mask || typeof mask.name !== 'string' || !['linear', 'radial', 'brush'].includes(mask.kind) ||
            !mask.geometry || typeof mask.geometry !== 'object' || !Array.isArray(mask.strokes ?? [])) {
          throw new Error('RAW 项目局部蒙版已损坏。');
        }
        const pixels = rasterizeDevelopMask(mask);
        const handle = await assets.registerMask(pixels, 512, 512, mask.name);
        registered.push(handle.id);
        mask.maskAssetId = handle.id;
      }
      return restored;
    } catch (error) {
      for (const id of registered) assets.releaseAsset(id);
      throw error;
    }
  }
}

export const defaultDevelopProjectSerializer = new DevelopProjectSerializer();
