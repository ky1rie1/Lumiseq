import { expect, it } from 'vitest';
import { wheelZoomFactor, checkerStyle, initializeBrushSettings } from './canvasPreferences';
it('reverses zoom without changing speed and keeps zero wheel input still', () => {
  const normal = wheelZoomFactor(-100, 'normal', 'normal');
  const reverse = wheelZoomFactor(-100, 'reverse', 'normal');
  expect(normal).toBeGreaterThan(1);
  expect(reverse).toBeLessThan(1);
  expect(normal * reverse).toBeCloseTo(1);
  expect(wheelZoomFactor(0, 'normal', 'fast')).toBe(1);
});
it('orders slow, normal and fast zoom and scales smooth trackpad deltas', () => {
  expect(wheelZoomFactor(-100, 'normal', 'fast')).toBeGreaterThan(wheelZoomFactor(-100, 'normal', 'normal'));
  expect(wheelZoomFactor(-100, 'normal', 'normal')).toBeGreaterThan(wheelZoomFactor(-100, 'normal', 'slow'));
  expect(wheelZoomFactor(-1, 'normal', 'normal')).toBeLessThan(wheelZoomFactor(-100, 'normal', 'normal'));
});
it('initializes a fresh brush from preferences without changing existing brush state', () => {
  const old = initializeBrushSettings({ defaultBrushSize: 18, defaultBrushHardness: 0.2 });
  const fresh = initializeBrushSettings({ defaultBrushSize: 90, defaultBrushHardness: 0.9 });
  expect(old.size).toBe(18); expect(old.hardness).toBe(0.2);
  expect(fresh.size).toBe(90); expect(fresh.hardness).toBe(0.9);
});
it('produces distinct checker size and light/dark styles', () => {
  expect(checkerStyle('small', 'light').backgroundSize).toBe('12px 12px');
  expect(checkerStyle('large', 'dark').backgroundSize).toBe('40px 40px');
  expect(checkerStyle('medium', 'light').backgroundImage).not.toBe(checkerStyle('medium', 'dark').backgroundImage);
});
