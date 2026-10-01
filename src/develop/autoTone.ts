import type { DevelopSettings } from '../types/develop';
import { computeHistogramFromImageData } from '../engine/histogram';
import { applyBaseTone, srgbToLinear } from '../engine/developColorMath';

export const TONE_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const;
export const AUTO_TONE_KEYS = TONE_KEYS;
export type AutoTonePatch = Pick<DevelopSettings, typeof TONE_KEYS[number]>;

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const neutral: AutoTonePatch = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
const highlightLimit = srgbToLinear(.98);

export function neutralToneSettings(settings: DevelopSettings): DevelopSettings {
  const baseline = structuredClone(settings);
  for (const key of AUTO_TONE_KEYS) baseline[key] = 0;
  return baseline;
}

type GuardPixel = { rgb: [number, number, number]; peak: number };

/** Analyze the neutral rendered preview. The exposure and highlight shoulder are checked
 * against the same linear-light tone formula used by the CPU renderer, including each
 * RGB channel. Percentiles keep a few speculars from holding back the whole photograph.
 */
export function computeAutoTone(data: Uint8ClampedArray | Uint8Array): AutoTonePatch | null {
  const histogram = computeHistogramFromImageData(data, data.length);
  const count = histogram.lum.reduce((sum, frequency) => sum + frequency, 0);
  if (!count) return null;
  const percentile = (fraction: number) => {
    const rank = Math.max(1, Math.ceil(count * fraction));
    let cumulative = 0;
    for (let value = 0; value < 256; value++) {
      cumulative += histogram.lum[value];
      if (cumulative >= rank) return value / 255;
    }
    return 1;
  };
  const low = percentile(.1), mid = percentile(.5), high = percentile(.9);
  const span = high - low;
  // A largely uniform scene can be deliberately high or low key. There is no
  // trustworthy black/white anchor to infer from such a preview.
  if (span < .06) return { ...neutral };

  const patch: AutoTonePatch = { ...neutral };
  if (mid < .4) {
    const distance = Math.log2(srgbToLinear(.4) / Math.max(srgbToLinear(mid), .0005));
    patch.exposure = clamp(distance * .8 * clamp((.42 - mid) / .22, 0, 1), 0, 1.5);
  }
  // Conservative local tone changes complement exposure on genuinely broad
  // distributions. Keep black and white endpoints modest to avoid a crunchy look.
  if (low < .12 && high > .38) patch.shadows = Math.round(clamp((.12 - low) * 220, 0, 24));
  if (low > .08 && span > .2 && mid > .23) patch.blacks = -Math.round(clamp((low - .08) * 65, 0, 16));
  if (high < .82 && high > .48 && mid > .25 && span > .24) patch.whites = Math.round(clamp((.82 - high) * 40, 0, 12));
  if (span >= .12 && span < .32 && mid > .22 && mid < .65) patch.contrast = Math.round(clamp((.32 - span) * 50, 0, 10));

  // Guard only bright pixels, sampled evenly. Dark pixels cannot reach the
  // highlight limit within the bounded exposure range; this keeps search cheap.
  const totalPixels = Math.floor(data.length / 4);
  const sampleCount = Math.min(totalPixels, 8192);
  const bright: GuardPixel[] = [];
  let alreadyClipped = 0;
  let opaque = 0;
  for (let sample = 0; sample < sampleCount; sample++) {
    const i = Math.floor((sample + .5) * totalPixels / sampleCount) * 4;
    if (!data[i + 3]) continue;
    opaque++;
    const peak8 = Math.max(data[i], data[i + 1], data[i + 2]) / 255;
    if (peak8 >= .98) alreadyClipped++;
    if (peak8 < .45) continue;
    bright.push({
      rgb: [srgbToLinear(data[i] / 255), srgbToLinear(data[i + 1] / 255), srgbToLinear(data[i + 2] / 255)],
      peak: srgbToLinear(peak8),
    });
  }
  const allowedNewClips = Math.floor(opaque * .002);
  const protectExisting = alreadyClipped / Math.max(1, opaque) >= .02;
  const safe = () => {
    let newClips = 0, worsened = 0;
    for (const pixel of bright) {
      const result = applyBaseTone(pixel.rgb, patch);
      const peak = Math.max(...result);
      if (pixel.peak < highlightLimit && peak > highlightLimit + 1e-5) newClips++;
      if (protectExisting && pixel.peak >= highlightLimit && peak > pixel.peak * 1.01) worsened++;
      if (newClips > allowedNewClips || worsened > allowedNewClips) return false;
    }
    return true;
  };
  const desiredExposure = Math.round(patch.exposure * 20);
  for (let step = desiredExposure; step >= 0; step--) {
    patch.exposure = step / 20;
    for (let shoulder = 0; shoulder >= -75; shoulder -= 5) {
      patch.highlights = shoulder;
      if (safe()) return patch;
    }
  }
  return { ...neutral };
}
