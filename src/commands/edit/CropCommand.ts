import { assertDocumentLayersEditable } from '../../edit/LayerTree';
// src/commands/edit/CropCommand.ts
//! Non-Destructive Crop & Canvas/Image Resize Commands (Phase 6)

import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { EditDocument, Layer } from '../../types/edit';
import { Rect } from '../../selection/types';

export class SetCropRectCommand extends BaseCommand {
  private prevCropRect: Rect | null = null;

  constructor(
    documentId: string,
    public readonly newCropRect: Rect | null,
    private documentManager: IDocumentManager
  ) {
    super('Set Crop Rect', documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    this.prevCropRect = doc.cropRect ? { ...doc.cropRect } : null;

    const updatedDoc: EditDocument = {
      ...doc,
      cropRect: this.newCropRect ? { ...this.newCropRect } : null,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedDoc: EditDocument = {
      ...doc,
      cropRect: this.prevCropRect ? { ...this.prevCropRect } : null,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, `Undo: ${this.name}`);
  }
}

export type ResizeAnchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

export class ResizeCanvasCommand extends BaseCommand {
  private prevWidth: number = 1920;
  private prevHeight: number = 1080;
  private prevLayerPositions: Map<string, { x: number; y: number }> = new Map();

  constructor(
    documentId: string,
    public readonly targetWidth: number,
    public readonly targetHeight: number,
    public readonly anchor: ResizeAnchor = 'center',
    private documentManager: IDocumentManager
  ) {
    super(`Resize Canvas (${targetWidth}x${targetHeight})`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    assertDocumentLayersEditable(doc);
    this.prevWidth = doc.width;
    this.prevHeight = doc.height;

    // Calculate delta offset based on anchor
    const deltaW = this.targetWidth - this.prevWidth;
    const deltaH = this.targetHeight - this.prevHeight;

    let offsetX = 0;
    let offsetY = 0;

    if (this.anchor === 'center') {
      offsetX = deltaW / 2;
      offsetY = deltaH / 2;
    } else if (this.anchor === 'top-right') {
      offsetX = deltaW;
      offsetY = 0;
    } else if (this.anchor === 'bottom-left') {
      offsetX = 0;
      offsetY = deltaH;
    } else if (this.anchor === 'bottom-right') {
      offsetX = deltaW;
      offsetY = deltaH;
    } else if (this.anchor === 'top') {
      offsetX = deltaW / 2;
      offsetY = 0;
    } else if (this.anchor === 'bottom') {
      offsetX = deltaW / 2;
      offsetY = deltaH;
    } else if (this.anchor === 'left') {
      offsetX = 0;
      offsetY = deltaH / 2;
    } else if (this.anchor === 'right') {
      offsetX = deltaW;
      offsetY = deltaH / 2;
    }

    // Shift top-level layers according to offset
    this.prevLayerPositions.clear();
    const updatedLayers = doc.layers.map((l) => {
      this.prevLayerPositions.set(l.id, { x: l.transform.x, y: l.transform.y });
      return {
        ...l,
        transform: {
          ...l.transform,
          x: l.transform.x + offsetX,
          y: l.transform.y + offsetY,
        },
      };
    });

    const updatedDoc: EditDocument = {
      ...doc,
      width: this.targetWidth,
      height: this.targetHeight,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedLayers = doc.layers.map((l) => {
      const prev = this.prevLayerPositions.get(l.id);
      if (prev) {
        return {
          ...l,
          transform: {
            ...l.transform,
            x: prev.x,
            y: prev.y,
          },
        };
      }
      return l;
    });

    const updatedDoc: EditDocument = {
      ...doc,
      width: this.prevWidth,
      height: this.prevHeight,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, `Undo: ${this.name}`);
  }
}

export class ResizeImageCommand extends BaseCommand {
  private prevWidth: number = 1920;
  private prevHeight: number = 1080;
  private prevLayers: Layer[] = [];

  constructor(
    documentId: string,
    public readonly targetWidth: number,
    public readonly targetHeight: number,
    private documentManager: IDocumentManager
  ) {
    super(`Resize Image (${targetWidth}x${targetHeight})`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    assertDocumentLayersEditable(doc);
    this.prevWidth = doc.width;
    this.prevHeight = doc.height;
    this.prevLayers = structuredClone(doc.layers);

    const scaleX = this.targetWidth / this.prevWidth;
    const scaleY = this.targetHeight / this.prevHeight;

    const scaleLayer = (l: Layer): Layer => {
      const scaledTransform = {
        ...l.transform,
        x: l.transform.x * scaleX,
        y: l.transform.y * scaleY,
        width: l.transform.width * scaleX,
        height: l.transform.height * scaleY,
      };
      if (l.type === 'group') {
        return {
          ...l,
          transform: scaledTransform,
          children: (l as any).children.map(scaleLayer),
        };
      }
      return {
        ...l,
        transform: scaledTransform,
      };
    };

    const updatedLayers = doc.layers.map(scaleLayer);

    const updatedDoc: EditDocument = {
      ...doc,
      width: this.targetWidth,
      height: this.targetHeight,
      layers: updatedLayers,
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) return;

    const updatedDoc: EditDocument = {
      ...doc,
      width: this.prevWidth,
      height: this.prevHeight,
      layers: structuredClone(this.prevLayers),
      isDirty: true,
      updatedAt: Date.now(),
    };

    this.documentManager.updateDocument(updatedDoc, `Undo: ${this.name}`);
  }
}
