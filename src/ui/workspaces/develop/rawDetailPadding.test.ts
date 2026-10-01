import { describe, expect, it } from 'vitest';
import { paddedRawDetailRegion } from './rawDetailPadding';

describe('RAW detail neighborhood padding', () => {
  it('reads surrounding pixels and keeps the display rectangle in image coordinates', () => {
    expect(paddedRawDetailRegion({ x: 300, y: 200, width: 1000, height: 800 }, 6000, 4000, 40)).toEqual({
      display: { x: 300, y: 200, width: 1000, height: 800 },
      read: { x: 260, y: 160, width: 1080, height: 880 },
    });
  });
  it('clamps padding at real image edges and honors native tile limits', () => {
    const padded = paddedRawDetailRegion({ x: 0, y: 0, width: 4096, height: 1464 }, 6000, 4000, 48);
    expect(padded.read.x).toBe(0);
    expect(padded.read.y).toBe(0);
    expect(padded.read.width).toBeLessThanOrEqual(4096);
    expect(padded.read.width * padded.read.height).toBeLessThanOrEqual(6_000_000);
    expect(padded.read.x + padded.read.width).toBeGreaterThanOrEqual(padded.display.x + padded.display.width + 48);
  });
});
