import { expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeAutoTone } from '../src/develop/autoTone';
import { applyBaseTone, linearToSrgb, srgbToLinear } from '../src/engine/developColorMath';

const directory = process.env.LUMISEQ_RAW_REPORT_DIR;

it.skipIf(!directory)('measures automatic tone on a decoded real-camera RAW overview', async () => {
  const source = await loadImage(readFileSync(join(directory!, 'neutral-overview.png')));
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, source.width, source.height);
  const patch = computeAutoTone(image.data);
  expect(patch).not.toBeNull();
  const before: number[] = [];
  const after: number[] = [];
  let oldClips = 0;
  let newClips = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (!image.data[i + 3]) continue;
    const channels: [number, number, number] = [image.data[i], image.data[i + 1], image.data[i + 2]]
      .map(value => srgbToLinear(value / 255)) as [number, number, number];
    const output = applyBaseTone(channels, patch!);
    if (Math.max(...channels) >= srgbToLinear(.98)) oldClips++;
    if (Math.max(...output) >= srgbToLinear(.98)) newClips++;
    if ((i / 4) % 16 === 0) {
      before.push((channels[0] + channels[1] + channels[2]) / 3);
      after.push((output[0] + output[1] + output[2]) / 3);
    }
    image.data[i] = Math.round(linearToSrgb(output[0]) * 255);
    image.data[i + 1] = Math.round(linearToSrgb(output[1]) * 255);
    image.data[i + 2] = Math.round(linearToSrgb(output[2]) * 255);
  }
  before.sort((a, b) => a - b);
  after.sort((a, b) => a - b);
  context.putImageData(image, 0, 0);
  writeFileSync(join(directory!, 'auto-tone-preview.png'), canvas.toBuffer('image/png'));
  const report = {
    input: 'neutral-overview.png', size: [source.width, source.height], patch,
    medianLinearBefore: before[Math.floor(before.length / 2)],
    medianLinearAfter: after[Math.floor(after.length / 2)],
    originalNearClips: oldClips, adjustedNearClips: newClips,
  };
  writeFileSync(join(directory!, 'auto-tone-report.json'), JSON.stringify(report, null, 2));
  expect(Object.values(patch!).every(Number.isFinite)).toBe(true);
  expect(newClips).toBeLessThanOrEqual(oldClips + Math.floor(source.width * source.height * .005));
});
