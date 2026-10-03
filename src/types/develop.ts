// src/types/develop.ts
import { ColorChannel, Point2D } from './common';
import { ImageColorPipelineState } from './colorPipeline';
import type { AgentRun } from '../ai/types';

export type WhiteBalanceMode = 'as-shot' | 'auto' | 'custom';
export type RawCorrectionMode = 'camera' | 'uncorrected';

/** Correction of camera-balanced linear sRGB; this is not a sensor illuminant estimate. */
export interface ResolvedAutoWhiteBalance {
  version: 1;
  algorithm: 'neutral-candidate-v1';
  matrix: number[]; // row-major 3x3, identical in WebGL and native export
  confidence: number; // heuristic support score, not a calibrated probability
  sampleCount: number;
  candidateCount: number;
  status: 'resolved' | 'as-shot-fallback';
}

export type RawLoadingState =
  | 'unloaded'
  | 'metadata'
  | 'embedded-preview'
  | 'decoding'
  | 'ready'
  | 'error';

export interface WhiteBalanceSettings {
  mode: WhiteBalanceMode;
  temperature?: number; // Kelvin (2000K - 12000K), used when mode is 'custom' or resolved
  tint?: number;        // -150 to +150 (Green to Magenta), used when mode is 'custom' or resolved
  cameraMultipliers?: [number, number, number, number]; // Camera As-Shot sensor multipliers
  resolvedAuto?: ResolvedAutoWhiteBalance;
}

export interface ChannelHSL {
  hue: number;        // -100 to +100
  saturation: number; // -100 to +100
  luminance: number;  // -100 to +100
}

export interface ToneCurves {
  rgb: Point2D[];
  red: Point2D[];
  green: Point2D[];
  blue: Point2D[];
}

export interface DetailSettings {
  sharpenAmount: number;     // 0 to 150 (default 0)
  sharpenRadius: number;     // 0.5 to 3.0 (default 1.0)
  sharpenThreshold: number;  // 0 to 25 (default 0)
  lumaDenoise: number;       // 0 to 100 (default 0)
  chromaDenoise: number;     // 0 to 100 (default 0)
}

export interface OpticsSettings {
  vignetteAmount: number;    // -100 to +100 (default 0)
  vignetteMidpoint: number;  // 0 to 100 (default 50)
}

export interface DevelopMask {
  id: string;
  name: string;
  maskAssetId: string; // AssetId pointing to mask bitmap, NEVER DataURL (Rule 5)
  kind: 'linear' | 'radial' | 'brush';
  /** Geometry uses normalized image coordinates, independent of preview resolution. */
  geometry: {
    start?: Point2D;
    end?: Point2D;
    center?: Point2D;
    radiusX?: number;
    radiusY?: number;
    feather?: number;
  };
  strokes?: Array<{ points: Point2D[]; radius: number; feather: number }>;
  inverted: boolean;
  opacity: number;     // 0 to 1
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  temperature?: number;
  saturation?: number;
}

export interface DevelopSettings {
  /** Rendering math; omitted means legacy 1, independent of RAW decoding. */
  renderingVersion?: 1 | 2;
  version?: number;       // Schema version (v3)

  // Basic Toning
  exposure: number;       // EV: -5.0 to +5.0 (default 0.0)
  contrast: number;       // -100 to +100 (default 0)
  highlights: number;     // -100 to +100 (default 0)
  shadows: number;        // -100 to +100 (default 0)
  whites: number;         // -100 to +100 (default 0)
  blacks: number;         // -100 to +100 (default 0)

  // White Balance (Rule 3)
  whiteBalance: WhiteBalanceSettings;

  // Presence
  texture: number;        // -100 to +100 (default 0)
  clarity: number;        // -100 to +100 (default 0)
  dehaze: number;         // -100 to +100 (default 0)

  // Color
  vibrance: number;       // -100 to +100 (default 0)
  saturation: number;     // -100 to +100 (default 0)

  // HSL Color Channels
  hsl: Record<ColorChannel, ChannelHSL>;

  // Tone Curves
  curves: ToneCurves;

  // Detail & Optics
  detail: DetailSettings;
  optics: OpticsSettings;

  // Local masks
  masks: DevelopMask[];
}

export interface PhotoExif {
  opticalCorrection?:import('../platform/IPlatformBridge').NativeRawMetadata['optical_correction'];
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  focalLength?: string;
  aperture?: string;
  shutterSpeed?: string;
  iso?: number;
  dateTime?: string;
  orientation?: number; // EXIF Orientation 1-8
  cfaPattern?: string;
  colorMatrix?: number[][];
  blackLevels?: number[];
  whiteLevels?: number[];
  gpsLatitude?: number;
  gpsLongitude?: number;
}

export interface DevelopDocument {
  /** Decoder/geometry contract; absent in older RAW projects means legacy v1. */
  rawProcessingVersion?: 1 | 2;
  rawCorrectionMode?: RawCorrectionMode;
  id: string;
  kind: 'develop';
  sourceUri: string;
  sourceAssetId?: string; // Reference to Asset in AssetManager
  /**
   * 原生 LibRaw 解码资源 id（Rust 侧 registry），仅当前会话有效。
   * 前端 AssetManager 的 id 与它属于两个不同的 id空间：全分辨率导出必须用这一个。
   */
  nativeAssetId?: string | null;
  fileName: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  isRaw: boolean;
  /** True when native LibRaw/Tauri backend is active */
  rawEngineAttached: boolean;
  rawState: RawLoadingState;
  rawProgress: number; // 0 - 100
  rawError?: string | null;
  activeJobId?: string | null;
  exif: PhotoExif;
  settings: DevelopSettings;
  settingsSnapshots?: DevelopSettingsSnapshot[];
  aiHistory?: { usedAI: boolean; runs: AgentRun[] };
  pipelineState?: ImageColorPipelineState;
  previewAssetId?: string; // Reference to Asset in AssetManager
  isDirty: boolean;
  updatedAt: number;
}

export interface DevelopPreset { id: string; name: string; settings: Partial<DevelopSettings>; }
export interface DevelopSettingsSnapshot { id: string; name: string; createdAt: number; settings: DevelopSettings; }
