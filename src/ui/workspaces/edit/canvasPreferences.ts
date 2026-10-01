import type { CSSProperties } from 'react';
import { defaultBrushSettings } from '../../../brush/BrushSettings';

export function wheelZoomFactor(delta: number, direction: 'normal' | 'reverse', speed: 'slow' | 'normal' | 'fast'): number {
  if (!Number.isFinite(delta)) return 1;
  const rate = speed === 'slow' ? 0.5 : speed === 'fast' ? 2 : 1;
  return Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.001 * rate * (direction === 'reverse' ? -1 : 1));
}

export function initializeBrushSettings(preferences: { defaultBrushSize: number; defaultBrushHardness: number }) {
  return { ...defaultBrushSettings, size: preferences.defaultBrushSize, hardness: preferences.defaultBrushHardness };
}

export function checkerStyle(size: 'small' | 'medium' | 'large', tone: 'light' | 'dark'): CSSProperties {
  const cell = size === 'small' ? 6 : size === 'large' ? 20 : 12;
  const light = tone === 'light' ? '#d6d6d6' : '#48484b';
  const dark = tone === 'light' ? '#aaaaaa' : '#323235';
  return {
    backgroundColor: light,
    backgroundImage: `conic-gradient(${dark} 25%, ${light} 0 50%, ${dark} 0 75%, ${light} 0)`,
    backgroundSize: `${cell * 2}px ${cell * 2}px`,
  };
}

/** A tiny repeating tile avoids walking millions of preview pixels in JavaScript. */
export function paintCanvasBackdrop(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }, preferences: { canvasBackground: string; checkerSize: 'small' | 'medium' | 'large'; checkerTone: 'light' | 'dark' }, dpr = 1): void {
  const { canvas } = ctx;
  ctx.fillStyle = preferences.canvasBackground;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cell = Math.max(1, Math.round((preferences.checkerSize === 'small' ? 6 : preferences.checkerSize === 'large' ? 20 : 12) * dpr));
  const tile = document.createElement('canvas');
  tile.width = tile.height = cell * 2;
  const tileContext = tile.getContext('2d');
  if (!tileContext) return;
  tileContext.fillStyle = preferences.checkerTone === 'light' ? '#d6d6d6' : '#48484b';
  tileContext.fillRect(0, 0, cell * 2, cell * 2);
  tileContext.fillStyle = preferences.checkerTone === 'light' ? '#aaaaaa' : '#323235';
  tileContext.fillRect(0, 0, cell, cell);
  tileContext.fillRect(cell, cell, cell, cell);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(rect.x, rect.y, rect.width, rect.height); }
  tile.width = tile.height = 0;
}
