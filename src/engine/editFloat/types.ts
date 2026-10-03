import type { DevelopSmartObjectLayer, TextLayer } from '../../types/edit';

/** Straight-alpha, scene-linear sRGB. RGB may be signed or greater than one. */
export interface LinearPixelBuffer { width: number; height: number; data: Float32Array }
export interface EditRegion { x: number; y: number; width: number; height: number }
export interface FloatSource { width: number; height: number; originX?: number; originY?: number; getRegion(region: EditRegion): Promise<LinearPixelBuffer> }
export interface FloatEditPorts {
  getSource(assetId: string): Promise<FloatSource>;
  getMask(assetId: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  getRawSource(layer: DevelopSmartObjectLayer): Promise<FloatSource>;
  getTextSource?(layer: TextLayer): Promise<FloatSource>;
}
export interface FloatRenderOptions { signal?: AbortSignal; scale?: number; scaleY?: number; layerOverrides?: Map<string, FloatSource> }
