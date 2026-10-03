// src/document/DevelopDocument.ts
import { DevelopDocument, DevelopSettings, PhotoExif, WhiteBalanceSettings, RawLoadingState } from '../types/develop';
import { createColorPipelineState } from '../types/colorPipeline';

export function createDefaultDevelopSettings(isRaw: boolean): DevelopSettings {
  // Rule 3: RAW default mode is 'as-shot'
  const whiteBalance: WhiteBalanceSettings = isRaw
    ? { mode: 'as-shot' }
    : { mode: 'custom', temperature: 5500, tint: 0 };

  return {
    version: 3,
    renderingVersion: 2,
    exposure: 0.0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    whiteBalance,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    vibrance: 0,
    saturation: 0,
    hsl: {
      red: { hue: 0, saturation: 0, luminance: 0 },
      orange: { hue: 0, saturation: 0, luminance: 0 },
      yellow: { hue: 0, saturation: 0, luminance: 0 },
      green: { hue: 0, saturation: 0, luminance: 0 },
      aqua: { hue: 0, saturation: 0, luminance: 0 },
      blue: { hue: 0, saturation: 0, luminance: 0 },
      purple: { hue: 0, saturation: 0, luminance: 0 },
      magenta: { hue: 0, saturation: 0, luminance: 0 },
    },
    curves: {
      rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    },
    detail: {
      sharpenAmount: 0,
      sharpenRadius: 1.0,
      sharpenThreshold: 0,
      lumaDenoise: 0,
      chromaDenoise: 0,
    },
    optics: {
      vignetteAmount: 0,
      vignetteMidpoint: 50,
    },
    masks: [],
  };
}

export function createDevelopDocument(params: {
  id?: string;
  sourceUri: string;
  fileName: string;
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  isRaw: boolean;
  rawProcessingVersion?: 1 | 2;
  rawCorrectionMode?: DevelopDocument['rawCorrectionMode'];
  rawEngineAttached?: boolean;
  rawState?: RawLoadingState;
  exif?: PhotoExif;
  settings?: Partial<DevelopSettings>;
  previewAssetId?: string;
  sourceAssetId?: string;
}): DevelopDocument {
  const isRaw = params.isRaw;
  const defaultSettings = createDefaultDevelopSettings(isRaw);
  const rawState = params.rawState ?? (isRaw ? 'unloaded' : 'ready');
  const hasDisplayAsset = Boolean(params.previewAssetId || params.sourceAssetId);

  return {
    id: params.id || `doc_dev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    kind: 'develop',
    rawProcessingVersion: isRaw ? (params.rawProcessingVersion ?? 2) : undefined,
    rawCorrectionMode: isRaw ? (params.rawCorrectionMode ?? 'camera') : undefined,
    sourceUri: params.sourceUri,
    sourceAssetId: params.sourceAssetId,
    fileName: params.fileName,
    fileSizeBytes: params.fileSizeBytes || 0,
    width: params.width || 4000,
    height: params.height || 3000,
    isRaw,
    // Rule 7: Native LibRaw engine connection status
    rawEngineAttached: params.rawEngineAttached ?? false,
    rawState,
    rawProgress: rawState === 'ready' ? 100 : 0,
    rawError: null,
    activeJobId: null,
    exif: params.exif || {},
    settings: {
      ...defaultSettings,
      ...(params.settings || {}),
      renderingVersion: params.settings ? (params.settings.renderingVersion ?? 1) : 2,
      whiteBalance: {
        ...defaultSettings.whiteBalance,
        ...(params.settings?.whiteBalance || {}),
      },
      detail: {
        ...defaultSettings.detail,
        ...(params.settings?.detail || {}),
      },
      optics: {
        ...defaultSettings.optics,
        ...(params.settings?.optics || {}),
      },
    },
    pipelineState: createColorPipelineState({
      isRaw,
      isEmbeddedPreview: isRaw && hasDisplayAsset && rawState !== 'ready',
      isDisplayEncoded: !isRaw || hasDisplayAsset,
    }),
    previewAssetId: params.previewAssetId,
    isDirty: false,
    updatedAt: Date.now(),
  };
}
