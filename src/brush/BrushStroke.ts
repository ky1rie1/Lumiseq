// src/brush/BrushStroke.ts
//! Brush Stroke Data Model (Phase 6)
//! Encapsulates discrete stroke points and metadata.

import { BrushSettings } from './BrushSettings';
import { Rect } from '../selection/types';

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number; // 0.0 to 1.0 (defaults to 1.0 for mouse)
  time?: number;
}

export interface BrushStroke {
  id: string;
  documentId: string;
  layerId: string;
  isMaskStroke?: boolean;
  settings: BrushSettings;
  points: StrokePoint[];
  bounds: Rect;
  createdAt: number;
}

export function computeStrokeBounds(points: StrokePoint[], radius: number): Rect {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  const pad = Math.ceil(radius + 2);
  return {
    x: Math.floor(minX - pad),
    y: Math.floor(minY - pad),
    width: Math.ceil(maxX - minX + pad * 2),
    height: Math.ceil(maxY - minY + pad * 2),
  };
}
