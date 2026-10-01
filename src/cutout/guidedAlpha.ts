/** RGB guided filter (He et al., ECCV 2010), applied only to uncertain model alpha.
 * Two box-filter passes need a 2r halo. Float storage is bounded by a tile, never
 * by the original image. This refines existing evidence; it is not a matting model.
 */
export const MAX_CUTOUT_PIXELS = 40_000_000;

export function validateCutoutSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_CUTOUT_PIXELS) {
    throw new Error('抠图尺寸无效，最多支持 4000 万像素。');
  }
}

function sample(low: Uint8ClampedArray, lw: number, lh: number, x: number, y: number, w: number, h: number): number {
  const fx = Math.max(0, Math.min(lw - 1, (x + 0.5) * lw / w - 0.5));
  const fy = Math.max(0, Math.min(lh - 1, (y + 0.5) * lh / h - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(lw - 1, x0 + 1), y1 = Math.min(lh - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  return (low[y0 * lw + x0] * (1 - dx) + low[y0 * lw + x1] * dx) * (1 - dy)
    + (low[y1 * lw + x0] * (1 - dx) + low[y1 * lw + x1] * dx) * dy;
}

// Truncated windows at true image edges; sliding sums give O(n), independent of r.
function mean(input: Float32Array, w: number, h: number, radius: number): Float32Array {
  const temp = new Float32Array(input.length), output = new Float32Array(input.length);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x <= Math.min(radius, w - 1); x++) sum += input[y * w + x];
    for (let x = 0; x < w; x++) {
      temp[y * w + x] = sum / (Math.min(w - 1, x + radius) - Math.max(0, x - radius) + 1);
      if (x - radius >= 0) sum -= input[y * w + x - radius];
      if (x + radius + 1 < w) sum += input[y * w + x + radius + 1];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(radius, h - 1); y++) sum += temp[y * w + x];
    for (let y = 0; y < h; y++) {
      output[y * w + x] = sum / (Math.min(h - 1, y + radius) - Math.max(0, y - radius) + 1);
      if (y - radius >= 0) sum -= temp[(y - radius) * w + x];
      if (y + radius + 1 < h) sum += temp[(y + radius + 1) * w + x];
    }
  }
  return output;
}

export type ReadGuideTile = (x: number, y: number, width: number, height: number) => Uint8ClampedArray;

export function refineGuidedAlphaTiles(low: Uint8ClampedArray, lw: number, lh: number, w: number, h: number, readGuide: ReadGuideTile, tileSize = 256): Uint8ClampedArray {
  validateCutoutSize(lw, lh); validateCutoutSize(w, h);
  if (low.length !== lw * lh || !Number.isSafeInteger(tileSize) || tileSize < 1 || tileSize > 256) throw new Error('抠图蒙版或分块数据无效。');
  const radius = Math.max(2, Math.min(32, Math.ceil(Math.max(w / lw, h / lh))));
  const output = new Uint8ClampedArray(w * h);
  for (let top = 0; top < h; top += tileSize) for (let left = 0; left < w; left += tileSize) {
    const right = Math.min(w, left + tileSize), bottom = Math.min(h, top + tileSize);
    const x0 = Math.max(0, left - 2 * radius), y0 = Math.max(0, top - 2 * radius);
    const tw = Math.min(w, right + 2 * radius) - x0, th = Math.min(h, bottom + 2 * radius) - y0;
    const rgba = readGuide(x0, y0, tw, th);
    if (rgba.length !== tw * th * 4) throw new Error('原图引导像素尺寸不符。');
    const size = tw * th, base = new Float32Array(size);
    let uncertain = false;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const p = sample(low, lw, lh, x + x0, y + y0, w, h);
      base[y * tw + x] = p;
      if (p > 4 && p < 251) uncertain = true;
    }
    let coefficients: Float32Array[] | undefined;
    if (uncertain) {
      // R,G,B,p,RR,RG,RB,GG,GB,BB,Rp,Gp,Bp.
      const moments: Float32Array[] = Array.from({ length: 13 }, () => new Float32Array(size));
      for (let i = 0; i < size; i++) {
        const opacity = rgba[i * 4 + 3] / 255;
        const r = rgba[i * 4] / 255 * opacity + 1 - opacity;
        const g = rgba[i * 4 + 1] / 255 * opacity + 1 - opacity;
        const b = rgba[i * 4 + 2] / 255 * opacity + 1 - opacity;
        const p = base[i] / 255;
        moments[0][i] = r; moments[1][i] = g; moments[2][i] = b; moments[3][i] = p;
        moments[4][i] = r*r; moments[5][i] = r*g; moments[6][i] = r*b;
        moments[7][i] = g*g; moments[8][i] = g*b; moments[9][i] = b*b;
        moments[10][i] = r*p; moments[11][i] = g*p; moments[12][i] = b*p;
      }
      for (let c = 0; c < 13; c++) moments[c] = mean(moments[c], tw, th, radius);
      coefficients = Array.from({ length: 4 }, () => new Float32Array(size));
      for (let i = 0; i < size; i++) {
        const r = moments[0][i], g = moments[1][i], b = moments[2][i], p = moments[3][i];
        const rr = moments[4][i] - r*r + 0.001, rg = moments[5][i] - r*g, rb = moments[6][i] - r*b;
        const gg = moments[7][i] - g*g + 0.001, gb = moments[8][i] - g*b, bb = moments[9][i] - b*b + 0.001;
        const rp = moments[10][i] - r*p, gp = moments[11][i] - g*p, bp = moments[12][i] - b*p;
        const c00 = gg*bb - gb*gb, c01 = rb*gb - rg*bb, c02 = rg*gb - rb*gg;
        const c11 = rr*bb - rb*rb, c12 = rg*rb - rr*gb, c22 = rr*gg - rg*rg;
        const determinant = rr*c00 + rg*c01 + rb*c02;
        // epsilon keeps the covariance positive definite, including flat colors.
        const ar = (c00*rp + c01*gp + c02*bp) / determinant;
        const ag = (c01*rp + c11*gp + c12*bp) / determinant;
        const ab = (c02*rp + c12*gp + c22*bp) / determinant;
        coefficients[0][i] = ar; coefficients[1][i] = ag; coefficients[2][i] = ab;
        coefficients[3][i] = p - ar*r - ag*g - ab*b;
      }
      for (let c = 0; c < 4; c++) coefficients[c] = mean(coefficients[c], tw, th, radius);
    }
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const i = (y - y0) * tw + x - x0, p = base[i], opacity = rgba[i * 4 + 3] / 255;
      let value = p;
      if (coefficients && p > 4 && p < 251) {
        let q = coefficients[3][i];
        for (let c = 0; c < 3; c++) q += coefficients[c][i] * (rgba[i * 4 + c] / 255 * opacity + 1 - opacity);
        // Bound changes to evidence already in the model; retain reliable 0/255.
        value = Number.isFinite(q) ? Math.max(p - 64, Math.min(p + 64, q * 255)) : p;
      }
      // Source alpha is composited by the layer renderer. Do not multiply it twice.
      output[y * w + x] = opacity === 0 ? 0 : Math.round(value);
    }
  }
  return output;
}

export function refineGuidedAlpha(low: Uint8ClampedArray, lw: number, lh: number, rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  validateCutoutSize(w, h);
  if (rgba.length !== w * h * 4) throw new Error('原图引导像素尺寸不符。');
  return refineGuidedAlphaTiles(low, lw, lh, w, h, (x, y, tw, th) => {
    const tile = new Uint8ClampedArray(tw * th * 4);
    for (let row = 0; row < th; row++) tile.set(rgba.subarray(((y + row) * w + x) * 4, ((y + row) * w + x + tw) * 4), row * tw * 4);
    return tile;
  });
}
