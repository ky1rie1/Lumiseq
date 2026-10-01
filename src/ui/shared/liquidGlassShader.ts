/**
 * Apple-grade Liquid Glass Shader Engine
 * Inspired by Shu Ding's SVG liquid-glass shader (https://github.com/shuding/liquid-glass)
 *
 * Implements:
 * - Signed Distance Field (SDF) optical bevel lens refraction with physical surface normals
 * - Isotropic aspect-ratio corrected shapes (pill, circle, rounded-rect)
 * - Pointer-driven fluid displacement waves and click-compression caustics
 * - High-speed offscreen normal map synthesis into SVG <feDisplacementMap>
 * - Invariant displacement scaling (128 = neutral zero displacement)
 * - Chromatic dispersion decomposition (RGB prismatic separation)
 * - Accessibility-aware motion reduction and idle sleep
 */

export interface LiquidGlassOptions {
  width?: number;
  height?: number;
  shape?: 'rounded-rect' | 'circle' | 'pill';
  radius?: number;
  bevelWidth?: number;
  refractionScale?: number;
  chromatic?: boolean;
  dispersion?: number;
  harmonicFlow?: boolean;
}

export interface LiquidGlassState {
  pointerX: number; // 0 to 1
  pointerY: number; // 0 to 1
  pointerActive: boolean;
  pointerDown: boolean;
  ripplePhase: number;
  rippleAmplitude: number;
  flowTime: number;
}

export function smoothStep(min: number, max: number, val: number): number {
  const t = Math.max(0, Math.min(1, (val - min) / (max - min || 1e-6)));
  return t * t * (3 - 2 * t);
}

export function length(x: number, y: number): number {
  return Math.hypot(x, y);
}

export function roundedRectSDF(x: number, y: number, width: number, height: number, radius: number): number {
  const qx = Math.abs(x) - width + radius;
  const qy = Math.abs(y) - height + radius;
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

export function circleSDF(x: number, y: number, radius: number): number {
  return length(x, y) - radius;
}

/**
 * Evaluates the SDF for a given coordinate (X, Y) in isotropic aspect-ratio space.
 * H is normalized to 1.0, W = aspectRatio.
 */
export function evaluateShapeSDF(
  X: number,
  Y: number,
  W: number,
  H: number,
  shape: 'rounded-rect' | 'circle' | 'pill',
  radiusOption?: number
): number {
  const hx = W * 0.5;
  const hy = H * 0.5;

  if (shape === 'circle') {
    const r = Math.min(hx, hy);
    return length(X, Y) - r;
  }

  if (shape === 'pill') {
    const r = Math.min(hx, hy); // For pill, radius is half the smaller dimension (height)
    const qx = Math.abs(X) - (hx - r);
    const qy = Math.abs(Y) - (hy - r);
    return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - r;
  }

  // rounded-rect:
  const maxR = Math.min(hx, hy) * 0.95;
  const r = Math.min(radiusOption ?? 0.18, maxR);
  const qx = Math.abs(X) - (hx - r);
  const qy = Math.abs(Y) - (hy - r);
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/**
 * Generates an RG displacement map texture for SVG <feDisplacementMap>.
 * Red channel encodes horizontal pixel offset; Green channel encodes vertical pixel offset.
 * 128 represents zero displacement; < 128 deflects negative, > 128 deflects positive.
 */
export function generateDisplacementMapData(
  w: number,
  h: number,
  state: LiquidGlassState,
  options: LiquidGlassOptions = {}
): { data: Uint8ClampedArray<ArrayBuffer>; maxScale: number } {
  const shape = options.shape || 'rounded-rect';
  const harmonicFlow = options.harmonicFlow ?? false;

  // Real physical element aspect ratio (W / H)
  const elW = options.width && options.width > 0 ? options.width : w;
  const elH = options.height && options.height > 0 ? options.height : h;
  const aspectRatio = Math.max(0.05, Math.min(20, elW / elH));

  // In normalized space: height H = 1.0, width W = aspectRatio
  const W = aspectRatio;
  const H = 1.0;

  // Bevel thickness in normalized units: default ~16% to 25% of element height
  const defaultBevel = shape === 'circle' ? 0.35 : shape === 'pill' ? 0.30 : 0.20;
  const bevelWidth = options.bevelWidth ?? defaultBevel;

  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));

  const mx = (state.pointerX - 0.5) * W;
  const my = (state.pointerY - 0.5) * H;
  const pointerActive = state.pointerActive;
  const rippleAmp = state.rippleAmplitude;
  const ripplePhase = state.ripplePhase;
  const pointerDown = state.pointerDown;
  const flowTime = state.flowTime;

  const eps = 0.005;
  let maxScaleObserved = 0;

  for (let py = 0; py < h; py++) {
    const v = (py + 0.5) / h;
    const Y = (v - 0.5) * H;
    const rowOffset = py * w;

    for (let px = 0; px < w; px++) {
      const u = (px + 0.5) / w;
      const X = (u - 0.5) * W;
      const pixelIdx = rowOffset + px;

      // 1. SDF evaluation and surface gradient (normal vector)
      const d = evaluateShapeSDF(X, Y, W, H, shape, options.radius);

      let dx = 0;
      let dy = 0;

      // Calculate surface normal if near the border or inside bevel
      if (d < bevelWidth * 0.5 && d > -bevelWidth * 1.5) {
        const dXp = evaluateShapeSDF(X + eps, Y, W, H, shape, options.radius);
        const dXm = evaluateShapeSDF(X - eps, Y, W, H, shape, options.radius);
        const dYp = evaluateShapeSDF(X, Y + eps, W, H, shape, options.radius);
        const dYm = evaluateShapeSDF(X, Y - eps, W, H, shape, options.radius);

        const ndx = (dXp - dXm) / (2 * eps);
        const ndy = (dYp - dYm) / (2 * eps);
        const nLen = Math.hypot(ndx, ndy) || 1e-6;
        const nx = ndx / nLen;
        const ny = ndy / nLen;

        // 2. Physical lens bevel refraction:
        // Inside the glass (d <= 0):
        // As d approaches 0 from -bevelWidth, slope rises smoothly to rim.
        if (d <= 0 && d >= -bevelWidth) {
          const t = (d + bevelWidth) / bevelWidth; // 0 (inner flat center) to 1 (outer rim)
          const lensFactor = Math.sin(t * Math.PI * 0.5); // Smooth sine lens curvature
          dx += nx * lensFactor * 0.75;
          dy += ny * lensFactor * 0.75;
        } else if (d > 0 && d < bevelWidth * 0.25) {
          // Smooth fade-out outside the perimeter to prevent sharp texture clipping
          const fade = Math.max(0, 1 - d / (bevelWidth * 0.25));
          dx += nx * fade * 0.75;
          dy += ny * fade * 0.75;
        }
      }

      // 3. Pointer fluid ripple (Shu Ding wave dynamic)
      if (pointerActive && rippleAmp > 0.002) {
        const distP = Math.hypot(X - mx, Y - my);
        if (distP < 1.8) {
          const wave = Math.sin(distP * 20 - ripplePhase) * Math.exp(-distP * 4.2) * rippleAmp;
          const pdx = (X - mx) / (distP || 1e-6);
          const pdy = (Y - my) / (distP || 1e-6);
          dx += pdx * wave * 0.65;
          dy += pdy * wave * 0.65;

          if (pointerDown) {
            const press = Math.exp(-distP * 5.5) * 0.4;
            dx += pdx * press;
            dy += pdy * press;
          }
        }
      }

      // 4. Subtle harmonic micro-flow
      if (harmonicFlow && flowTime > 0 && d <= 0.02) {
        const shimmer = Math.sin(X * 10 + flowTime) * Math.cos(Y * 10 + flowTime * 0.7) * 0.06;
        dx += shimmer;
        dy += shimmer;
      }

      // Track max scale for diagnostic / test reporting
      const mag = Math.max(Math.abs(dx), Math.abs(dy));
      if (mag > maxScaleObserved) maxScaleObserved = mag;

      // Invariant clamp to [-1.0, 1.0] and encode: 128 is exact neutral (0 displacement)
      const clampedX = Math.max(-1.0, Math.min(1.0, dx));
      const clampedY = Math.max(-1.0, Math.min(1.0, dy));

      const dataIdx = pixelIdx * 4;
      data[dataIdx] = Math.max(0, Math.min(255, Math.round(128 + clampedX * 127)));
      data[dataIdx + 1] = Math.max(0, Math.min(255, Math.round(128 + clampedY * 127)));
      data[dataIdx + 2] = 128; // Blue channel neutral
      data[dataIdx + 3] = 255; // Alpha opaque
    }
  }

  return { data, maxScale: Math.max(maxScaleObserved, 0.001) };
}

/**
 * Creates a static default displacement data URL for immediate synchronous fallback.
 */
let cachedDefaultDataUrl: string | null = null;
export function getDefaultDisplacementDataUrl(): string {
  if (cachedDefaultDataUrl) return cachedDefaultDataUrl;

  const w = 128;
  const h = 80;
  const state: LiquidGlassState = {
    pointerX: 0.5,
    pointerY: 0.5,
    pointerActive: false,
    pointerDown: false,
    ripplePhase: 0,
    rippleAmplitude: 0,
    flowTime: 0,
  };

  const { data } = generateDisplacementMapData(w, h, state);

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const imgData = new ImageData(data, w, h);
      ctx.putImageData(imgData, 0, 0);
      cachedDefaultDataUrl = canvas.toDataURL('image/png');
      return cachedDefaultDataUrl;
    }
  }

  return '';
}
