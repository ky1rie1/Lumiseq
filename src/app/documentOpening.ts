import { defaultAssetManager } from '../assets/AssetManager';
import { defaultDocumentManager } from '../document/DocumentManager';
import { createEditDocument, createImageLayer } from '../document/EditDocument';
import { createDevelopDocument } from '../document/DevelopDocument';
import { getPlatformBridge, type IPlatformBridge, type SelectedFile } from '../platform';
import { defaultProjectSerializer } from '../project/ProjectSerializer';
import { defaultDevelopProjectSerializer, isDevelopProjectManifest } from '../project/DevelopProjectSerializer';
import { routeFile } from '../router/FileRouter';
import { openLayeredPsd } from './PsdOperationService';
import type { IAssetManager } from '../types/asset';
import type { IDocumentManager, StudioDocument } from '../types/document';
import { isBinaryProject } from '../project/binaryProject';
import { bindFloatEditSourcesToDocuments, getFloatEditSources } from '../engine/FloatEditSources';

export interface DocumentOpeningDependencies {
  documents?: IDocumentManager;
  assets?: IAssetManager;
  platform?: IPlatformBridge;
  decodeImage?: (url: string) => Promise<{width: number; height: number}>;
}

export function decodeImageDimensions(url: string): Promise<{width: number; height: number}> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth, height = image.naturalHeight;
      image.onload = image.onerror = null;
      if (width > 0 && height > 0) resolve({width, height});
      else reject(new Error('图像没有有效的像素尺寸。'));
    };
    image.onerror = () => {
      image.onload = image.onerror = null;
      reject(new Error('无法解码图像。请检查文件是否完整，或转换为 PNG / JPEG 后重试。'));
    };
    image.src = url;
  });
}

/** Activate only after all fallible decoding and validation have succeeded. */
export async function openSelectedFile(selected: SelectedFile, dependencies: DocumentOpeningDependencies = {}): Promise<StudioDocument> {
  const documents = dependencies.documents ?? defaultDocumentManager;
  const assets = dependencies.assets ?? defaultAssetManager;
  bindFloatEditSourcesToDocuments(documents, assets);
  const route = routeFile(selected.name);
  let doc: StudioDocument;
  let registeredAsset: string | undefined;
  try {
    if (route.fileType === 'project') {
      if (route.extension === 'psd') doc = await openLayeredPsd(selected.blob, assets);
      else {
        const header = new Uint8Array(await selected.blob.slice(0, 4).arrayBuffer());
        if (isBinaryProject(header)) {
          doc = await defaultProjectSerializer.hydrateBinary(new Uint8Array(await selected.blob.arrayBuffer()), assets);
        } else {
        const json = await selected.blob.text();
        const manifest = JSON.parse(json) as unknown;
        doc = isDevelopProjectManifest(manifest)
          ? await defaultDevelopProjectSerializer.hydrate(json, assets, dependencies.platform ?? getPlatformBridge())
          : await defaultProjectSerializer.hydrate(json, assets);
        }
      }
      if (route.extension === 'psd' && doc.kind === 'edit' && doc.name === 'Photoshop 文档') doc.name = selected.name;
      // Reopening a snapshot must not overwrite an already open document with the same ID.
      if (documents.getDocument(doc.id)) {
        const id = crypto.randomUUID();
        doc = doc.kind === 'edit'
          ? {...doc, id, selection:doc.selection ? {...doc.selection,documentId:id} : null}
          : {...doc, id};
      }
    } else if (route.fileType === 'raw') {
      const platform = dependencies.platform ?? getPlatformBridge();
      if (!selected.path) throw new Error('RAW 文件需要在桌面端打开并提供有效文件路径。');
      const metadata = await platform.getRawMetadata(selected.path);
      if (!metadata || !metadata.width || !metadata.height) throw new Error('无法读取 RAW 文件的元数据。请检查文件是否受支持。');
      doc = createDevelopDocument({sourceUri:selected.path,fileName:selected.name,fileSizeBytes:selected.sizeBytes,
        width:metadata.width,height:metadata.height,isRaw:true,
        exif:{cameraMake:metadata.camera_make,cameraModel:metadata.camera_model,lensModel:metadata.lens_model,
          iso:metadata.iso,shutterSpeed:metadata.shutter_speed,aperture:metadata.aperture,focalLength:metadata.focal_length,dateTime:metadata.capture_time}});
      const original = await assets.registerBlob(selected.blob, 'image', selected.name, { width: metadata.width, height: metadata.height });
      registeredAsset = original.id;
      doc.originalRawAssetId = original.id;
    } else if (route.fileType === 'raster') {
      const asset = await assets.registerBlob(selected.blob,'image',selected.name);
      registeredAsset = asset.id;
      const platform = dependencies.platform ?? getPlatformBridge();
      const useNative = !!platform.decodeEditSource && (!!dependencies.platform || !dependencies.decodeImage);
      const decoded = useNative ? await platform.decodeEditSource!(new Uint8Array(await selected.blob.arrayBuffer())) : null;
      let dimensions: { width: number; height: number };
      if (decoded) {
        getFloatEditSources(assets).adopt(asset.id, decoded, platform);
        dimensions = decoded;
      } else {
        const url = assets.getDisplayUrl(asset.id);
        if (!url) throw new Error('无法读取图像资源。');
        dimensions = await (dependencies.decodeImage ?? decodeImageDimensions)(url);
      }
      if (![dimensions.width,dimensions.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('图像尺寸无效。');
      asset.width = dimensions.width; asset.height = dimensions.height;
      const layer = createImageLayer({name:'背景',sourceAssetId:asset.id,naturalWidth:dimensions.width,naturalHeight:dimensions.height});
      doc = createEditDocument({name:selected.name,...dimensions,layers:[layer], ...(decoded ? { renderingVersion: 2 } : {})});
    } else {
      throw new Error(`不支持的文件格式：${route.extension || selected.name}`);
    }
    documents.openDocument(doc,true);
    return doc;
  } catch (error) {
    if (registeredAsset) { getFloatEditSources(assets).release(registeredAsset); assets.releaseAsset(registeredAsset); }
    throw error;
  }
}
