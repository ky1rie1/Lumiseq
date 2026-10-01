import { describe, expect, it } from 'vitest';
import { AssetManager } from '../src/assets/AssetManager';
import { createDefaultDevelopSettings } from '../src/document/DevelopDocument';
import { buildNativeDevelopPayload, getUnsupportedNativeDevelopFeatures } from '../src/app/nativeDevelopPayload';
import { resolveAutomaticWhiteBalance } from '../src/engine/developColorMath';

describe('native RAW develop payload', () => {
  it('exports the persisted auto matrix without reanalysis and blocks unresolved auto', async () => {
    const settings = createDefaultDevelopSettings(true);
    settings.whiteBalance = { mode: 'auto', resolvedAuto: resolveAutomaticWhiteBalance(
      Array.from({ length: 100 }, () => [.24, .2, .17])) };
    const roundTrip = JSON.parse(JSON.stringify(settings));
    expect(getUnsupportedNativeDevelopFeatures(roundTrip, true)).toEqual([]);
    const payload = await buildNativeDevelopPayload(roundTrip, new AssetManager());
    expect((payload as unknown as { white_balance_matrix: number[] }).white_balance_matrix).toEqual(
      [.2/.24, 0, 0, 0, 1, 0, 0, 0, .2/.17]);
    settings.whiteBalance = { mode: 'auto' };
    await expect(buildNativeDevelopPayload(settings, new AssetManager())).rejects.toThrow(/解析/);
  });
  it('includes the local mask pixels and adjustments at export time', async () => {
    const assets = new AssetManager();
    const mask = await assets.registerMask(new Uint8ClampedArray([0, 64, 128, 255]), 2, 2, 'gradient');
    const settings = createDefaultDevelopSettings(true);
    settings.masks = [{
      id: 'mask-1', name: 'gradient', maskAssetId: mask.id, kind: 'linear',
      geometry: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      inverted: false, opacity: 0.7, exposure: 1.2, contrast: 20,
    }];
    const payload = await buildNativeDevelopPayload(settings, assets);
    expect(payload.masks).toEqual([{ width: 2, height: 2, bytes: [0, 64, 128, 255], inverted: false, opacity: 0.7, exposure: 1.2, contrast: 20, highlights: 0, shadows: 0, temperature: 0, saturation: 0 }]);
  });

  it('rejects missing masks and reports unsupported changed adjustments', async () => {
    const assets = new AssetManager();
    const settings = createDefaultDevelopSettings(true);
    settings.masks = [{ id: 'lost', name: 'lost', maskAssetId: 'missing', kind: 'radial', geometry: {}, inverted: false, opacity: 1 }];
    await expect(buildNativeDevelopPayload(settings, assets)).rejects.toThrow('lost');
    settings.masks = [];
    settings.texture = 20;
    expect(getUnsupportedNativeDevelopFeatures(settings, true)).toEqual([]);
    settings.texture = 0;
    settings.whiteBalance.mode = 'auto';
    expect(getUnsupportedNativeDevelopFeatures(settings, true)).toContain('自动白平衡');
  });

  it('passes non-spatial color and vignette controls to original-resolution export', async () => {
    const settings = createDefaultDevelopSettings(true);
    settings.whites = 35;
    settings.blacks = -20;
    settings.vibrance = 28;
    settings.hsl.blue = { hue: 30, saturation: 40, luminance: -20 };
    settings.curves.rgb = [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }];
    settings.optics = { vignetteAmount: -45, vignetteMidpoint: 65 };

    expect(getUnsupportedNativeDevelopFeatures(settings, true)).toEqual([]);
    const payload = await buildNativeDevelopPayload(settings, new AssetManager());
    expect(payload).toMatchObject({
      whites: 35, blacks: -20, vibrance: 28,
      vignette_amount: -45, vignette_midpoint: 65,
    });
    expect(payload.hsl).toHaveLength(8);
    expect(payload.hsl?.[5]).toEqual([9, 1.4, -0.1]);
    expect(payload.curve_lut).toHaveLength(4096);
    expect(payload.curve_lut?.[512 * 4]).toBeGreaterThan(0.6);
  });

  it('passes supported spatial adjustments to the native renderer', async () => {
    const settings = createDefaultDevelopSettings(true);
    settings.texture = 10;
    settings.clarity = 10;
    settings.dehaze = 10;
    settings.detail.sharpenAmount = 25;
    settings.detail.lumaDenoise = 15;
    expect(getUnsupportedNativeDevelopFeatures(settings, true)).toEqual([]);
    const payload = await buildNativeDevelopPayload(settings, new AssetManager());
    expect(payload).toMatchObject({
      texture: 10, clarity: 10, dehaze: 10,
      sharpen_amount: 25, luma_denoise: 15,
    });
  });
});
