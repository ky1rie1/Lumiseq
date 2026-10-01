export interface HazeAnalysis {
  version: 1;
  width: number;
  height: number;
  atmosphere: [number, number, number];
  /** Interleaved mean-a, mean-b coefficients, row-major with the top row first. */
  coefficients: number[];
}

type RGB = [number, number, number];
const luminance = (rgb: RGB) => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Independent dark-channel / fast-guided-filter implementation; see docs/technical/DEHAZE.md. */
export function analyzeHaze(pixels: Float32Array, width: number, height: number): HazeAnalysis {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 65536 || pixels.length !== width * height * 3) {
    throw new RangeError('Haze analysis requires a matching whole-image RGB buffer of at most 65,536 pixels');
  }
  if (!pixels.every(Number.isFinite)) throw new RangeError('Haze analysis requires finite RGB values');
  const scale = Math.min(1, 256 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const rgb: RGB[] = [];
  // Non-overlapping area averages preserve scene energy and dilute isolated bright samples.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sum: RGB = [0, 0, 0];
    const x0 = Math.floor(x * width / w), x1 = Math.floor((x + 1) * width / w);
    const y0 = Math.floor(y * height / h), y1 = Math.floor((y + 1) * height / h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const offset = (yy * width + xx) * 3;
      for (let c = 0; c < 3; c++) sum[c] += Math.max(0, pixels[offset + c]);
    }
    const count = (x1 - x0) * (y1 - y0);
    rgb.push(sum.map(v => v / count) as RGB);
  }
  const n = w * h;
  const darkRadius = Math.max(1, Math.round(2 * Math.max(w, h) / 256));
  const guidedRadius = Math.max(1, Math.round(4 * Math.max(w, h) / 256));
  const rawDark = Float64Array.from(rgb, v => Math.min(...v));
  const dark = minimumFilter(rawDark, w, h, darkRadius);
  const guide = Float64Array.from(rgb, luminance);
  const atmosphere = estimateAtmosphere(rgb, dark, rawDark, guide);
  if (atmosphere.every(v => v === 0)) return { version: 1, width: w, height: h, atmosphere, coefficients: new Array(n * 2).fill(0) };
  const normalized = Float64Array.from(rgb, v => Math.min(v[0] / atmosphere[0], v[1] / atmosphere[1], v[2] / atmosphere[2]));
  const p = minimumFilter(normalized, w, h, darkRadius);
  const meanI = boxMean(guide, w, h, guidedRadius), meanP = boxMean(p, w, h, guidedRadius);
  const meanII = boxMean(Float64Array.from(guide, v => v * v), w, h, guidedRadius);
  const meanIP = boxMean(Float64Array.from(guide, (v, i) => v * p[i]), w, h, guidedRadius);
  const a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = (meanIP[i] - meanI[i] * meanP[i]) / (Math.max(0, meanII[i] - meanI[i] ** 2) + .0001);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxMean(a, w, h, guidedRadius), meanB = boxMean(b, w, h, guidedRadius);
  const coefficients = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) { coefficients[i * 2] = meanA[i]; coefficients[i * 2 + 1] = meanB[i]; }
  return { version: 1, width: w, height: h, atmosphere, coefficients };
}

function estimateAtmosphere(rgb: RGB[], dark: Float64Array, rawDark: Float64Array, guide: Float64Array): RGB {
  if (rgb.every(v => v.every(c => c === 0))) return [0, 0, 0];
  const displayRange = rgb.every(v => v.every(c => c <= 1.0001));
  let candidates = rgb.map((_, i) => i).filter(i => rawDark[i] <= dark[i] * 1.25 + .02 && !(displayRange && rgb[i].every(c => c >= .9999)));
  // Uniform clipped images and tiny fields still have a valid measured atmosphere.
  if (candidates.length < Math.max(1, Math.ceil(rgb.length * .05))) candidates = rgb.map((_, i) => i);
  candidates.sort((a, b) => dark[b] - dark[a] || a - b);
  candidates = candidates.slice(0, Math.max(1, Math.ceil(candidates.length * .05)));
  candidates.sort((a, b) => guide[b] - guide[a] || a - b);
  candidates = candidates.slice(0, Math.max(1, Math.ceil(candidates.length * .05)));
  const sum: RGB = [0, 0, 0];
  for (const i of candidates) for (let c = 0; c < 3; c++) sum[c] += rgb[i][c];
  return sum.map(v => Math.max(.05, v / candidates.length)) as RGB;
}

/** Separable square min filter with truncated windows at image boundaries. */
function minimumFilter(input: Float64Array, w: number, h: number, radius: number): Float64Array {
  const horizontal = new Float64Array(w * h), output = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = Infinity;
    for (let xx = Math.max(0, x - radius); xx <= Math.min(w - 1, x + radius); xx++) v = Math.min(v, input[y * w + xx]);
    horizontal[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = Infinity;
    for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) v = Math.min(v, horizontal[yy * w + x]);
    output[y * w + x] = v;
  }
  return output;
}

/** Summed-area box means use the actual truncated window area, including on thin images. */
function boxMean(input: Float64Array, w: number, h: number, radius: number): Float64Array {
  const stride = w + 1, integral = new Float64Array(stride * (h + 1)), output = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += input[y * w + x]; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
    const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
    output[y * w + x] = (integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return output;
}

/** Coordinates refer to the complete uncropped source, with (0,0) at the top left. */
export function applyHaze(rgb: RGB, analysis: HazeAnalysis, xNormalized: number, yNormalized: number, amount: number): RGB {
  if (amount === 0) return rgb;
  const strength = clamp(amount / 100, -1, 1), atmosphere = analysis.atmosphere;
  if (strength < 0) return rgb.map((v, c) => v + (atmosphere[c] - v) * -strength * .26) as RGB;
  const x = clamp(xNormalized * analysis.width - .5, 0, analysis.width - 1);
  const y = clamp(yNormalized * analysis.height - .5, 0, analysis.height - 1);
  const x0 = Math.floor(x), x1 = Math.min(x0 + 1, analysis.width - 1), y0 = Math.floor(y), y1 = Math.min(y0 + 1, analysis.height - 1);
  const fx = x - x0, fy = y - y0;
  const sample = (channel: number) => {
    const at = (xx: number, yy: number) => analysis.coefficients[(yy * analysis.width + xx) * 2 + channel];
    return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
  };
  const haze = clamp(sample(0) * luminance(rgb) + sample(1), 0, 1);
  const transmission = Math.max(.15, 1 - .9 * strength * haze);
  return rgb.map((v, c) => atmosphere[c] + (v - atmosphere[c]) / transmission) as RGB;
}
