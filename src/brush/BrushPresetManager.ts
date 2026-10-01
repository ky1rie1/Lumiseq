// src/brush/BrushPresetManager.ts
//! Professional Brush Preset Manager (Phase 6)

import { BrushSettings } from './BrushSettings';

export interface BrushPreset {
  id: string;
  name: string;
  description: string;
  settings: BrushSettings;
}

export class BrushPresetManager {
  private presets: Map<string, BrushPreset> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.register({
      id: 'soft-round',
      name: 'Soft Round',
      description: 'Smooth feathered edge ideal for shading, blending, and soft masking.',
      settings: {
        size: 50,
        hardness: 0.0,
        opacity: 1.0,
        flow: 0.8,
        spacing: 0.15,
        color: '#ffffff',
        blendMode: 'normal',
      },
    });

    this.register({
      id: 'hard-round',
      name: 'Hard Round',
      description: 'Crisp opaque edge for inking, line art, and precise cutout masks.',
      settings: {
        size: 20,
        hardness: 1.0,
        opacity: 1.0,
        flow: 1.0,
        spacing: 0.1,
        color: '#ffffff',
        blendMode: 'normal',
      },
    });

    this.register({
      id: 'airbrush',
      name: 'Airbrush Soft',
      description: 'Gentle low-flow spray for gradual buildup and skin retouching.',
      settings: {
        size: 100,
        hardness: 0.0,
        opacity: 0.5,
        flow: 0.2,
        spacing: 0.1,
        color: '#ffffff',
        blendMode: 'normal',
      },
    });

    this.register({
      id: 'pencil-fine',
      name: 'Fine Pencil',
      description: 'Crisp thin stroke for technical sketch lines.',
      settings: {
        size: 3,
        hardness: 1.0,
        opacity: 1.0,
        flow: 1.0,
        spacing: 0.05,
        color: '#1a1a1a',
        blendMode: 'normal',
      },
    });
  }

  register(preset: BrushPreset): void {
    this.presets.set(preset.id, preset);
  }

  get(id: string): BrushPreset | undefined {
    return this.presets.get(id);
  }

  getAll(): BrushPreset[] {
    return Array.from(this.presets.values());
  }
}

export const defaultBrushPresetManager = new BrushPresetManager();
