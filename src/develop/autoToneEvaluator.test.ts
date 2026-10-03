import { expect, it } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';
import { createAutoToneEvaluator } from './autoToneEvaluator';
import type { FloatAutoToneSource } from './autoToneSource';

it('matches sequential production shadow and highlight gains in a local mask', async () => {
  const assets = new AssetManager();
  const mask = await assets.registerMask(new Uint8ClampedArray([255]), 1, 1, 'white');
  const settings = createDefaultDevelopSettings(false);
  settings.masks = [{id: 'mask', name: 'mask', kind: 'radial', maskAssetId: mask.id,
    geometry: {center: {x:.5, y:.5}, radiusX:.5, radiusY:.5},
    inverted: false, opacity: 1, shadows: 100, highlights: 100}];
  const source: FloatAutoToneSource = {samples: [[.35,.35,.35]], positions: [[.5,.5]],
    tailSamples: [], tailPositions: [], precision: 'float32', sourcePixels: 1, sourcePeak: .35};
  const evaluate = await createAutoToneEvaluator(settings, source, assets);
  const neutral = {exposure:0, contrast:0, shadows:0, highlights:0, whites:0, blacks:0};
  const shadow = .75 / (1 + Math.exp((.35 - .25) * 12));
  const highlight = .75 / (1 + Math.exp(-(.35 - .55) * 10));
  expect(evaluate(source.samples[0], neutral, 0, false)[0]).toBeCloseTo(.35 * (1 + shadow) * (1 + highlight), 6);
});
