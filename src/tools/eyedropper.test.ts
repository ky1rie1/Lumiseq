import { afterEach, describe, expect, it } from 'vitest';
import { EyedropperTool } from './eyedropper';
import { defaultColorState } from '../color/colorState';

const sampler = new EyedropperTool();
const image = (width: number, pixels: number[][]) => ({ width, height: pixels.length / width, data: new Uint8ClampedArray(pixels.flat()) }) as ImageData;
afterEach(() => defaultColorState.resetColors());

describe('exact pixel sampling', () => {
  const patches = image(3, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
  it('samples the pixel containing the document coordinate instead of the entire image', () => {
    expect(sampler.sampleColor({ source: patches, x: 1.9, y: 0.8 }).hex).toBe('#00ff00');
  });
  it('clips a centered averaging window at the left border without shifting it', () => {
    expect(sampler.sampleColor({ source: patches, x: 0, y: 0, sampleSize: 3 }).hex).toBe('#808000');
  });
  it('weights semitransparent pixels by their coverage when averaging', () => {
    const source = image(2, [[255, 0, 0, 255], [0, 0, 255, 1]]);
    expect(sampler.sampleColor({ source, x: 0, y: 0, sampleSize: 3 }).hex).toBe('#fe0001');
  });
  it('reads the same centered window through a canvas context', () => {
    const source = { canvas: { width: 3, height: 1 }, getImageData: (x: number, y: number, w: number, h: number) => {
      expect([x, y, w, h]).toEqual([0, 0, 2, 1]);
      return image(2, [[255, 0, 0, 255], [0, 255, 0, 255]]);
    } } as unknown as CanvasRenderingContext2D;
    expect(sampler.sampleColor({ source, x: 0.8, y: 0, sampleSize: 3 }).hex).toBe('#808000');
  });
  it('does not replace the foreground when clicking outside the image or on empty pixels', () => {
    defaultColorState.setForeground('#123456');
    for (const x of [-0.1, 3, NaN]) {
      expect(() => sampler.sampleColor({ source: patches, x, y: 0, updateColorState: true })).toThrow();
    }
    expect(() => sampler.sampleColor({ source: image(1, [[0, 0, 0, 0]]), x: 0, y: 0, updateColorState: true })).toThrow();
    expect(defaultColorState.getState().foreground).toBe('#123456');
  });
});
