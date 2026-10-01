// src/engine/histogram.ts
import { HistogramData } from '../types/engine';

/**
 * Compute real 256-bin RGB and Luminance histogram from pixel buffer.
 * Bounded, evenly distributed sampling. Counts are actual samples, not display-scaled values.
 */
export function computeHistogramFromImageData(data: Uint8ClampedArray | Uint8Array, length: number): HistogramData {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const lum = new Array(256).fill(0);

  const totalPixels = Math.floor(Math.min(length, data.length) / 4);
  const samples = Math.min(totalPixels, 262144);

  let maxCount = 0;

  for (let sample = 0; sample < samples; sample++) {
    const i = Math.floor((sample + 0.5) * totalPixels / samples) * 4;
    if (data[i + 3] === 0) continue;
    const red = data[i];
    const green = data[i + 1];
    const blue = data[i + 2];
    const l = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);

    r[red]++;
    g[green]++;
    b[blue]++;
    lum[l]++;

    if (r[red] > maxCount) maxCount = r[red];
    if (g[green] > maxCount) maxCount = g[green];
    if (b[blue] > maxCount) maxCount = b[blue];
    if (lum[l] > maxCount) maxCount = lum[l];
  }

  return {
    r,
    g,
    b,
    lum,
    maxCount: Math.max(1, maxCount),
  };
}
