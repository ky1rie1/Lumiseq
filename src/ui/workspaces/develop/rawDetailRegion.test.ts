import { describe, expect, it } from 'vitest';
import { computeRawDetailRegion } from './rawDetailRegion';

describe('RAW full-detail viewport region', () => {
  it('does not fetch native pixels while the fitted preview has enough samples', () => {
    expect(computeRawDetailRegion(6000, 4000, 1200, 800, 0.2, 0, 0, 1920, 1280)).toBeNull();
  });

  it('requests original pixels around the visible 100% area with a small margin', () => {
    expect(computeRawDetailRegion(6000, 4000, 1200, 800, 1, 0, 0, 1920, 1280)).toEqual({ x: 2368, y: 1568, width: 1264, height: 864 });
  });

  it('moves in source coordinates as the user pans and stays within the image', () => {
    const region = computeRawDetailRegion(6000, 4000, 1200, 800, 1, 150, 0, 1920, 1280);
    expect(region?.x).toBe(2218);
    const edge = computeRawDetailRegion(6000, 4000, 1200, 800, 1, 3000, 2200, 1920, 1280);
    expect(edge).not.toBeNull();
    expect(edge!.x).toBeGreaterThanOrEqual(0);
    expect(edge!.y).toBeGreaterThanOrEqual(0);
    expect(edge!.x + edge!.width).toBeLessThanOrEqual(6000);
    expect(edge!.y + edge!.height).toBeLessThanOrEqual(4000);
  });

  it('bounds a large desktop viewport to the device-safe tile budget', () => {
    const region = computeRawDetailRegion(8000, 6000, 5000, 3200, 1, 0, 0, 2048, 1536);
    expect(region).not.toBeNull();
    expect(region!.width).toBeLessThanOrEqual(4096);
    expect(region!.height).toBeLessThanOrEqual(4096);
    expect(region!.width * region!.height).toBeLessThanOrEqual(6_000_000);
  });
});
