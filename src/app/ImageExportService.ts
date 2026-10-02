import { serializeWrites } from './ProjectOperationService';
import type { StudioDocument } from '../types/document';
import type { DevelopSettings } from '../types/develop';
import { defaultImageEngine } from '../engine/WebGLImageEngine';
import { getPlatformBridge } from '../platform';
import { saveExportedImage } from './exportImage';
import { resolveDevelopExportTarget } from './developExport';
import { getUnsupportedNativeDevelopFeatures } from './nativeDevelopPayload';

export interface ImageExportOptions {
  format: 'jpeg' | 'png' | 'tiff';
  outputProfile?: 'srgb' | 'display-p3';
  /** JPEG quality as a percentage. Ignored by PNG encoding. */
  quality: number;
  width: number;
  height: number;
}

export type ImageExportColorContract =
  | { colorSpace: 'srgb' | 'display-p3'; bitDepth: 16 | 8; backend: 'native'; metadata: 'icc-profile' }
  | { colorSpace: 'srgb'; bitDepth: 8; backend: 'canvas'; metadata: 'browser-managed' }
  | { colorSpace: 'srgb'; bitDepth: null; backend: 'unavailable'; metadata: 'unavailable' };

/** Describes a successful delivery without claiming Canvas output is RAW16. */
export function getImageExportColorContract(
  document: StudioDocument, format: ImageExportOptions['format'],
  profile:ImageExportOptions['outputProfile']='srgb',
): ImageExportColorContract {
  const target = document.kind === 'develop' ? resolveDevelopExportTarget(document) : null;
  if (target?.kind === 'unavailable') {
    return { colorSpace: 'srgb', bitDepth: null, backend: 'unavailable', metadata: 'unavailable' };
  }
  if (target?.kind === 'native') {
    return {colorSpace:profile,bitDepth:format==='jpeg'?8:16,backend:'native',metadata:'icc-profile'};
  }
  return { colorSpace: 'srgb', bitDepth: 8, backend: 'canvas', metadata: 'browser-managed' };
}

export interface ImageExportPorts {
  exportRaw(assetId: string, settings: DevelopSettings, options: ImageExportOptions, path: string): Promise<unknown>;
  renderDevelop(assetId: string, settings: DevelopSettings, options: {format: 'jpeg' | 'png'; quality: number; width: number; height: number}): Promise<Blob>;
  renderEdit(document: Extract<StudioDocument, {kind: 'edit'}>, options: {format: 'jpeg' | 'png'; quality: number; width: number; height: number}): Promise<Blob>;
  write(path: string, blob: Blob): Promise<void>;
}

/** The same export operation is available to UI controls and later AI tools. */
export class ImageExportService {
  constructor(private readonly ports: ImageExportPorts) {}

  async export(document: StudioDocument, path: string, options: ImageExportOptions): Promise<void> {
    if (!(/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/'))) throw new Error('请选择本地导出路径。');
    if (!['jpeg','png','tiff'].includes(options.format) || (options.outputProfile!==undefined && !['srgb','display-p3'].includes(options.outputProfile))) throw new Error('Unsupported export format or output profile.');
    const extension = options.format === 'jpeg' ? /\.(jpg|jpeg)$/i : options.format==='tiff' ? /\.(tif|tiff)$/i : /\.png$/i;
    if (!extension.test(path)) throw new Error('导出文件扩展名与所选格式不一致。');
    if (!Number.isInteger(options.width) || !Number.isInteger(options.height) || options.width < 1 || options.height < 1 ||
        options.width * options.height > 150_000_000) throw new Error('导出尺寸无效或超过 1.5 亿像素上限。');
    if (!Number.isFinite(options.quality) || options.quality < 1 || options.quality > 100) throw new Error('JPEG 品质需在 1–100 之间。');
    document = structuredClone(document);
    return serializeWrites([path.toLowerCase()], async () => {
    const renderOptions = { format: options.format, quality: options.quality / 100, width: options.width, height: options.height,
      ...(options.outputProfile?{outputProfile:options.outputProfile}:{}) };
    const nativeTarget=document.kind==='develop' && resolveDevelopExportTarget(document).kind==='native';
    if (!nativeTarget && (options.format==='tiff' || options.outputProfile==='display-p3')) throw new Error('TIFF / Display P3 requires native RAW pixels.');
    const canvasOptions={...renderOptions,format:options.format==='jpeg'?'jpeg' as const:'png' as const};
    if (document.kind === 'edit') {
      await this.writeValid(path, await this.ports.renderEdit(document, canvasOptions));
      return;
    }
    const target = resolveDevelopExportTarget(document);
    if (target.kind === 'unavailable') throw new Error(target.reason);
    if (target.kind === 'native') {
      const unsupported = getUnsupportedNativeDevelopFeatures(document.settings, document.isRaw);
      if (unsupported.length) throw new Error(`原始分辨率导出暂不支持这些调整：${unsupported.join('、')}。`);
      const result = await this.ports.exportRaw(target.assetId, document.settings, renderOptions, path);
      if (typeof result !== 'string' || result !== path) throw new Error('RAW export did not confirm a saved file.');
    } else {
      await this.writeValid(path, await this.ports.renderDevelop(target.assetId, document.settings, canvasOptions));
    }
    });
  }
  private async writeValid(path: string, blob: Blob): Promise<void> {
    if (!(blob instanceof Blob) || !blob.size) throw new Error("Export image is empty.");
    await this.ports.write(path, blob);
  }
}

export const defaultImageExportService = new ImageExportService({
  exportRaw: (assetId, settings, options, path) => getPlatformBridge().exportRawDevelop(assetId, settings, options, path),
  renderDevelop: (assetId, settings, options) => defaultImageEngine.exportDevelopImage(assetId, settings, options),
  renderEdit: (document, options) => defaultImageEngine.exportEditImage(document, options),
  write: (path, blob) => saveExportedImage(getPlatformBridge(), blob, path),
});
