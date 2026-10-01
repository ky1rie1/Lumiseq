// src/selection/types.ts
//! Core data models for the Selection and Masking Engine

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

export type SelectionShape = 'rectangle' | 'ellipse' | 'lasso' | 'polygon';

export type SelectionViewMode = 'normal' | 'mask-overlay' | 'mask-only' | 'selection-overlay';

/**
 * SelectionMask
 * Stored as document state. Does NOT store huge boolean[][] or base64 in React state.
 * The 8-bit grayscale pixel mask (0 = unselected, 255 = fully selected) is stored
 * in AssetManager / NativeAssetRegistry via assetId.
 */
export interface SelectionMask {
  id: string;
  documentId: string;
  width: number;
  height: number;
  assetId: string;
  bounds: Rect;
  feather: number;
  inverted: boolean;
  active: boolean;
}

/**
 * Geometric parameters for rasterizing basic selections
 */
export interface GeometricSelectionParams {
  shape: SelectionShape;
  rect?: Rect; // for rectangle & ellipse
  points?: Point[]; // for lasso & polygon
  feather?: number;
  mode?: SelectionMode;
}
