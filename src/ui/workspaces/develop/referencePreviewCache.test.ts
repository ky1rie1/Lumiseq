import { describe, expect, it } from 'vitest';
import { ReferencePreviewCache, referencePreviewKey } from './referencePreviewCache';

const settings = { exposure: 0, whiteBalance: { mode: 'as-shot' } };
const key = (overrides: Partial<Parameters<typeof referencePreviewKey>[0]> = {}) => referencePreviewKey({
  documentId: 'photo', assetId: 'source', nativeAssetId: 'raw', referenceId: 'original',
  width: 800, height: 600, cpuFallback: false, referenceSettings: settings, ...overrides,
});

describe('reference preview reuse', () => {
  it('skips the fixed comparison while the live photo changes, and repaints for source, size or reference changes', async () => {
    const cache = new ReferencePreviewCache<object>();
    const canvas = {};
    let paints = 0;
    const paint = async () => { paints++; };
    await cache.paintIfNeeded(key(), canvas, paint, () => true);
    await cache.paintIfNeeded(key(), canvas, paint, () => true);
    expect(paints).toBe(1);
    for (const changed of [
      { assetId: 'another-source' }, { nativeAssetId: 'another-raw' },
      { width: 400 }, { referenceId: 'snapshot' },
      { referenceSettings: { ...settings, exposure: 1 } }, { cpuFallback: true },
    ]) await cache.paintIfNeeded(key(changed), canvas, paint, () => true);
    expect(paints).toBe(7);
    await cache.paintIfNeeded(key(), {}, paint, () => true);
    expect(paints).toBe(8);
  });

  it('does not cache a stale or failed render, so the next job repaints', async () => {
    const cache = new ReferencePreviewCache<object>();
    const canvas = {};
    let finish!: () => void;
    let current = true;
    let paints = 0;
    await cache.paintIfNeeded('prior', canvas, async () => { paints++; }, () => current);
    const first = cache.paintIfNeeded(key(), canvas, async () => {
      paints++;
      await new Promise<void>(resolve => { finish = resolve; });
    }, () => current);
    current = false;
    finish();
    expect(await first).toBe(false);
    current = true;
    await cache.paintIfNeeded('prior', canvas, async () => { paints++; }, () => current);
    expect(paints).toBe(3);
    cache.invalidate();
    await expect(cache.paintIfNeeded('failed', canvas, async () => { throw new Error('render failed'); }, () => current)).rejects.toThrow('render failed');
    await cache.paintIfNeeded(key(), canvas, async () => { paints++; }, () => current);
    expect(paints).toBe(4);
  });

  it('stores the resolved CPU key when GPU rendering falls back during the paint', async () => {
    const cache = new ReferencePreviewCache<object>();
    const canvas = {};
    let cpuFallback = false;
    let paints = 0;
    await cache.paintIfNeeded(key({ cpuFallback }), canvas, async () => {
      paints++;
      cpuFallback = true;
    }, () => true, () => key({ cpuFallback }));
    await cache.paintIfNeeded(key({ cpuFallback }), canvas, async () => { paints++; }, () => true);
    expect(paints).toBe(1);
  });
});
