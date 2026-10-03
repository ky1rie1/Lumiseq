// src/stores/useDevelopStore.ts
import { create } from 'zustand';
import { DevelopDocument, DevelopSettings, ToneCurves, WhiteBalanceSettings, RawLoadingState } from '../types/develop';
import { HistogramData } from '../types/engine';
import { defaultDocumentManager, type DevelopRuntimePatch } from '../document/DocumentManager';
import { defaultAssetManager } from '../assets/AssetManager';
import { defaultImageEngine } from '../engine/WebGLImageEngine';
import { getPlatformBridge } from '../platform';
import { createEditDocument, createImageLayer } from '../document/EditDocument';
import { createColorPipelineState } from '../types/colorPipeline';

import { defaultDevelopOperations, parameterForPath } from '../develop/DevelopOperationService';
import { defaultRawSmartObjects } from '../smartobject/RawSmartObjectService';

interface DevelopState {
  currentDoc: DevelopDocument | null;
  settings: DevelopSettings | null;
  histogramData: HistogramData | null;
  rawState: RawLoadingState;
  rawProgress: number;
  rawError: string | null;
  whiteBalanceBusy: boolean;
  whiteBalanceError: string | null;

  // Actions that dispatch commands through CommandBus (Rule 1 & 9)
  updateSetting: (docId: string, path: string, value: any, description?: string) => void;
  startSettingDrag: (docId: string, actionName: string) => void;
  previewSettingDrag: (docId: string, path: string, value: any) => void;
  commitSettingDrag: () => void;
  resetSection: (docId: string, sectionId: string) => void;

  setExposure: (docId: string, val: number) => void;
  startExposureDrag: (docId: string) => void;
  previewExposureDrag: (docId: string, val: number) => void;
  commitExposureDrag: () => void;

  setContrast: (docId: string, val: number) => void;
  startContrastDrag: (docId: string) => void;
  previewContrastDrag: (docId: string, val: number) => void;
  commitContrastDrag: () => void;

  setTemperature: (docId: string, temp: number) => void;
  startTemperatureDrag: (docId: string) => void;
  previewTemperatureDrag: (docId: string, temp: number) => void;
  commitTemperatureDrag: () => void;

  setTint: (docId: string, tint: number) => void;
  startTintDrag: (docId: string) => void;
  previewTintDrag: (docId: string, tint: number) => void;
  commitTintDrag: () => void;

  setSaturation: (docId: string, sat: number) => void;
  startSaturationDrag: (docId: string) => void;
  previewSaturationDrag: (docId: string, sat: number) => void;
  commitSaturationDrag: () => void;

  setWhiteBalance: (docId: string, wb: WhiteBalanceSettings) => Promise<void>;
  resetSettings: (docId: string) => void;
  setHistogramData: (data: HistogramData | null) => void;
  loadDocument: (doc: DevelopDocument) => void;

  // Metadata followed by the immutable working RAW source.
  startRawLoadingPipeline: (docId: string) => Promise<void>;

  // Phase 2.5: Develop -> Edit Rendered Transfer
  transferToEditWorkspace: (docId: string) => Promise<string>;
}

let whiteBalanceRequestId = 0;
let whiteBalanceRequestDocumentId: string | null = null;

function resetWhiteBalanceRequestStatus(): void {
  whiteBalanceRequestId++;
  whiteBalanceRequestDocumentId = null;
  useDevelopStore.setState({ whiteBalanceBusy: false, whiteBalanceError: null });
}

export const useDevelopStore = create<DevelopState>((set, get) => ({
  currentDoc: null,
  settings: null,
  histogramData: null,
  rawState: 'unloaded',
  rawProgress: 0,
  rawError: null,
  whiteBalanceBusy: false,
  whiteBalanceError: null,

  updateSetting: (docId, path, value, description) => {
    const parameter = parameterForPath(path);
    if (parameter) {
      defaultDevelopOperations.setParameter({ documentId: docId, ...parameter, value, source: 'manual', description });
      return;
    }
    if (path === 'curves') {
      defaultDevelopOperations.setCurves(docId, value as ToneCurves, 'manual');
      return;
    }
    throw new Error(`Unsupported develop setting: ${path}`);
  },

  startSettingDrag: (docId, actionName) => {
    defaultDevelopOperations.beginNamedChange(docId, actionName);
  },

  previewSettingDrag: (docId, path, value) => {
    const parameter = parameterForPath(path);
    if (parameter) {
      defaultDevelopOperations.previewParameterChange(docId, parameter.parameterId, value, parameter.channel);
      return;
    }
    throw new Error(`Unsupported develop preview setting: ${path}`);
  },

  commitSettingDrag: () => {
    defaultDevelopOperations.commitParameterChange();
  },

  resetSection: (docId, sectionId) => {
    defaultDevelopOperations.resetSection(docId, sectionId, 'manual');
  },

  setExposure: (docId, val) => {
    defaultDevelopOperations.setParameter({ documentId: docId, parameterId: 'exposure', value: val, source: 'manual' });
  },

  startExposureDrag: (docId) => {
    defaultDevelopOperations.beginParameterChange(docId, 'exposure');
  },

  previewExposureDrag: (docId, val) => {
    defaultDevelopOperations.previewParameterChange(docId, 'exposure', val);
  },

  commitExposureDrag: () => {
    defaultDevelopOperations.commitParameterChange();
  },

  setContrast: (docId, val) => {
    defaultDevelopOperations.setParameter({ documentId: docId, parameterId: 'contrast', value: val, source: 'manual' });
  },

  startContrastDrag: (docId) => {
    defaultDevelopOperations.beginParameterChange(docId, 'contrast');
  },

  previewContrastDrag: (docId, val) => {
    defaultDevelopOperations.previewParameterChange(docId, 'contrast', val);
  },

  commitContrastDrag: () => {
    defaultDevelopOperations.commitParameterChange();
  },

  setTemperature: (docId, temp) => {
    defaultDevelopOperations.setParameter({ documentId: docId, parameterId: 'temperature', value: temp, source: 'manual' });
  },

  startTemperatureDrag: (docId) => {
    defaultDevelopOperations.beginParameterChange(docId, 'temperature');
  },

  previewTemperatureDrag: (docId, temp) => {
    defaultDevelopOperations.previewParameterChange(docId, 'temperature', temp);
  },

  commitTemperatureDrag: () => {
    defaultDevelopOperations.commitParameterChange();
  },

  setTint: (docId, tint) => {
    defaultDevelopOperations.setParameter({ documentId: docId, parameterId: 'tint', value: tint, source: 'manual' });
  },

  startTintDrag: (docId) => {
    defaultDevelopOperations.beginParameterChange(docId, 'tint');
  },

  previewTintDrag: (docId, tint) => {
    defaultDevelopOperations.previewParameterChange(docId, 'tint', tint);
  },

  commitTintDrag: () => {
    defaultDevelopOperations.commitParameterChange();
  },

  setSaturation: (docId, sat) => {
    defaultDevelopOperations.setParameter({ documentId: docId, parameterId: 'saturation', value: sat, source: 'manual' });
  },

  startSaturationDrag: (docId) => {
    defaultDevelopOperations.beginParameterChange(docId, 'saturation');
  },

  previewSaturationDrag: (docId, sat) => {
    defaultDevelopOperations.previewParameterChange(docId, 'saturation', sat);
  },

  commitSaturationDrag: () => {
    defaultDevelopOperations.commitParameterChange();
  },

  setWhiteBalance: async (docId, wb) => {
    const requestId = ++whiteBalanceRequestId;
    whiteBalanceRequestDocumentId = docId;
    const ownsStatus = () => whiteBalanceRequestId === requestId &&
      whiteBalanceRequestDocumentId === docId && get().currentDoc?.id === docId &&
      defaultDocumentManager.getActiveDocument()?.id === docId;
    set({ whiteBalanceBusy: wb.mode === 'auto', whiteBalanceError: null });
    try {
      if (wb.mode === 'auto') await defaultDevelopOperations.resolveAutoWhiteBalance(docId, 'manual');
      else defaultDevelopOperations.setWhiteBalance(docId, wb, 'manual');
    } catch (error) {
      if (ownsStatus()) {
        set({ whiteBalanceError: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (ownsStatus()) set({ whiteBalanceBusy: false });
    }
  },

  resetSettings: (docId) => {
    defaultDevelopOperations.resetAll(docId, 'manual');
  },

  setHistogramData: (data) => set({ histogramData: data }),

  loadDocument: (doc) => {
    if (get().currentDoc?.id !== doc.id) resetWhiteBalanceRequestStatus();
    set({
      currentDoc: doc,
      settings: doc.settings,
      rawState: doc.rawState,
      rawProgress: doc.rawProgress,
      rawError: doc.rawError || null,
    });
  },

  startRawLoadingPipeline: async (docId: string) => {
    const doc = defaultDocumentManager.getDevelopDocument(docId);
    if (!doc || !doc.isRaw) return;
    const bridge = getPlatformBridge();
    const sourceUri = doc.sourceUri;
    const originalRawAssetId = doc.originalRawAssetId;
    const jobId = `raw_job_${crypto.randomUUID()}`;
    const browserAssets = new Set<string>();
    const publishedBrowserAssets = new Set<string>();
    let ownedNativeId: string | null = null;
    let ownsReady = false;
    let decodePending = false;
    let invalidated = false;
    let stagedSourceUri: string | undefined;
    const isCurrent = () => {
      const current = defaultDocumentManager.getDevelopDocument(docId);
      return !invalidated && current?.activeJobId === jobId && current.sourceUri === sourceUri &&
        current.originalRawAssetId === originalRawAssetId;
    };
    const publish = (patch: DevelopRuntimePatch, summary: string) => isCurrent() &&
      defaultDocumentManager.updateDevelopRuntime(docId, patch, summary, jobId);
    const cancel = () => {
      invalidated = true;
      if (decodePending) void bridge.cancelRawDecode(jobId).catch(error => console.warn('Could not cancel stale RAW decode:', error));
    };
    const unsubscribe = defaultDocumentManager.subscribe(event => {
      if (event.type === 'closed' && event.documentId === docId) cancel();
      else if (event.type === 'updated' && event.document.id === docId && event.document.kind === 'develop' &&
        (event.document.sourceUri !== sourceUri || event.document.originalRawAssetId !== originalRawAssetId ||
          (event.document.activeJobId !== jobId && event.document.activeJobId !== null))) cancel();
    });
    defaultDocumentManager.updateDevelopRuntime(docId, {
      activeJobId: jobId, rawState: 'metadata', rawProgress: 20, rawError: null,
    }, 'Read RAW Metadata');
    try {
      let decodePath = sourceUri;
      if (originalRawAssetId) {
        const original = await defaultAssetManager.getBlob(originalRawAssetId);
        if (!isCurrent()) return;
        if (!original?.size) throw new Error('Captured RAW original is missing.');
        if (!bridge.stageRawSource) throw new Error('Captured RAW original requires native staging.');
        stagedSourceUri = await bridge.stageRawSource(doc.fileName, original);
        if (!isCurrent()) return;
        decodePath = stagedSourceUri;
      }
      // Every awaited stage must still own this open document before publishing.
      const meta = await bridge.getRawMetadata(decodePath);
      if (!isCurrent()) return;
      if (meta) {
        publish({ width: meta.width, height: meta.height, exif: {
          cameraMake: meta.camera_make,
          cameraModel: meta.camera_model,
          lensModel: meta.lens_model,
          iso: meta.iso,
          shutterSpeed: meta.shutter_speed,
          aperture: meta.aperture,
          focalLength: meta.focal_length,
          dateTime: meta.capture_time,
          orientation: meta.orientation,
          cfaPattern: meta.cfa_pattern,
          colorMatrix: meta.color_matrix,
          blackLevels: Array.from(meta.black_levels),
          whiteLevels: Array.from(meta.white_levels),
          gpsLatitude: meta.gps_latitude,
          gpsLongitude: meta.gps_longitude,
        }, cameraMultipliers: meta.white_balance_multipliers
          ? [...meta.white_balance_multipliers] as [number, number, number, number]
          : undefined }, 'Update RAW Metadata');
      }
      // Camera JPEG tone is unrelated to the editable source; publish only working RAW.
      if (!publish({ nativeAssetId: null, rawState: 'decoding', rawProgress: 70 }, 'Decoding RAW Sensor Data')) return;
      if (!isCurrent()) return;
      decodePending = true;
      let decodeResult;
      const processingVersion=doc.rawProcessingVersion ?? 1;
      try { decodeResult = await bridge.decodeRawImage(jobId, decodePath,processingVersion===2?'High':'Balanced',processingVersion,doc.rawCorrectionMode ?? 'camera'); }
      finally { decodePending = false; }
      ownedNativeId = decodeResult?.asset_id ?? null;
      if (!isCurrent()) return;
      if (decodeResult) {
        const runtime: DevelopRuntimePatch = { nativeAssetId: decodeResult.asset_id,
          exif:{...defaultDocumentManager.getDevelopDocument(docId)?.exif,opticalCorrection:decodeResult.metadata?.optical_correction},
          width: decodeResult.width, height: decodeResult.height, rawState: 'ready',
          rawProgress: 100, rawEngineAttached: true, activeJobId: null };
        if (decodeResult.preview_png_bytes && decodeResult.preview_png_bytes.length > 0) {
          const previewBlob = new Blob([new Uint8Array(decodeResult.preview_png_bytes)], { type: 'image/png' });
          const handle = await defaultAssetManager.registerBlob(previewBlob, 'image', `${doc.fileName}_decoded.png`);
          browserAssets.add(handle.id);
          if (!isCurrent()) return;
          await defaultImageEngine.loadAsset(handle.id, previewBlob);
          if (!isCurrent()) return;
          if (bridge.getRawLinearPreview) {
            const linear = await bridge.getRawLinearPreview(decodeResult.asset_id);
            if (!isCurrent()) return;
            defaultImageEngine.setRawLinearSource(handle.id, linear);
          }
          runtime.sourceAssetId = handle.id;
          runtime.previewAssetId = handle.id;
          // Display PNG is retained for raster consumers; Develop uses attached native linear pixels.
          runtime.pipelineState = createColorPipelineState({ isRaw: true,
            isWorkingLinear:!!bridge.getRawLinearPreview,isDisplayEncoded:!bridge.getRawLinearPreview });
        }
        if (isCurrent()) {
          // The document owner must take over before listeners can synchronously close it.
          ownsReady = true;
          if (publish(runtime, 'RAW Decode Complete')) {
            if (runtime.sourceAssetId) publishedBrowserAssets.add(runtime.sourceAssetId);
          } else ownsReady = false;
        }
      } else throw new Error('RAW decoder did not return an image.');
    } catch (err: unknown) {
      publish({ rawState: 'error', rawError: err instanceof Error ? err.message : String(err), activeJobId: null }, 'RAW Decode Error');
    } finally {
      unsubscribe();
      // Decode is awaited before cleanup, so cancellation never removes an in-use source file.
      if (stagedSourceUri) await bridge.deleteFile(stagedSourceUri).catch(error => console.warn('Could not remove staged RAW source:', error));
      const current = defaultDocumentManager.getDevelopDocument(docId);
      for (const id of browserAssets) {
        // Published previews may still belong to an undo snapshot even after replacement.
        if (current && publishedBrowserAssets.has(id)) continue;
        if (current?.sourceAssetId === id || current?.previewAssetId === id) continue;
        defaultImageEngine.releaseAsset(id);
        defaultAssetManager.releaseAsset(id);
      }
      if (ownedNativeId && !ownsReady && current?.nativeAssetId !== ownedNativeId) {
        await bridge.releaseRawAsset(ownedNativeId).catch(error => console.warn('Could not release stale RAW asset:', error));
      }
    }
  },

  transferToEditWorkspace: async (docId: string): Promise<string> => {
    const doc = defaultDocumentManager.getDevelopDocument(docId);
    if (!doc) throw new Error(`Develop document ${docId} not found`);

    if (doc.isRaw) {
      if (!getPlatformBridge().stageRawSource) throw new Error('原始分辨率 RAW 智能对象需要桌面原生后端。');
      return (await defaultRawSmartObjects.transfer(docId)).id;
    }

    const assetId = doc.sourceAssetId || doc.previewAssetId;
    if (!assetId) throw new Error('No asset available to transfer');

    const renderedBlob = await defaultImageEngine.exportDevelopImage(assetId, doc.settings, { format: 'png' });
    if (!renderedBlob.size) throw new Error('转入图像编辑失败：渲染结果为空。');

    // Probe the actual output dimensions before creating the image-edit document.
    const handle = await defaultAssetManager.registerBlob(
      renderedBlob,
      'image',
      `${doc.fileName.replace(/\.[^/.]+$/, '')}_developed.png`
    );
    const renderedWidth = handle.width ?? doc.width;
    const renderedHeight = handle.height ?? doc.height;
    await defaultImageEngine.loadAsset(handle.id, renderedBlob);

    // 3. Create ImageLayer with Section 21 metadata
    const layer = createImageLayer({
      name: `${doc.fileName} (Developed)`,
      sourceAssetId: handle.id,
      naturalWidth: renderedWidth,
      naturalHeight: renderedHeight,
      x: 0,
      y: 0,
    });
    (layer as any).sourceType = 'develop-render';
    (layer as any).sourceDevelopDocumentId = docId;

    // 4. Create EditDocument and open in DocumentManager
    const editDoc = createEditDocument({
      name: `${doc.fileName.replace(/\.[^/.]+$/, '')}_Composite`,
      width: renderedWidth,
      height: renderedHeight,
      layers: [layer],
    });

    defaultDocumentManager.openDocument(editDoc);
    return editDoc.id;
  },
}));

const nativeReferences = new Map<string, string>();
for (const doc of defaultDocumentManager.getOpenDocuments()) {
  if (doc.kind === 'develop' && doc.nativeAssetId) nativeReferences.set(doc.id, doc.nativeAssetId);
}
defaultDocumentManager.subscribe(event => {
  if (event.type !== 'opened' && event.type !== 'updated' && event.type !== 'closed') return;
  const id = event.type === 'closed' ? event.documentId : event.document.id;
  const previous = nativeReferences.get(id);
  const next = event.type !== 'closed' && event.document.kind === 'develop' ? event.document.nativeAssetId : null;
  if (next) nativeReferences.set(id, next); else nativeReferences.delete(id);
  if (previous && previous !== next && ![...nativeReferences.values()].includes(previous)) {
    void getPlatformBridge().releaseRawAsset?.(previous).catch(error => console.warn('Could not release closed RAW source:', error));
  }
});

// State Adapter: Subscribe to DocumentManager changes
defaultDocumentManager.subscribe((event) => {
  if (event.type === 'opened' || event.type === 'updated') {
    if (event.document.kind === 'develop') {
      const activeDoc = defaultDocumentManager.getActiveDocument();
      if (activeDoc?.id === event.document.id) {
        if (useDevelopStore.getState().currentDoc?.id !== event.document.id) resetWhiteBalanceRequestStatus();
        useDevelopStore.setState({
          currentDoc: event.document as DevelopDocument,
          settings: (event.document as DevelopDocument).settings,
          rawState: (event.document as DevelopDocument).rawState,
          rawProgress: (event.document as DevelopDocument).rawProgress,
          rawError: (event.document as DevelopDocument).rawError || null,
        });
      }
    }
  } else if (event.type === 'activated') {
    const activeDoc = defaultDocumentManager.getActiveDocument();
    if (useDevelopStore.getState().currentDoc?.id !== activeDoc?.id) resetWhiteBalanceRequestStatus();
    if (activeDoc && activeDoc.kind === 'develop') {
      useDevelopStore.setState({
        currentDoc: activeDoc as DevelopDocument,
        settings: (activeDoc as DevelopDocument).settings,
        rawState: (activeDoc as DevelopDocument).rawState,
        rawProgress: (activeDoc as DevelopDocument).rawProgress,
        rawError: (activeDoc as DevelopDocument).rawError || null,
      });
    } else {
      useDevelopStore.setState({
        currentDoc: null,
        settings: null,
        rawState: 'unloaded',
        rawProgress: 0,
        rawError: null,
      });
    }
  }
});
