// src/brush/BrushSettings.ts
//! Brush Tool Settings & Presets (Phase 6)

import { BlendMode } from '../types/edit';

export interface BrushSettings {
  size: number; // 1 to 1000 pixels
  hardness: number; // 0.0 (very soft) to 1.0 (hard edge)
  opacity: number; // 0.0 to 1.0
  flow: number; // 0.0 to 1.0 (accumulation rate)
  spacing: number; // 0.05 to 5.0 (dab distance as fraction of brush radius)
  color: string; // HEX or CSS color string, e.g. '#00e5ff'
  blendMode: BlendMode;
  smoothing?: boolean;
  pressureSize?: boolean; // Pressure modulates dab radius (default: true)
  pressureFlow?: boolean; // Pressure modulates flow/opacity (default: true)
}

export const defaultBrushSettings: BrushSettings = {
  size: 30,
  hardness: 0.8,
  opacity: 1.0,
  flow: 1.0,
  spacing: 0.25,
  color: '#ffffff',
  blendMode: 'normal',
  smoothing: true,
  pressureSize: true,
  pressureFlow: true,
};
