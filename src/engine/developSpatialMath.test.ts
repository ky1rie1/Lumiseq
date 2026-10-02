import { describe, expect, it } from 'vitest';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';
import { applySpatialPixel } from './developSpatialMath';

describe('linear CPU spatial reference', () => {
  it('preserves signed and HDR flat fields with active detail',()=>{
    const settings=createDefaultDevelopSettings(true); settings.texture=80; settings.clarity=60;
    settings.detail.sharpenAmount=100;
    const rgb=Float32Array.from(Array.from({length:25},()=>[-.125,1.5,.000001]).flat());
    const result=applySpatialPixel(rgb,5,5,2,2,settings);
    expect(result[0]).toBeCloseTo(-.125,6);expect(result[1]).toBeCloseTo(1.5,6);
    expect(result[2]).toBeCloseTo(.000001,10);
  });
  it('matches the hand-computed USM edge in native export', () => {
    const settings = createDefaultDevelopSettings(false);
    settings.detail.sharpenAmount = 100;
    const rgb = Float32Array.from([.25,.25,.25,.25,.25,.25,.7,.7,.7,.7,.7,.7,.7,.7,.7]);
    for (const value of applySpatialPixel(rgb, 5, 1, 2, 0, settings, 1)) expect(value).toBeCloseTo(.80125, 6);
  });
  it('keeps flat fields neutral when denoise and detail are combined', () => {
    const settings = createDefaultDevelopSettings(false);
    settings.texture = 80; settings.clarity = 80;
    settings.detail = { sharpenAmount: 100, sharpenRadius: 1.2, sharpenThreshold: 0, lumaDenoise: 100, chromaDenoise: 100 };
    const rgb = new Float32Array(25 * 3).fill(.3);
    for (const value of applySpatialPixel(rgb, 5, 5, 0, 0, settings, 2.7)) expect(value).toBeCloseTo(.3, 6);
  });
});
