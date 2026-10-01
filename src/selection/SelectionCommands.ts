// src/selection/SelectionCommands.ts
//! Core Command classes for manipulating Document Selection via CommandBus

import { BaseCommand } from '../history/Command';
import { IDocumentManager } from '../types/document';
import { EditDocument } from '../types/edit';
import { defaultAssetManager } from '../assets/AssetManager';
import { defaultSelectionManager } from './SelectionManager';
import { SelectionUtils } from './SelectionUtils';
import { GeometricSelectionParams, Rect, SelectionMask, SelectionMode } from './types';

/**
 * Base helper for Selection Commands
 */
abstract class BaseSelectionCommand extends BaseCommand {
  protected prevSelection: SelectionMask | null = null;

  constructor(name: string, documentId: string, protected documentManager: IDocumentManager) {
    super(name, documentId);
  }

  protected getEditDoc(): EditDocument {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) {
      throw new Error(`Document "${this.documentId}" is not an active Edit document.`);
    }
    return doc;
  }

  undo(): void {
    const doc = this.getEditDoc();
    defaultSelectionManager.setSelection(this.documentId, this.prevSelection);
    const updated = {
      ...doc,
      selection: this.prevSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, `Undo ${this.name}`);
  }
}

/**
 * Create or modify selection using geometric params or raw mask bytes
 */
export class CreateSelectionCommand extends BaseSelectionCommand {
  private newSelection: SelectionMask | null = null;

  constructor(
    documentId: string,
    private params: {
      geometric?: GeometricSelectionParams;
      rawMask?: Uint8ClampedArray;
      bounds?: Rect;
      feather?: number;
      mode?: SelectionMode;
      validateSource?: () => void;
    },
    documentManager: IDocumentManager
  ) {
    super('Create Selection', documentId, documentManager);
  }

  async execute(): Promise<void> {
    this.params.validateSource?.();
    const doc = this.getEditDoc();
    this.prevSelection = doc.selection || defaultSelectionManager.getSelection(this.documentId);
    const mode = this.params.mode || (this.params.geometric?.mode) || 'replace';
    const feather = this.params.feather ?? (this.params.geometric?.feather ?? 0);

    let incomingMask: Uint8ClampedArray;
    if (this.params.rawMask) {
      incomingMask = this.params.rawMask;
    } else if (this.params.geometric) {
      incomingMask = SelectionUtils.rasterizeShape(
        doc.width,
        doc.height,
        this.params.geometric.shape,
        this.params.geometric.rect,
        this.params.geometric.points
      );
    } else {
      throw new Error('CreateSelectionCommand: Neither geometric params nor rawMask provided.');
    }

    let finalMask: Uint8ClampedArray;
    if (mode === 'replace' || !this.prevSelection) {
      finalMask = incomingMask;
    } else {
      const prevMask = await defaultAssetManager.getMask(this.prevSelection.assetId);
      if (prevMask && prevMask.length === doc.width * doc.height) {
        finalMask = SelectionUtils.combineMasks(prevMask, incomingMask, mode);
      } else {
        finalMask = incomingMask;
      }
    }

    if (feather > 0) {
      finalMask = SelectionUtils.featherMask(finalMask, doc.width, doc.height, feather);
    }

    if (SelectionUtils.isMaskEmpty(finalMask)) {
      this.newSelection = null;
    } else {
      const bounds = SelectionUtils.getMaskBounds(finalMask, doc.width, doc.height);
      const assetHandle = await defaultAssetManager.registerMask(
        finalMask,
        doc.width,
        doc.height,
        `Selection_${Date.now()}`
      );
      try { this.params.validateSource?.(); }
      catch (error) { defaultAssetManager.releaseAsset(assetHandle.id); throw error; }

      this.newSelection = {
        id: `sel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        documentId: this.documentId,
        width: doc.width,
        height: doc.height,
        assetId: assetHandle.id,
        bounds,
        feather,
        inverted: false,
        active: true,
      };
    }

    this.params.validateSource?.();
    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...this.getEditDoc(),
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, this.name);
  }

  redo(): void {
    const doc = this.getEditDoc();
    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...doc,
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, `Redo ${this.name}`);
  }
}

/**
 * Clear current active selection
 */
export class ClearSelectionCommand extends BaseSelectionCommand {
  constructor(documentId: string, documentManager: IDocumentManager) {
    super('Clear Selection', documentId, documentManager);
  }

  execute(): void {
    const doc = this.getEditDoc();
    this.prevSelection = doc.selection || defaultSelectionManager.getSelection(this.documentId);
    defaultSelectionManager.setSelection(this.documentId, null);

    const updated: EditDocument = {
      ...doc,
      selection: null,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, this.name);
  }
}

/**
 * Select All (Entire Canvas)
 */
export class SelectAllCommand extends BaseSelectionCommand {
  private newSelection: SelectionMask | null = null;

  constructor(documentId: string, documentManager: IDocumentManager) {
    super('Select All', documentId, documentManager);
  }

  async execute(): Promise<void> {
    const doc = this.getEditDoc();
    this.prevSelection = doc.selection || defaultSelectionManager.getSelection(this.documentId);

    const fullMask = SelectionUtils.createFullMask(doc.width, doc.height);
    const assetHandle = await defaultAssetManager.registerMask(
      fullMask,
      doc.width,
      doc.height,
      `SelectAll_${Date.now()}`
    );

    this.newSelection = {
      id: `sel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      documentId: this.documentId,
      width: doc.width,
      height: doc.height,
      assetId: assetHandle.id,
      bounds: { x: 0, y: 0, width: doc.width, height: doc.height },
      feather: 0,
      inverted: false,
      active: true,
    };

    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...doc,
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, this.name);
  }

  redo(): void {
    const doc = this.getEditDoc();
    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...doc,
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, `Redo ${this.name}`);
  }
}

/**
 * Invert Selection (0 <-> 255)
 */
export class InvertSelectionCommand extends BaseSelectionCommand {
  private newSelection: SelectionMask | null = null;

  constructor(documentId: string, documentManager: IDocumentManager) {
    super('Invert Selection', documentId, documentManager);
  }

  async execute(): Promise<void> {
    const doc = this.getEditDoc();
    this.prevSelection = doc.selection || defaultSelectionManager.getSelection(this.documentId);
    if (!this.prevSelection) {
      // If no selection, Invert selects all
      const cmd = new SelectAllCommand(this.documentId, this.documentManager);
      await cmd.execute();
      return;
    }

    const currentMask = await defaultAssetManager.getMask(this.prevSelection.assetId);
    if (!currentMask) return;

    const inverted = SelectionUtils.invertMask(currentMask);
    const bounds = SelectionUtils.getMaskBounds(inverted, doc.width, doc.height);
    const assetHandle = await defaultAssetManager.registerMask(
      inverted,
      doc.width,
      doc.height,
      `Invert_${Date.now()}`
    );

    this.newSelection = {
      ...this.prevSelection,
      id: `sel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      assetId: assetHandle.id,
      bounds,
      inverted: !this.prevSelection.inverted,
    };

    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...doc,
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, this.name);
  }

  redo(): void {
    const doc = this.getEditDoc();
    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...doc,
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, `Redo ${this.name}`);
  }
}

/**
 * Feather Selection
 */
export class FeatherSelectionCommand extends BaseSelectionCommand {
  private newSelection: SelectionMask | null = null;

  constructor(
    documentId: string,
    private featherRadius: number,
    documentManager: IDocumentManager
  ) {
    super(`Feather Selection (${featherRadius}px)`, documentId, documentManager);
  }

  async execute(): Promise<void> {
    const doc = this.getEditDoc();
    this.prevSelection = doc.selection || defaultSelectionManager.getSelection(this.documentId);
    if (!this.prevSelection || this.featherRadius <= 0) return;

    const currentMask = await defaultAssetManager.getMask(this.prevSelection.assetId);
    if (!currentMask) return;

    const feathered = SelectionUtils.featherMask(
      currentMask,
      doc.width,
      doc.height,
      this.featherRadius
    );
    const bounds = SelectionUtils.getMaskBounds(feathered, doc.width, doc.height);
    const assetHandle = await defaultAssetManager.registerMask(
      feathered,
      doc.width,
      doc.height,
      `Feather_${Date.now()}`
    );

    this.newSelection = {
      ...this.prevSelection,
      id: `sel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      assetId: assetHandle.id,
      bounds,
      feather: this.prevSelection.feather + this.featherRadius,
    };

    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...doc,
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, this.name);
  }
}

/**
 * Expand Selection (Grow by N pixels)
 */
export class ExpandSelectionCommand extends BaseSelectionCommand {
  private newSelection: SelectionMask | null = null;

  constructor(
    documentId: string,
    private radius: number,
    documentManager: IDocumentManager
  ) {
    super(`Expand Selection (${radius}px)`, documentId, documentManager);
  }

  async execute(): Promise<void> {
    const doc = this.getEditDoc();
    this.prevSelection = doc.selection || defaultSelectionManager.getSelection(this.documentId);
    if (!this.prevSelection || this.radius <= 0) return;

    const currentMask = await defaultAssetManager.getMask(this.prevSelection.assetId);
    if (!currentMask) return;

    const expanded = SelectionUtils.expandMask(
      currentMask,
      doc.width,
      doc.height,
      this.radius
    );
    const bounds = SelectionUtils.getMaskBounds(expanded, doc.width, doc.height);
    const assetHandle = await defaultAssetManager.registerMask(
      expanded,
      doc.width,
      doc.height,
      `Expand_${Date.now()}`
    );

    this.newSelection = {
      ...this.prevSelection,
      id: `sel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      assetId: assetHandle.id,
      bounds,
    };

    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...doc,
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, this.name);
  }
}

/**
 * Contract Selection (Shrink by N pixels)
 */
export class ContractSelectionCommand extends BaseSelectionCommand {
  private newSelection: SelectionMask | null = null;

  constructor(
    documentId: string,
    private radius: number,
    documentManager: IDocumentManager
  ) {
    super(`Contract Selection (${radius}px)`, documentId, documentManager);
  }

  async execute(): Promise<void> {
    const doc = this.getEditDoc();
    this.prevSelection = doc.selection || defaultSelectionManager.getSelection(this.documentId);
    if (!this.prevSelection || this.radius <= 0) return;

    const currentMask = await defaultAssetManager.getMask(this.prevSelection.assetId);
    if (!currentMask) return;

    const contracted = SelectionUtils.contractMask(
      currentMask,
      doc.width,
      doc.height,
      this.radius
    );
    const bounds = SelectionUtils.getMaskBounds(contracted, doc.width, doc.height);

    if (SelectionUtils.isMaskEmpty(contracted)) {
      this.newSelection = null;
    } else {
      const assetHandle = await defaultAssetManager.registerMask(
        contracted,
        doc.width,
        doc.height,
        `Contract_${Date.now()}`
      );

      this.newSelection = {
        ...this.prevSelection,
        id: `sel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        assetId: assetHandle.id,
        bounds,
      };
    }

    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...doc,
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, this.name);
  }
}

/**
 * Transform Selection (Translate / Offset)
 */
export class TransformSelectionCommand extends BaseSelectionCommand {
  private newSelection: SelectionMask | null = null;

  constructor(
    documentId: string,
    private deltaX: number,
    private deltaY: number,
    documentManager: IDocumentManager
  ) {
    super(`Move Selection (${deltaX}px, ${deltaY}px)`, documentId, documentManager);
  }

  async execute(): Promise<void> {
    const doc = this.getEditDoc();
    this.prevSelection = doc.selection || defaultSelectionManager.getSelection(this.documentId);
    if (!this.prevSelection) return;

    const currentMask = await defaultAssetManager.getMask(this.prevSelection.assetId);
    if (!currentMask) return;

    const w = doc.width;
    const h = doc.height;
    const transformed = new Uint8ClampedArray(w * h);
    const dx = Math.round(this.deltaX);
    const dy = Math.round(this.deltaY);

    for (let y = 0; y < h; y++) {
      const srcY = y - dy;
      if (srcY < 0 || srcY >= h) continue;
      const srcRowOffset = srcY * w;
      const dstRowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const srcX = x - dx;
        if (srcX >= 0 && srcX < w) {
          transformed[dstRowOffset + x] = currentMask[srcRowOffset + srcX];
        }
      }
    }

    const bounds = SelectionUtils.getMaskBounds(transformed, w, h);
    const assetHandle = await defaultAssetManager.registerMask(
      transformed,
      w,
      h,
      `Transform_${Date.now()}`
    );

    this.newSelection = {
      ...this.prevSelection,
      id: `sel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      assetId: assetHandle.id,
      bounds,
    };

    defaultSelectionManager.setSelection(this.documentId, this.newSelection);
    const updated: EditDocument = {
      ...doc,
      selection: this.newSelection,
      isDirty: true,
      updatedAt: Date.now(),
    };
    this.documentManager.updateDocument(updated, this.name);
  }
}
