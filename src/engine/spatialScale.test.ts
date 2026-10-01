import { describe, expect, it } from 'vitest';
import { spatialPreviewPixelScale, spatialSourcePixelScale, spatialSourceHalo } from './spatialScale';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';

describe('RAW spatial radius coordinates', () => {
  it('adds native wavelet support to downstream detail support and no longer needs a local haze halo',()=>{
    const s=createDefaultDevelopSettings(true);s.dehaze=100;
    expect(spatialSourceHalo(s,6000,4000)).toBe(0);
    s.detail.lumaDenoise=100;s.clarity=100;
    expect(spatialSourceHalo(s,6000,4000)).toBe(14+Math.ceil(8*4000/1080)+1);
  });
  it('keeps the standard overview at one filter pixel while detail uses source pixels', () => {
    const source = spatialSourcePixelScale(6000, 4000);
    expect(source).toBeCloseTo(4000 / 1080, 5);
    expect(spatialPreviewPixelScale(6000, 4000, 1620, 1080)).toBeCloseTo(1, 5);
    expect(spatialPreviewPixelScale(6000, 4000, 1000, 667, 1000)).toBeCloseTo(source, 5);
  });

  it('does not magnify radii on images smaller than the standard preview', () => {
    expect(spatialSourcePixelScale(800, 600)).toBe(1);
    expect(spatialPreviewPixelScale(800, 600, 800, 600)).toBe(1);
  });
});
