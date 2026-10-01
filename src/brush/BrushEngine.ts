import { assertLayerEditable, assertCurrentLayer } from '../edit/LayerTree';
import { EditDocument } from '../types/edit';
import { defaultDocumentManager } from '../document/DocumentManager';
// src/brush/BrushEngine.ts
//! High-Performance Brush Stroke Engine (Phase 6)
//! Orchestrates pointer/dab interactions, dirty-rect tracking, and single-undo command generation.

import { BrushSettings, defaultBrushSettings } from './BrushSettings';
import { BrushStroke, StrokePoint } from './BrushStroke';
import { BrushRenderer, defaultBrushRenderer } from './BrushRenderer';
import { BrushStrokeCommand, PaintMaskCommand } from './BrushCommands';
import { CommandBus } from '../history/CommandBus';
import { IDocumentManager } from '../types/document';
import { Rect } from '../selection/types';
import { defaultAssetManager } from '../assets/AssetManager';
import { defaultImageEngine } from '../engine/WebGLImageEngine';

export interface ActiveStrokeState {
  documentId: string;
  layerId: string;
  isMask: boolean;
  settings: BrushSettings;
  points: StrokePoint[];
  initialAssetId: string;
  residualDistance: number;
  dirtyBounds: Rect | null;
  startTime: number;
  hadInitialImageSource?: boolean;
  expectedDocument?: EditDocument;
}

export class BrushEngine {
  private activeState: ActiveStrokeState | null = null;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;
  private renderer: BrushRenderer;

  constructor(renderer: BrushRenderer = defaultBrushRenderer, private documentManager?: IDocumentManager) {
    this.renderer = renderer;
  }

  get isPainting(): boolean {
    return this.activeState !== null;
  }

  getActiveStroke(): ActiveStrokeState | null {
    return this.activeState;
  }

  /**
   * Initializes offscreen painting surface with current layer/mask raster data.
   */
  async startStroke(
    params: {
      documentId: string;
      layerId: string;
      isMask?: boolean;
      initialPoint: StrokePoint;
      settings?: Partial<BrushSettings>;
      initialAssetId: string;
      width: number;
      height: number;
      initialImageSource?: CanvasImageSource | Uint8ClampedArray;
    },
    mirrorContext?: CanvasRenderingContext2D | null
  ): Promise<Rect> {
    const expectedDocument = this.documentManager?.getEditDocument(params.documentId) ?? undefined;
    if (expectedDocument) assertLayerEditable(expectedDocument, params.layerId);
    const settings: BrushSettings = {
      ...defaultBrushSettings,
      ...params.settings,
    };

    this.activeState = {
      expectedDocument,
      documentId: params.documentId,
      layerId: params.layerId,
      isMask: params.isMask ?? false,
      settings,
      points: [params.initialPoint],
      initialAssetId: params.initialAssetId,
      residualDistance: 0,
      dirtyBounds: null,
      startTime: Date.now(),
      hadInitialImageSource: !!params.initialImageSource,
    };

    // Prepare offscreen canvas
    if (!this.offscreenCanvas) {
      if (typeof document !== 'undefined') {
        this.offscreenCanvas = document.createElement('canvas');
      }
    }
    if (this.offscreenCanvas) {
      this.offscreenCanvas.width = params.width;
      this.offscreenCanvas.height = params.height;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
      if (this.offscreenCtx) {
        this.offscreenCtx.clearRect(0, 0, params.width, params.height);
        if (params.initialImageSource) {
          if (params.initialImageSource instanceof Uint8ClampedArray) {
            const imgData = this.offscreenCtx.createImageData(params.width, params.height);
            imgData.data.set(params.initialImageSource);
            this.offscreenCtx.putImageData(imgData, 0, 0);
          } else {
            this.offscreenCtx.drawImage(params.initialImageSource, 0, 0);
          }
        }
      }
    }

    // Render the initial dab
    const p = params.initialPoint.pressure ?? 1.0;
    const initialSize = settings.pressureSize !== false
      ? Math.max(1, Math.round(settings.size * Math.max(0.1, p)))
      : settings.size;
    const initialFlow = settings.pressureFlow !== false
      ? Math.min(1.0, Math.max(0.01, settings.flow * Math.max(0.1, p)))
      : settings.flow;
    const radius = Math.max(1, Math.round(initialSize / 2));
    const initialRect: Rect = {
      x: Math.max(0, Math.floor(params.initialPoint.x - radius)),
      y: Math.max(0, Math.floor(params.initialPoint.y - radius)),
      width: radius * 2,
      height: radius * 2,
    };

    const dab = this.renderer.getDabStamp(initialSize, settings.hardness, settings.color, initialFlow);
    if (this.offscreenCtx) {
      this.offscreenCtx.save();
      this.offscreenCtx.globalAlpha = settings.opacity;
      this.offscreenCtx.drawImage(dab, params.initialPoint.x - radius, params.initialPoint.y - radius);
      this.offscreenCtx.restore();
    }
    if (mirrorContext) {
      mirrorContext.save();
      mirrorContext.globalAlpha = settings.opacity;
      mirrorContext.drawImage(dab, params.initialPoint.x - radius, params.initialPoint.y - radius);
      mirrorContext.restore();
    }

    this.activeState.dirtyBounds = initialRect;
    return initialRect;
  }

  /**
   * Adds an intermediate point as cursor drags, rendering incremental dabs.
   * If mirrorContext is supplied (e.g. live overlay canvas), renders the exact
   * same incremental segment dabs with sub-millisecond latency.
   */
  addPoint(point: StrokePoint, mirrorContext?: CanvasRenderingContext2D | null): Rect | null {
    if (!this.activeState || this.activeState.points.length === 0) return null;

    const lastPoint = this.activeState.points[this.activeState.points.length - 1];
    this.activeState.points.push(point);

    if (!this.offscreenCtx && !mirrorContext) return null;

    if (mirrorContext) {
      this.renderer.renderSegment(
        mirrorContext,
        lastPoint,
        point,
        this.activeState.settings,
        this.activeState.residualDistance
      );
    }

    let res: { dirtyRect: Rect; leftoverDistance: number } = {
      dirtyRect: { x: point.x, y: point.y, width: 0, height: 0 },
      leftoverDistance: 0,
    };

    if (this.offscreenCtx) {
      res = this.renderer.renderSegment(
        this.offscreenCtx,
        lastPoint,
        point,
        this.activeState.settings,
        this.activeState.residualDistance
      );
      this.activeState.residualDistance = res.leftoverDistance;
    }

    // Update cumulative dirty bounds
    const curBounds = this.activeState.dirtyBounds;
    if (curBounds) {
      const minX = Math.min(curBounds.x, res.dirtyRect.x);
      const minY = Math.min(curBounds.y, res.dirtyRect.y);
      const maxX = Math.max(curBounds.x + curBounds.width, res.dirtyRect.x + res.dirtyRect.width);
      const maxY = Math.max(curBounds.y + curBounds.height, res.dirtyRect.y + res.dirtyRect.height);
      this.activeState.dirtyBounds = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    } else {
      this.activeState.dirtyBounds = res.dirtyRect;
    }

    return res.dirtyRect;
  }

  /**
   * Completes gesture: creates raster asset and commits ONE undoable command to CommandBus.
   */
  async endStroke(
    commandBus: CommandBus,
    documentManager: IDocumentManager
  ): Promise<BrushStrokeCommand | PaintMaskCommand | null> {
    if (!this.activeState) return null;

    const state = this.activeState;
    const expected = state.expectedDocument ?? documentManager.getEditDocument(state.documentId);
    if (!expected) { this.activeState = null; throw new Error('Paint document is unavailable.'); }
    try { assertCurrentLayer(documentManager, expected, state.layerId); }
    catch (error) { this.activeState = null; throw error; }
    const stroke: BrushStroke = {
      id: `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      documentId: state.documentId,
      layerId: state.layerId,
      isMaskStroke: state.isMask,
      settings: state.settings,
      points: [...state.points],
      bounds: state.dirtyBounds || { x: 0, y: 0, width: 0, height: 0 },
      createdAt: state.startTime,
    };

    // If there is an existing raster asset on this layer and it was not loaded at startStroke, composite it underneath
    if (this.offscreenCanvas && this.offscreenCtx && state.initialAssetId && !state.isMask && !state.hadInitialImageSource) {
      try {
        let prevImg: CanvasImageSource | null = defaultImageEngine.getLoadedSourceElement(state.initialAssetId);
        if (!prevImg) {
          const prevBlob = await defaultAssetManager.getBlob(state.initialAssetId);
          if (prevBlob && prevBlob.size > 0) {
            if (typeof createImageBitmap !== 'undefined') {
              try { prevImg = await createImageBitmap(prevBlob); } catch {}
            }
            if (!prevImg && typeof Image !== 'undefined') {
              const url = defaultAssetManager.getDisplayUrl(state.initialAssetId);
              if (url) {
                prevImg = await new Promise<HTMLImageElement | null>((resolve) => {
                  const img = new Image();
                  img.onload = () => resolve(img);
                  img.onerror = () => resolve(null);
                  img.src = url;
                });
              }
            }
          }
        }
        if (prevImg) {
          const compositeCanvas = document.createElement('canvas');
          compositeCanvas.width = this.offscreenCanvas.width;
          compositeCanvas.height = this.offscreenCanvas.height;
          const compCtx = compositeCanvas.getContext('2d');
          if (compCtx) {
            compCtx.drawImage(prevImg, 0, 0);
            compCtx.drawImage(this.offscreenCanvas, 0, 0);
            this.offscreenCtx.clearRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
            this.offscreenCtx.drawImage(compositeCanvas, 0, 0);
          }
        }
      } catch (err) {
        console.warn('Failed to composite previous layer raster asset in endStroke:', err);
      }
    }

    // Export new asset from offscreen canvas
    let newAssetId: string = `stroke_${Date.now()}`;
    if (this.offscreenCanvas) {
      const anyCanvas = this.offscreenCanvas as any;
      if (typeof anyCanvas.convertToBlob === 'function') {
        const blob = await anyCanvas.convertToBlob({ type: 'image/png' });
        const handle = await defaultAssetManager.registerBlob(blob, state.isMask ? 'mask' : 'image', 'Stroke Output', {
          width: this.offscreenCanvas.width,
          height: this.offscreenCanvas.height,
        });
        newAssetId = handle.id;
      } else if (typeof this.offscreenCanvas.toBlob === 'function') {
        const blob = await new Promise<Blob | null>((resolve) => {
          this.offscreenCanvas!.toBlob((b) => resolve(b), 'image/png');
        });
        if (blob) {
          const handle = await defaultAssetManager.registerBlob(blob, state.isMask ? 'mask' : 'image', 'Stroke Output', {
            width: this.offscreenCanvas.width,
            height: this.offscreenCanvas.height,
          });
          newAssetId = handle.id;
        }
      } else if (this.offscreenCtx) {
        // Fallback for Node/Vitest mock environments
        const imgData = this.offscreenCtx.getImageData(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
        if (state.isMask) {
          // Extract alpha channel into Uint8ClampedArray mask
          const maskArray = new Uint8ClampedArray(imgData.width * imgData.height);
          for (let i = 0; i < maskArray.length; i++) {
            maskArray[i] = imgData.data[i * 4 + 3];
          }
          const handle = await defaultAssetManager.registerMask(maskArray, imgData.width, imgData.height, 'Mask Stroke');
          newAssetId = handle.id;
        } else {
          const buffer = imgData.data.buffer.slice(imgData.data.byteOffset, imgData.data.byteOffset + imgData.data.byteLength);
          const blob = new Blob([buffer], { type: 'image/png' });
          const handle = await defaultAssetManager.registerBlob(blob, 'image', 'Paint Stroke Output', {
            width: imgData.width,
            height: imgData.height,
          });
          newAssetId = handle.id;
        }
      }
    }

    // Rule 2: Single command to commandBus
    let command: BrushStrokeCommand | PaintMaskCommand;
    if (state.isMask) {
      command = new PaintMaskCommand(
        state.documentId,
        state.layerId,
        stroke,
        state.initialAssetId,
        newAssetId,
        documentManager
      );
    } else {
      command = new BrushStrokeCommand(
        state.documentId,
        state.layerId,
        stroke,
        state.initialAssetId,
        newAssetId,
        documentManager
      );
    }

    try {
      assertCurrentLayer(documentManager, expected, state.layerId);
      if (this.activeState !== state) throw new Error('Paint gesture changed before commit.');
      await commandBus.execute(command);
    } catch (error) {
      if (defaultAssetManager.hasAsset(newAssetId)) defaultAssetManager.releaseAsset(newAssetId);
      if (this.activeState === state) this.activeState = null;
      throw error;
    }
    this.activeState = null;
    return command;
  }

  cancelStroke(): void {
    this.activeState = null;
  }

  getOffscreenCanvas(): HTMLCanvasElement | null {
    return this.offscreenCanvas;
  }
}

export const defaultBrushEngine = new BrushEngine(defaultBrushRenderer, defaultDocumentManager);
