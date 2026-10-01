// tests/DevelopSettingsMigration.test.ts
import { describe, it, expect } from 'vitest';
import { migrateDevelopSettings } from '../src/migrations/developSettingsMigration';

describe('DevelopSettingsMigration (v1/v2 -> v3 & NaN safety)', () => {
  it('should upgrade empty or null settings to version 3 defaults', () => {
    const migrated = migrateDevelopSettings(null, true);
    expect(migrated.version).toBe(3);
    expect(migrated.exposure).toBe(0);
    expect(migrated.detail.sharpenAmount).toBe(0);
    expect(migrated.optics.vignetteAmount).toBe(0);
    expect(migrated.whiteBalance.mode).toBe('as-shot');
  });

  it('should preserve v1 values while populating v2 detail and optics defaults', () => {
    const v1Settings = {
      exposure: 1.5,
      contrast: 20,
      highlights: -30,
      shadows: 40,
      whites: 10,
      blacks: -5,
      whiteBalance: { mode: 'custom', temperature: 6200, tint: 10 },
      saturation: 15,
    };

    const migrated = migrateDevelopSettings(v1Settings, false);
    expect(migrated.version).toBe(3);
    expect(migrated.exposure).toBe(1.5);
    expect(migrated.contrast).toBe(20);
    expect(migrated.highlights).toBe(-30);
    expect(migrated.shadows).toBe(40);
    expect(migrated.whiteBalance.temperature).toBe(6200);
    expect(migrated.detail).toBeDefined();
    expect(migrated.detail.sharpenRadius).toBe(1.0);
    expect(migrated.optics).toBeDefined();
    expect(migrated.optics.vignetteMidpoint).toBe(50);
  });

  it('should sanitize NaN and out-of-range values safely', () => {
    const dirty = {
      exposure: NaN,
      contrast: Infinity,
      highlights: 'invalid',
      whiteBalance: {
        mode: 'custom',
        temperature: 999999, // Should clamp to 12000
        tint: -999,          // Should clamp to -150
      },
      detail: {
        sharpenAmount: NaN,
      },
    };

    const migrated = migrateDevelopSettings(dirty, true);
    expect(migrated.exposure).toBe(0.0);
    expect(migrated.contrast).toBe(0);
    expect(migrated.highlights).toBe(0);
    expect(migrated.whiteBalance.temperature).toBe(12000);
    expect(migrated.whiteBalance.tint).toBe(-150);
    expect(migrated.detail.sharpenAmount).toBe(0);
  });
});
