// src/types/edit.ts
//! Professional Editing Core — Layer & Document Type Definitions (Phase 6)

import { DevelopSettings } from './develop';
import type { AgentRun } from '../ai/types';
import { SelectionMask, SelectionViewMode, Rect } from '../selection/types';

export type LayerType =
  | 'image'
  | 'text'
  | 'paint'
  | 'retouch'
  | 'adjustment'
  | 'smart-object'
  | 'group'
  | 'shape'
  | 'develop-smart-object'
  | 'generated-patch';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface LayerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  scaleX: number;
  scaleY: number;
}

export interface LayerMask {
  id: string;
  assetId: string; // Asset reference managed by AssetManager, NEVER Base64
  enabled: boolean;
  linked: boolean;
  density: number; // 0.0 to 1.0
  feather: number; // radius in pixels
  inverted?: boolean;
  /** Original document-space transform/dimensions for linked cutout masks. */
  referenceTransform?: [number, number, number, number, number, number];
  referenceWidth?: number;
  referenceHeight?: number;
}

export interface BaseLayer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  opacity: number; // 0.0 - 1.0
  fillOpacity?: number; // 0.0 - 1.0
  blendMode: BlendMode;
  transform: LayerTransform;
  mask?: LayerMask;
  locked?: boolean;
  clipToBelow?: boolean; // Layer clipping mask foundation
}

/** Standard raster image layer */
export interface ImageLayer extends BaseLayer {
  type: 'image';
  sourceAssetId: string; // AssetId pointing to AssetManager (Rule 5)
  naturalWidth: number;
  naturalHeight: number;
}

/** Vector text layer with typography controls */
export interface TextStroke { enabled: boolean; color: string; width: number; }
export interface TextShadow { enabled: boolean; color: string; opacity: number; blur: number; offsetX: number; offsetY: number; }
export interface TextEffects { stroke?: TextStroke; shadow?: TextShadow; }
export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight?: string;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number;
  color: string;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
  stroke?: TextStroke;
  shadow?: TextShadow;
}

/** Dedicated Paint Layer for non-destructive brush work */
export interface PaintLayer extends BaseLayer {
  type: 'paint';
  rasterAssetId: string;
  naturalWidth: number;
  naturalHeight: number;
}

/** Non-destructive Retouch Layer for Clone Stamp and Healing operations */
export interface RetouchLayer extends BaseLayer {
  type: 'retouch';
  rasterAssetId: string;
  naturalWidth: number;
  naturalHeight: number;
  retouchType: 'clone' | 'healing' | 'spot';
}

/** Adjustment Layer Types and Parametric Settings */
export type AdjustmentType =
  | 'exposure'
  | 'brightness_contrast'
  | 'hue_saturation'
  | 'color_balance'
  | 'black_and_white'
  | 'levels'
  | 'curves';

export interface ExposureAdjustmentSettings {
  exposure: number; // EV: -5.0 to +5.0
  offset?: number;
  gamma?: number;
}

export interface BrightnessContrastSettings {
  brightness: number; // -100 to +100
  contrast: number; // -100 to +100
}

export interface HueSaturationSettings {
  hue: number; // -180 to +180
  saturation: number; // -100 to +100
  lightness: number; // -100 to +100
}

export interface ColorBalanceSettings {
  shadows: { cyanRed: number; magentaGreen: number; yellowBlue: number };
  midtones: { cyanRed: number; magentaGreen: number; yellowBlue: number };
  highlights: { cyanRed: number; magentaGreen: number; yellowBlue: number };
  preserveLuminosity: boolean;
}

export interface BlackAndWhiteSettings {
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
}

export interface LevelsSettings {
  inputBlack: number; // 0 - 255
  inputGamma: number; // 0.1 - 10.0 (default 1.0)
  inputWhite: number; // 0 - 255
  outputBlack: number; // 0 - 255
  outputWhite: number; // 0 - 255
}

export interface CurvePoint {
  x: number; // 0 - 255
  y: number; // 0 - 255
}

export interface CurvesSettings {
  rgb: CurvePoint[];
  red?: CurvePoint[];
  green?: CurvePoint[];
  blue?: CurvePoint[];
}

export type AdjustmentSettings =
  | { type: 'exposure'; values: ExposureAdjustmentSettings }
  | { type: 'brightness_contrast'; values: BrightnessContrastSettings }
  | { type: 'hue_saturation'; values: HueSaturationSettings }
  | { type: 'color_balance'; values: ColorBalanceSettings }
  | { type: 'black_and_white'; values: BlackAndWhiteSettings }
  | { type: 'levels'; values: LevelsSettings }
  | { type: 'curves'; values: CurvesSettings };

export interface AdjustmentLayer extends BaseLayer {
  type: 'adjustment';
  adjustmentType: AdjustmentType;
  settings: AdjustmentSettings;
}

export type SmartFilterType = 'gaussian_blur' | 'unsharp_mask' | 'noise_reduction';

export type SmartFilterSettings =
  | { radius: number }
  | { radius: number; amount: number; threshold: number }
  | { radius: number; strength: number; preserveEdges: number };

/** Ordered, editable filter record evaluated only against its owning Smart Object. */
export interface SmartFilter {
  id: string;
  type: SmartFilterType;
  name: string;
  enabled: boolean;
  opacity: number;
  settings: SmartFilterSettings;
}

/** Smart Object Layer maintaining source buffer / develop settings */
export interface SmartObjectLayer extends BaseLayer {
  type: 'smart-object';
  sourceAssetId: string;
  originalWidth: number;
  originalHeight: number;
  embeddedAssetId?: string;
  sourceRawUri?: string;
  developSettings?: DevelopSettings;
  cachedRenderAssetId?: string;
  smartFilters?: SmartFilter[];
}

/** Group Layer for hierarchical layer organization */
export interface GroupLayer extends BaseLayer {
  type: 'group';
  children: Layer[];
  collapsed: boolean;
}

/** Non-destructive AI generated inpainting / remove patch layer */
export interface GeneratedPatchLayer extends BaseLayer {
  type: 'generated-patch';
  sourceAssetId: string; // The inpaint result RGBA image
  maskAssetId: string;   // The selection mask used
  bounds: Rect;
  generationMetadata: {
    provider: string;
    model: string;
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    sourceDocumentId: string;
    sourceLayerId?: string;
    selectionId?: string;
    maskId?: string;
    timestamp: number;
  };
}

/** Legacy Develop Smart Object compatibility */
export interface DevelopSmartObjectLayer extends BaseLayer {
  type: 'develop-smart-object';
  sourceRawUri: string;
  developSettings: DevelopSettings;
  sourceAssetId?: string;
  rawProcessingVersion?: 1 | 2;
  rawCorrectionMode?: import('./develop').RawCorrectionMode;
  cachedRenderAssetId?: string;
}

export type Layer =
  | ImageLayer
  | TextLayer
  | PaintLayer
  | RetouchLayer
  | AdjustmentLayer
  | SmartObjectLayer
  | GroupLayer
  | GeneratedPatchLayer
  | DevelopSmartObjectLayer;

export interface SelectionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GuideLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number; // in canvas pixels
}

export type Guide = GuideLine;
export type { Rect } from '../selection/types';

export interface EditDocument {
  id: string;
  kind: 'edit';
  name: string;
  width: number;
  height: number;
  dpi: number;
  renderingVersion?: 1 | 2;
  bitDepth?: 32;
  workingProfile?: 'linear-srgb';
  layers: Layer[]; // Layer order: index 0 is bottom-most
  selectedLayerId: string | null;
  selection: SelectionMask | null;
  maskViewMode?: SelectionViewMode;
  backgroundColor: string;
  cropRect?: Rect | null;
  guides?: GuideLine[];
  rulersVisible?: boolean;
  editingTarget?: 'layer' | 'mask';
  aiHistory?: { usedAI: boolean; runs: AgentRun[] };
  isDirty: boolean;
  updatedAt: number;
}
