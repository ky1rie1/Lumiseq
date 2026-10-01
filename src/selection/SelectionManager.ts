// src/selection/SelectionManager.ts
//! Manages active selections and view state per document in Document Coordinate Space

import { Point, SelectionMask, SelectionViewMode } from './types';
import { defaultAssetManager } from '../assets/AssetManager';

export type SelectionChangeListener = (documentId: string, selection: SelectionMask | null) => void;

export class SelectionManager {
  private activeSelections: Map<string, SelectionMask> = new Map();
  private viewModes: Map<string, SelectionViewMode> = new Map();
  private listeners: Set<SelectionChangeListener> = new Set();

  /**
   * Get active selection for document
   */
  getSelection(documentId: string): SelectionMask | null {
    return this.activeSelections.get(documentId) || null;
  }

  /**
   * Set or replace active selection for document
   */
  setSelection(documentId: string, selection: SelectionMask | null): void {
    const prev = this.activeSelections.get(documentId);
    if (prev && prev.assetId && (!selection || prev.assetId !== selection.assetId)) {
      // Release old mask asset ref
      defaultAssetManager.releaseAsset(prev.assetId);
    }

    if (selection) {
      this.activeSelections.set(documentId, selection);
      defaultAssetManager.acquireRef(selection.assetId);
    } else {
      this.activeSelections.delete(documentId);
    }

    this.notify(documentId, selection);
  }

  /**
   * Clear active selection
   */
  clearSelection(documentId: string): void {
    this.setSelection(documentId, null);
  }

  /**
   * Get or set mask view mode ('normal' | 'mask-overlay' | 'mask-only' | 'selection-overlay')
   */
  getViewMode(documentId: string): SelectionViewMode {
    return this.viewModes.get(documentId) || 'normal';
  }

  setViewMode(documentId: string, mode: SelectionViewMode): void {
    this.viewModes.set(documentId, mode);
    this.notify(documentId, this.getSelection(documentId));
  }

  /**
   * Subscribe to selection state changes
   */
  subscribe(listener: SelectionChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(documentId: string, selection: SelectionMask | null): void {
    for (const listener of this.listeners) {
      try {
        listener(documentId, selection);
      } catch (err) {
        console.error('Error in selection change listener:', err);
      }
    }
  }

  /**
   * Transform Viewport Client Coordinates to Document Coordinate Space.
   * Zoom and Pan must NEVER alter document selection coordinates.
   */
  static clientToDocumentSpace(
    clientX: number,
    clientY: number,
    canvasRect: DOMRect,
    docWidth: number,
    docHeight: number,
    zoom: number = 1.0,
    panX: number = 0,
    panY: number = 0
  ): Point {
    // Relative coordinates within canvas element
    const canvasX = clientX - canvasRect.left;
    const canvasY = clientY - canvasRect.top;

    const baseScale = Math.min(
      canvasRect.width / docWidth,
      canvasRect.height / docHeight
    );
    const scale = baseScale * zoom;

    const offsetX = (canvasRect.width - docWidth * scale) / 2 + panX;
    const offsetY = (canvasRect.height - docHeight * scale) / 2 + panY;

    const docX = (canvasX - offsetX) / scale;
    const docY = (canvasY - offsetY) / scale;

    return {
      x: Math.max(0, Math.min(docWidth, docX)),
      y: Math.max(0, Math.min(docHeight, docY)),
    };
  }

  /**
   * Instance helper for document to client viewport coordinate transform
   */
  documentToClientSpace(
    docX: number,
    docY: number,
    viewport: { zoom: number; panX: number; panY: number; canvasWidth: number; canvasHeight: number },
    docWidth: number,
    docHeight: number
  ): { clientX: number; clientY: number } {
    const baseScale = Math.min(viewport.canvasWidth / docWidth, viewport.canvasHeight / docHeight);
    const scale = baseScale * viewport.zoom;
    const offsetX = (viewport.canvasWidth - docWidth * scale) / 2 + viewport.panX;
    const offsetY = (viewport.canvasHeight - docHeight * scale) / 2 + viewport.panY;
    return {
      clientX: docX * scale + offsetX,
      clientY: docY * scale + offsetY,
    };
  }

  /**
   * Instance helper for client to document coordinate transform
   */
  clientToDocumentSpace(
    clientX: number,
    clientY: number,
    viewport: { zoom: number; panX: number; panY: number; canvasWidth: number; canvasHeight: number },
    docWidth: number,
    docHeight: number
  ): { docX: number; docY: number } {
    const baseScale = Math.min(viewport.canvasWidth / docWidth, viewport.canvasHeight / docHeight);
    const scale = baseScale * viewport.zoom;
    const offsetX = (viewport.canvasWidth - docWidth * scale) / 2 + viewport.panX;
    const offsetY = (viewport.canvasHeight - docHeight * scale) / 2 + viewport.panY;
    return {
      docX: (clientX - offsetX) / scale,
      docY: (clientY - offsetY) / scale,
    };
  }
}

export const defaultSelectionManager = new SelectionManager();
