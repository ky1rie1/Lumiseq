// src/psd/types.ts
//! Photoshop Document (PSD) Binary Parser Types (Phase 6 MVP)

import { BlendMode } from '../types/edit';

export interface PsdHeader {
  signature: string; // Must be '8BPS'
  version: number; // 1 for PSD, 2 for PSB
  channels: number; // 1 to 56
  height: number;
  width: number;
  depth: number; // 1, 8, 16, 32
  colorMode: number; // 3 = RGB
}

export interface PsdChannelInfo {
  id: number; // 0 = red/gray, 1 = green, 2 = blue, -1 = transparency mask, -2 = user mask
  length: number;
}

export interface PsdLayerRecord {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  channels: PsdChannelInfo[];
  blendModeKey: string;
  blendMode: BlendMode;
  opacity: number; // 0.0 to 1.0
  clipping: boolean;
  visible: boolean;
  name: string;
  channelData: Map<number, Uint8ClampedArray>; // channel id -> decoded bytes
}

export interface ParsedPsd {
  header: PsdHeader;
  layers: PsdLayerRecord[];
  hasMergedComposite: boolean;
  compositeImageData?: Uint8ClampedArray;
}

export const PSD_BLEND_MODE_MAP: Record<string, BlendMode> = {
  'norm': 'normal',
  'mul ': 'multiply',
  'scrn': 'screen',
  'over': 'overlay',
  'dark': 'darken',
  'lite': 'lighten',
  'div ': 'color-dodge',
  'idiv': 'color-burn',
  'hLit': 'hard-light',
  'sLit': 'soft-light',
  'diff': 'difference',
  'smud': 'exclusion',
  'hue ': 'hue',
  'sat ': 'saturation',
  'colr': 'color',
  'lum ': 'luminosity',
};
