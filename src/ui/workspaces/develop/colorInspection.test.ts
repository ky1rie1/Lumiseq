import { describe, expect, it } from 'vitest';
import { clippingOverlay, previewPixelAt, srgb8ToLabD50 } from './colorInspection';

describe('display color observation', () => {
  it('classifies output endpoints, excludes transparent pixels and preserves source', () => {
    const rgba = new Uint8ClampedArray([254,20,30,255, 1,1,0,128, 255,255,255,0, 20,40,60,255]);
    const before = rgba.slice();
    const result = clippingOverlay(rgba, true, true);
    expect(result.highlights).toBe(1); expect(result.shadows).toBe(1); expect(result.sampled).toBe(3);
    expect(result.rgba[3]).toBeGreaterThan(0); expect(result.rgba[7]).toBeGreaterThan(0);
    expect(result.rgba[11]).toBe(0); expect(result.rgba[15]).toBe(0); expect(rgba).toEqual(before);
  });
  it('maps actual screen bounds to discrete pixels with right/bottom exclusive', () => {
    const bounds = { left:100, top:200, width:80, height:40 };
    expect(previewPixelAt(140,220,bounds,400,200)).toEqual({x:200,y:100});
    expect(previewPixelAt(100,200,bounds,400,200)).toEqual({x:0,y:0});
    expect(previewPixelAt(180,240,bounds,400,200)).toBeNull();
    expect(previewPixelAt(99,220,bounds,400,200)).toBeNull();
    expect(previewPixelAt(120,220,{...bounds,width:0},400,200)).toBeNull();
  });
  it('uses sRGB transfer and Bradford D50 adaptation, not gamma 2.2 or D65 Lab', () => {
    const white = srgb8ToLabD50([255,255,255]);
    expect(white[0]).toBeCloseTo(100,3); expect(white[1]).toBeCloseTo(0,2); expect(white[2]).toBeCloseTo(0,2);
    expect(srgb8ToLabD50([0,0,0])).toEqual([0,0,0]);
    const red = srgb8ToLabD50([255,0,0]);
    expect(red[0]).toBeCloseTo(54.2917,2); expect(red[1]).toBeCloseTo(80.8125,2); expect(red[2]).toBeCloseTo(69.8851,2);
    expect(srgb8ToLabD50([128,128,128])[0]).toBeCloseTo(53.585,2);
  });
});
