import { expect, it } from 'vitest';
import { cutoutPreviewLayout } from './cutoutPreviewLayout';

it('fits a tall preview inside a short desktop window without cropping', () => {
  const result = cutoutPreviewLayout(600, 1200, 640, 480, 1);
  expect(result.width).toBe(216);
  expect(result.height).toBe(432);
  expect(result.contentWidth).toBe(640);
  expect(result.contentHeight).toBe(480);
});
it('keeps magnified image edges reachable through a scrollable surface', () => {
  const result = cutoutPreviewLayout(1000, 500, 648, 448, 4);
  expect(result.width).toBe(2400);
  expect(result.height).toBe(1200);
  expect(result.contentWidth).toBe(2448);
  expect(result.contentHeight).toBe(1248);
});
