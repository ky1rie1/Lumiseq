// src/color/colorState.ts
//! Professional Color State & Conversions (Phase 6)
//! Manages Foreground/Background color swatches, shortcuts (D, X), and color space math.

export interface RGB {
  r: number; // 0 to 255
  g: number; // 0 to 255
  b: number; // 0 to 255
}

export interface HSL {
  h: number; // 0 to 360
  s: number; // 0 to 100
  l: number; // 0 to 100
}

export interface ColorState {
  foreground: string; // HEX e.g. '#ffffff'
  background: string; // HEX e.g. '#000000'
}

export function normalizeHexColor(value: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  return '#' + (digits.length === 3 ? [...digits].map(c => c + c).join('') : digits);
}

export function hexToRgb(hex: string): RGB {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  if (clean.length < 6) {
    return { r: 255, g: 255, b: 255 };
  }
  const num = parseInt(clean.substring(0, 6), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const hexR = clamp(r).toString(16).padStart(2, '0');
  const hexG = clamp(g).toString(16).padStart(2, '0');
  const hexB = clamp(b).toString(16).padStart(2, '0');
  return `#${hexR}${hexG}${hexB}`;
}

export function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    // Keep computation precision; round only the labels in the picker UI.
    h: h * 360,
    s: s * 100,
    l: l * 100,
  };
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  h = (h % 360) / 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  if (s === 0) {
    const val = Math.round(l * 255);
    return { r: val, g: val, b: val };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return { r, g, b };
}

export class ColorStateManager {
  private foreground: string = '#ffffff';
  private background: string = '#000000';
  private listeners: Set<(state: ColorState) => void> = new Set();

  getState(): ColorState {
    return {
      foreground: this.foreground,
      background: this.background,
    };
  }

  setForeground(hex: string): void {
    this.foreground = hex;
    this.notify();
  }

  setBackground(hex: string): void {
    this.background = hex;
    this.notify();
  }

  /**
   * Swap Foreground and Background colors (Photoshop 'X' key).
   */
  swapColors(): void {
    const tmp = this.foreground;
    this.foreground = this.background;
    this.background = tmp;
    this.notify();
  }

  /**
   * Reset to default Black and White (Photoshop 'D' key).
   */
  resetColors(): void {
    this.foreground = '#ffffff';
    this.background = '#000000';
    this.notify();
  }

  subscribe(listener: (state: ColorState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const s = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(s);
      } catch (err) {
        console.error('Color state listener error:', err);
      }
    }
  }
}

export const defaultColorState = new ColorStateManager();
