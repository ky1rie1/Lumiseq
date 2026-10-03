// src/types/engine.ts
import { DevelopSettings } from './develop';
import { EditDocument } from './edit';

export interface HistogramChannel {
  bins: number[]; // 256 values
  max: number;
}

export interface HistogramData {
  r: number[];   // 256 bins
  g: number[];   // 256 bins
  b: number[];   // 256 bins
  lum: number[]; // 256 bins
  maxCount: number;
}

export interface RenderViewport {
  zoom: number; // 1.0 = 100%
  panX: number;
  panY: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality?: number; // 0.0 - 1.0 (for jpeg/webp)
  width?: number;
  height?: number;
}

export interface IImageEngine {
  readonly id: string;
  readonly name: string;

  /** Initialize or bind GPU context if required */
  init?(): Promise<void>;

  /** Register an asset's pixel source with the engine (e.g. upload to WebGL texture or ImageBitmap) */
  loadAsset(assetId: string, blob: Blob): Promise<{ width: number; height: number }>;

  /** Release engine resources associated with an asset */
  releaseAsset(assetId: string): void;

  /**
   * Real pixel rendering for Develop Workspace.
   * Runs the Develop Pipeline (White Balance -> Linear Exposure -> Contrast/Tone -> Saturation)
   * onto the provided target HTMLCanvasElement.
   */
  renderDevelop(
    sourceAssetId: string,
    settings: DevelopSettings,
    targetCanvas: HTMLCanvasElement,
    viewport?: RenderViewport
  ): Promise<void>;

  /**
   * Real multi-layer compositing for Edit Workspace.
   * Composites ImageLayers and TextLayers with transforms, opacity, and blend modes.
   */
  renderEdit(
    document: EditDocument,
    targetCanvas: HTMLCanvasElement,
    viewport?: RenderViewport
  ): Promise<void>;

  renderEditFloatRegion?(
    document: EditDocument,
    region: { x: number; y: number; width: number; height: number },
    scale?: number,
    signal?: AbortSignal
  ): Promise<{ width: number; height: number; data: Float32Array }>;

  exportEditFloat?(
    document: EditDocument,
    options: { format: 'jpeg' | 'png' | 'tiff'; quality: number; width: number; height: number; outputProfile?: 'srgb' | 'display-p3' },
    path: string
  ): Promise<string>;

  /**
   * Asynchronously compute real 256-bin RGB and Luminance histogram
   * from the actual rendered canvas or asset.
   */
  computeHistogram(sourceCanvas: HTMLCanvasElement): Promise<HistogramData>;

  /**
   * Export the full-resolution rendered result to a Blob.
   * Does NOT mutate the source image asset.
   */
  exportDevelopImage(
    sourceAssetId: string,
    settings: DevelopSettings,
    options: ExportOptions
  ): Promise<Blob>;

  exportEditImage(
    document: EditDocument,
    options: ExportOptions
  ): Promise<Blob>;
}
