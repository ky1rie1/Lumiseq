/** Original MIT implementation; mathematical background: darktable denoise (profiled) manual.
 * Sigma is measured in the finest sqrtRGB opponent wavelet band, not in linear RGB.
 */
export const WAVELET_NOISE_FACTORS = [1, 0.22526345103699957, 0.0959899628755893] as const;
export const WAVELET_NATIVE_HALO = 14;
const TAPS = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16] as const;
const NORMAL_MAD = 0.6744897501960817;
const MAX_FLOAT32 = 3.4028234663852886e38;

function validateShape(pixels: Float32Array, width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0
    || !Number.isSafeInteger(width * height * 3) || pixels.length !== width * height * 3) {
    throw new RangeError('Wavelet input must contain exactly width * height * 3 RGB values');
  }
}

function nonnegative(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0; }
function signedSqrt(value:number):number {return Number.isFinite(value)?Math.sign(value)*Math.sqrt(Math.abs(value)):0;}
function amount(value: number): number { return Math.min(100, nonnegative(value)) / 100; }

function toOpponent(pixels: Float32Array): Float32Array {
  const result = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 3) {
    const r = signedSqrt(pixels[i]);
    const g = signedSqrt(pixels[i + 1]);
    const b = signedSqrt(pixels[i + 2]);
    result[i] = .25 * r + .5 * g + .25 * b;
    result[i + 1] = r - g;
    result[i + 2] = b - g;
  }
  return result;
}

/** Separable B3 spline with clamp edges and linear sampling for fractional preview dilation. */
function blur(source: Float32Array, horizontal: Float32Array, target: Float32Array,
  width: number, height: number, dilation: number): void {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 3;
    let a = 0, b = 0, c = 0;
    for (let k = 0; k < 5; k++) {
      const px = Math.max(0, Math.min(width - 1, x + (k - 2) * dilation));
      const left = Math.floor(px), fraction = px - left;
      const i = (y * width + left) * 3, j = (y * width + Math.min(left + 1, width - 1)) * 3;
      const weight = TAPS[k];
      a += (source[i] + (source[j] - source[i]) * fraction) * weight;
      b += (source[i + 1] + (source[j + 1] - source[i + 1]) * fraction) * weight;
      c += (source[i + 2] + (source[j + 2] - source[i + 2]) * fraction) * weight;
    }
    horizontal[index] = a; horizontal[index + 1] = b; horizontal[index + 2] = c;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 3;
    let a = 0, b = 0, c = 0;
    for (let k = 0; k < 5; k++) {
      const py = Math.max(0, Math.min(height - 1, y + (k - 2) * dilation));
      const top = Math.floor(py), fraction = py - top;
      const i = (top * width + x) * 3, j = (Math.min(top + 1, height - 1) * width + x) * 3;
      const weight = TAPS[k];
      a += (horizontal[i] + (horizontal[j] - horizontal[i]) * fraction) * weight;
      b += (horizontal[i + 1] + (horizontal[j + 1] - horizontal[i + 1]) * fraction) * weight;
      c += (horizontal[i + 2] + (horizontal[j + 2] - horizontal[i + 2]) * fraction) * weight;
    }
    target[index] = a; target[index + 1] = b; target[index + 2] = c;
  }
}

function medianSorted(values: Float32Array): number {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) * .5;
}

/** Robust finest-band MAD of an adjacent native-resolution patch. */
export function estimateWaveletNoise(pixels: Float32Array, width: number, height: number): [number, number, number] {
  validateShape(pixels, width, height);
  if (!pixels.length) return [0, 0, 0];
  const opponent = toOpponent(pixels), horizontal = new Float32Array(pixels.length), low = new Float32Array(pixels.length);
  blur(opponent, horizontal, low, width, height, 1);
  const coefficients = new Float32Array(width * height);
  const sigma: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < coefficients.length; i++) coefficients[i] = opponent[i * 3 + channel] - low[i * 3 + channel];
    coefficients.sort();
    const center = medianSorted(coefficients);
    for (let i = 0; i < coefficients.length; i++) coefficients[i] = Math.abs(coefficients[i] - center);
    coefficients.sort();
    sigma[channel] = medianSorted(coefficients) / NORMAL_MAD;
  }
  return sigma;
}

/** Three undecimated B3 bands; native stripe callers must provide and discard a 14 pixel halo. */
export function waveletDenoise(pixels: Float32Array, width: number, height: number,
  lumaAmount: number, chromaAmount: number, sigma: [number, number, number], pixelScale = 1): Float32Array {
  validateShape(pixels, width, height);
  const luma = amount(lumaAmount), chroma = amount(chromaAmount);
  const thresholds = [nonnegative(sigma[0]) * luma, nonnegative(sigma[1]) * chroma, nonnegative(sigma[2]) * chroma];
  if (!pixels.length || thresholds.every(value => value === 0)) return pixels;
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  let current: Float32Array = toOpponent(pixels), next: Float32Array = new Float32Array(pixels.length);
  const horizontal = new Float32Array(pixels.length), retained = new Float32Array(pixels.length);
  for (let level = 0; level < 3; level++) {
    blur(current, horizontal, next, width, height, (1 << level) * scale);
    for (let i = 0; i < pixels.length; i++) {
      const detail = current[i] - next[i];
      const magnitude = Math.max(0, Math.abs(detail) - thresholds[i % 3] * WAVELET_NOISE_FACTORS[level]);
      retained[i] += detail < 0 ? -magnitude : magnitude;
    }
    [current, next] = [next, current];
  }
  for (let i = 0; i < pixels.length; i += 3) {
    const y = retained[i] + current[i], u = retained[i + 1] + current[i + 1], v = retained[i + 2] + current[i + 2];
    const g = y - .25 * u - .25 * v;
    const r = g+u, green = g, b = g+v;
    horizontal[i] = Math.sign(r)*Math.min(MAX_FLOAT32, r*r);
    horizontal[i + 1] = Math.sign(green)*Math.min(MAX_FLOAT32, green*green);
    horizontal[i + 2] = Math.sign(b)*Math.min(MAX_FLOAT32, b*b);
  }
  return horizontal;
}
