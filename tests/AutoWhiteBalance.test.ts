import { describe, expect, it } from 'vitest';
import * as math from '../src/engine/developColorMath';
import { migrateDevelopSettings } from '../src/migrations/developSettingsMigration';

const resolve = (samples: number[][]) => (math as unknown as {
  resolveAutomaticWhiteBalance: (rgb: number[][]) => { matrix: number[]; status: string; confidence: number; sampleCount: number; candidateCount: number };
}).resolveAutomaticWhiteBalance(samples);
const repeat = (rgb: number[], count = 100) => Array.from({ length: count }, () => [...rgb]);

describe('postdecode automatic white balance', () => {
  it('resolves a mildly cast neutral patch into a persisted matrix', () => {
    const result = resolve(repeat([.24, .2, .17]));
    expect(result.status).toBe('resolved');
    expect(result.confidence).toBeGreaterThan(.5);
    const balanced = math.applyRelativeWhiteBalance([.24, .2, .17], result.matrix);
    expect(balanced[0]).toBeCloseTo(balanced[1], 6);
    expect(balanced[2]).toBeCloseTo(balanced[1], 6);
    expect(math.luminance(balanced)).toBeCloseTo(math.luminance([.24, .2, .17]), 6);
    expect(math.relativeWhiteBalanceMatrix({ mode: 'auto', resolvedAuto: JSON.parse(JSON.stringify(result)) } as never)).toEqual(result.matrix);
  });

  it('retains as-shot colors for a strongly single-colored scene', () => {
    const result = resolve(repeat([.65, .07, .025]));
    expect(result.status).toBe('as-shot-fallback');
    expect(result.matrix).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('excludes dark, clipped, invalid and insufficient samples', () => {
    const result = resolve([...repeat([.001, .002, .001]), ...repeat([1, .9, .8]), [NaN, .3, .3]]);
    expect(result.status).toBe('as-shot-fallback');
    expect(result.candidateCount).toBe(0);
    expect(resolve([[.2, .2, .2]]).status).toBe('as-shot-fallback');
  });

  it('rejects an absent or nonfinite persisted matrix', () => {
    expect(() => math.relativeWhiteBalanceMatrix({ mode: 'auto' })).toThrow();
    expect(() => math.relativeWhiteBalanceMatrix({ mode: 'auto', resolvedAuto: { matrix: Array(9).fill(NaN) } } as never)).toThrow();
  });

  it('preserves the resolved correction through actual document settings migration', () => {
    const resolvedAuto = resolve(repeat([.24, .2, .17]));
    const loaded = migrateDevelopSettings(JSON.parse(JSON.stringify({ whiteBalance: { mode: 'auto', resolvedAuto } })), true);
    expect((loaded.whiteBalance as unknown as { resolvedAuto: unknown }).resolvedAuto).toEqual(resolvedAuto);
    expect(math.relativeWhiteBalanceMatrix(loaded.whiteBalance)).toEqual(resolvedAuto.matrix);
  });
});
