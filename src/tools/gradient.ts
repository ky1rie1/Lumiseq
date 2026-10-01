// src/tools/gradient.ts
//! Gradient Tool & Renderer (Phase 6)
//! Supports Linear and Radial gradients across paint layers and layer masks with undoable command.

import { BaseCommand } from '../history/Command';
import { assertLayerEditable } from '../edit/LayerTree';
import { IDocumentManager } from '../types/document';
import { EditDocument, Layer } from '../types/edit';
import { findLayerById, updateLayerInTree } from '../document/EditDocument';
import { defaultColorState } from '../color/colorState';

export type GradientType = 'linear' | 'radial';
export type GradientPreset = 'fg-to-bg' | 'fg-to-transparent' | 'custom';

export interface GradientStop {
  offset: number; // 0.0 to 1.0
  color: string; // CSS color string e.g. '#ffffff' or 'rgba(255, 255, 255, 0)'
}

export interface GradientConfig {
  type: GradientType;
  preset?: GradientPreset;
  stops?: GradientStop[];
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  opacity?: number; // 0.0 to 1.0
  isMask?: boolean;
}

export class GradientRenderer {
  /**
   * Resolves stops based on preset or custom config.
   */
  resolveStops(config: GradientConfig): GradientStop[] {
    if (config.stops && config.stops.length >= 2) {
      return config.stops;
    }

    const { foreground, background } = defaultColorState.getState();

    if (config.preset === 'fg-to-transparent') {
      return [
        { offset: 0.0, color: foreground },
        { offset: 1.0, color: 'rgba(0, 0, 0, 0)' },
      ];
    }

    // Default fg-to-bg
    return [
      { offset: 0.0, color: foreground },
      { offset: 1.0, color: background },
    ];
  }

  /**
   * Renders linear or radial gradient onto canvas context.
   */
  renderGradient(ctx: CanvasRenderingContext2D, config: GradientConfig): void {
    const stops = this.resolveStops(config);
    let grad: CanvasGradient;

    if (config.type === 'radial') {
      const radius = Math.hypot(config.endX - config.startX, config.endY - config.startY);
      grad = ctx.createRadialGradient(
        config.startX,
        config.startY,
        0,
        config.startX,
        config.startY,
        Math.max(1, radius)
      );
    } else {
      grad = ctx.createLinearGradient(config.startX, config.startY, config.endX, config.endY);
    }

    for (const stop of stops) {
      grad.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color);
    }

    ctx.save();
    ctx.globalAlpha = config.opacity ?? 1.0;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
}

export const defaultGradientRenderer = new GradientRenderer();

export class DrawGradientCommand extends BaseCommand {
  constructor(
    documentId: string,
    public readonly layerId: string,
    public readonly isMask: boolean,
    public readonly initialAssetId: string,
    public readonly finalAssetId: string,
    private documentManager: IDocumentManager
  ) {
    super('Draw Gradient', documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;
    assertLayerEditable(doc, this.layerId);

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) return;

    let updatedLayer: Layer;
    if (this.isMask && layer.mask) {
      updatedLayer = {
        ...layer,
        mask: {
          ...layer.mask,
          assetId: this.finalAssetId,
        },
      };
    } else {
      updatedLayer = {
        ...layer,
        rasterAssetId: this.finalAssetId,
      } as Layer;
    }

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);
    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, 'Draw Gradient Applied');
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const layer = findLayerById(doc.layers, this.layerId);
    if (!layer) return;

    let updatedLayer: Layer;
    if (this.isMask && layer.mask) {
      updatedLayer = {
        ...layer,
        mask: {
          ...layer.mask,
          assetId: this.initialAssetId,
        },
      };
    } else {
      updatedLayer = {
        ...layer,
        rasterAssetId: this.initialAssetId,
      } as Layer;
    }

    const updatedLayers = updateLayerInTree(doc.layers, updatedLayer);
    const updatedDoc: EditDocument = {
      ...doc,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, 'Undo: Draw Gradient');
  }
}
