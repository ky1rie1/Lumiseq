import { describe, it, expect } from 'vitest';
import { fitPreviewDimensions } from './previewDimensions';
describe('develop preview proportions', () => {
  it.each([[6000,4000,1620,1080],[3000,6000,540,1080],[8000,1000,1920,240],[400,300,400,300]])('fits %sx%s without stretching', (w,h,expectedW,expectedH) => {
    expect(fitPreviewDimensions(w,h)).toEqual({width:expectedW,height:expectedH});
  });
});
describe('preview quality policy', () => {
  it('reduces economy pixels while keeping the full photo proportions', () => {
    expect(fitPreviewDimensions(6000, 4000, 'economy')).toEqual({ width: 1080, height: 720 });
    expect(fitPreviewDimensions(6000, 4000, 'high')).toEqual({ width: 2430, height: 1620 });
  });
  it('uses smaller auto previews during interaction and finishes at normal precision', () => {
    expect(fitPreviewDimensions(6000, 4000, 'auto', true)).toEqual({ width: 1080, height: 720 });
    expect(fitPreviewDimensions(6000, 4000, 'auto', false)).toEqual({ width: 1620, height: 1080 });
  });
  it('never upscales tiny photos or accepts invalid dimensions', () => {
    expect(fitPreviewDimensions(400, 300, 'high')).toEqual({ width: 400, height: 300 });
    expect(fitPreviewDimensions(NaN, 30, 'high')).toEqual({ width: 1, height: 1 });
  });
});
