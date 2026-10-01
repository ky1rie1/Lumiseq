import { describe, expect, it, vi } from 'vitest';
import { RawSpatialAnalysisCache, spatialBasePayload } from './rawSpatialAnalysis';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';

const profile = { version: 1 as const, source_width: 64, source_height: 64,
  noise: [.01,.02,.02] as [number,number,number],
  haze: { version: 1 as const, width: 1, height: 1, atmosphere: [.8,.9,1] as [number,number,number], coefficients: [0,.3] } };

describe('whole-source RAW spatial analysis cache', () => {
  it('deduplicates analysis and excludes downstream controls from its key', async () => {
    const cache = new RawSpatialAnalysisCache(2), settings = createDefaultDevelopSettings(true);
    const load = vi.fn(async () => profile);
    const a = cache.get('raw-a',settings,load);
    settings.dehaze = 70; settings.detail.lumaDenoise = 80; settings.saturation = 50;
    const b = cache.get('raw-a',settings,load);
    expect(await a).toBe(await b); expect(load).toHaveBeenCalledTimes(1);
    settings.exposure = 1;
    await cache.get('raw-a',settings,load);
    expect(load).toHaveBeenCalledTimes(2);
    await cache.get('raw-b',settings,load);
    await cache.get('raw-a',createDefaultDevelopSettings(true),load);
    expect(load).toHaveBeenCalledTimes(4);
  });
  it('never sends masks or curves and rejects malformed profiles without caching failures', async () => {
    const cache = new RawSpatialAnalysisCache(), settings = createDefaultDevelopSettings(true);
    expect(spatialBasePayload(settings).masks).toEqual([]);
    const load = vi.fn(async () => ({ ...profile,noise: [NaN,0,0] as [number,number,number] }));
    await expect(cache.get('x',settings,load)).rejects.toThrow('spatial');
    await expect(cache.get('x',settings,load)).rejects.toThrow('spatial');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
