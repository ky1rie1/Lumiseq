import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isResolvedAutoWhiteBalance, resolveAutomaticWhiteBalance } from '../src/engine/developColorMath';

const directory = process.env.LUMISEQ_RAW_REPORT_DIR;
it.skipIf(!directory)('resolves the production AWB matrix from native real-camera samples', () => {
  const samples = JSON.parse(readFileSync(join(directory!, 'samples.json'), 'utf8'));
  expect(samples.length).toBeGreaterThan(0);
  expect(samples.length).toBeLessThanOrEqual(16384);
  const result = resolveAutomaticWhiteBalance(samples);
  expect(isResolvedAutoWhiteBalance(result)).toBe(true);
  if (result.status === 'as-shot-fallback') {
    expect(result.matrix).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
  writeFileSync(join(directory!, 'resolved-auto.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
});
