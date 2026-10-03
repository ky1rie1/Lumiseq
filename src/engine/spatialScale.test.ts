import { describe, expect, it } from 'vitest';
import { spatialPreviewPixelScale, spatialSourcePixelScale, spatialSourceHalo } from './spatialScale';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';

describe('RAW spatial radius coordinates', () => {
  it('adds native wavelet support to downstream detail support and no longer needs a local haze halo',()=>{
    const s=createDefaultDevelopSettings(true);s.renderingVersion=1;s.dehaze=100;
    expect(spatialSourceHalo(s,6000,4000)).toBe(0);
    s.detail.lumaDenoise=100;s.clarity=100;
    expect(spatialSourceHalo(s,6000,4000)).toBe(14+Math.ceil(8*4000/1080)+1);
  });
  it('sums sequential guided and Gaussian supports in original source pixels for version two',()=>{
    const s=createDefaultDevelopSettings(true);s.clarity=40;s.texture=35;s.detail.sharpenAmount=80;s.detail.sharpenRadius=1.8;s.detail.lumaDenoise=40;
    // Guided filters need two complete radii; sequential stages add their support.
    expect(spatialSourceHalo(s,6000,4000)).toBe(6+24+6+14);
    expect(spatialSourceHalo(s,800,600)).toBe(50);
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
