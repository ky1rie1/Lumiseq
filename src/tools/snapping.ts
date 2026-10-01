// src/tools/snapping.ts
//! Snapping Engine for Move and Transform (Phase 6)
//! Snaps bounding boxes to canvas center/bounds, other layers, and guides.

import { Guide, Layer, Rect } from '../types/edit';

export interface SnapResult {
  x: number;
  y: number;
  snappedX: boolean;
  snappedY: boolean;
  guides: Array<{
    orientation: 'vertical' | 'horizontal';
    position: number;
  }>;
}

export class SnappingEngine {
  private threshold: number = 8;

  setThreshold(pixels: number): void {
    this.threshold = Math.max(1, pixels);
  }

  /**
   * Snaps a target bounding box against canvas boundaries, other layers, and custom guides.
   */
  snap(params: {
    target: Rect;
    canvasWidth: number;
    canvasHeight: number;
    otherLayers?: Layer[];
    userGuides?: Guide[];
    threshold?: number;
  }): SnapResult {
    const { target, canvasWidth, canvasHeight, otherLayers = [], userGuides = [] } = params;
    const threshold = Math.max(0, params.threshold ?? this.threshold);

    let bestX = target.x;
    let bestY = target.y;
    let guideX = 0;
    let guideY = 0;
    let minDiffX = threshold + Number.EPSILON;
    let minDiffY = threshold + Number.EPSILON;
    let snappedX = false;
    let snappedY = false;
    const activeGuides: SnapResult['guides'] = [];

    // Potential X snap targets (vertical lines)
    const xTargets: number[] = [
      0, // Canvas Left
      canvasWidth / 2, // Canvas Center X
      canvasWidth, // Canvas Right
    ];

    // Potential Y snap targets (horizontal lines)
    const yTargets: number[] = [
      0, // Canvas Top
      canvasHeight / 2, // Canvas Center Y
      canvasHeight, // Canvas Bottom
    ];

    // Add user guides
    for (const g of userGuides) {
      if (g.orientation === 'vertical') xTargets.push(g.position);
      else yTargets.push(g.position);
    }

    // Add other layer edges and centers
    for (const l of otherLayers) {
      if (!l.visible || l.transform.rotation !== 0 || l.transform.scaleX !== 1 || l.transform.scaleY !== 1) continue;
      const t = l.transform;
      xTargets.push(t.x, t.x + t.width / 2, t.x + t.width);
      yTargets.push(t.y, t.y + t.height / 2, t.y + t.height);
    }

    // Target reference points
    const targetLeft = target.x;
    const targetCenterX = target.x + target.width / 2;
    const targetRight = target.x + target.width;

    const targetTop = target.y;
    const targetCenterY = target.y + target.height / 2;
    const targetBottom = target.y + target.height;

    // Test X snaps
    for (const xt of xTargets) {
      // Snap left edge
      const diffLeft = Math.abs(targetLeft - xt);
      if (diffLeft < minDiffX) {
        minDiffX = diffLeft;
        bestX = xt;
        guideX = xt;
        snappedX = true;
      }
      // Snap center
      const diffCenter = Math.abs(targetCenterX - xt);
      if (diffCenter < minDiffX) {
        minDiffX = diffCenter;
        bestX = xt - target.width / 2;
        guideX = xt;
        snappedX = true;
      }
      // Snap right edge
      const diffRight = Math.abs(targetRight - xt);
      if (diffRight < minDiffX) {
        minDiffX = diffRight;
        bestX = xt - target.width;
        guideX = xt;
        snappedX = true;
      }
    }

    // Test Y snaps
    for (const yt of yTargets) {
      // Snap top edge
      const diffTop = Math.abs(targetTop - yt);
      if (diffTop < minDiffY) {
        minDiffY = diffTop;
        bestY = yt;
        guideY = yt;
        snappedY = true;
      }
      // Snap center
      const diffCenter = Math.abs(targetCenterY - yt);
      if (diffCenter < minDiffY) {
        minDiffY = diffCenter;
        bestY = yt - target.height / 2;
        guideY = yt;
        snappedY = true;
      }
      // Snap bottom edge
      const diffBottom = Math.abs(targetBottom - yt);
      if (diffBottom < minDiffY) {
        minDiffY = diffBottom;
        bestY = yt - target.height;
        guideY = yt;
        snappedY = true;
      }
    }

    if (snappedX) {
      activeGuides.push({ orientation: 'vertical', position: guideX });
    }
    if (snappedY) {
      activeGuides.push({ orientation: 'horizontal', position: guideY });
    }

    return {
      x: snappedX ? bestX : target.x,
      y: snappedY ? bestY : target.y,
      snappedX,
      snappedY,
      guides: activeGuides,
    };
  }
}

export const defaultSnappingEngine = new SnappingEngine();
