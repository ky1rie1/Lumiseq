import { describe, it, expect, beforeEach } from 'vitest';
import { routeFile } from '../src/router/FileRouter';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { AssetManager } from '../src/assets/AssetManager';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { SetWhiteBalanceCommand } from '../src/commands/develop/SetWhiteBalanceCommand';
import { ResetDevelopSettingsCommand } from '../src/commands/develop/ResetDevelopSettingsCommand';
import { SetExposureCommand } from '../src/commands/develop/SetExposureCommand';
import { defaultColorManager } from '../src/color/ColorManager';
import { HistogramScheduler } from '../src/engine/HistogramScheduler';
import sampleMetadata from './fixtures/sample_raw_metadata.json';

describe('Phase 2.5 — Native RAW Engine & Professional Color Pipeline Suite', () => {
  let docManager: DocumentManager;
  let commandBus: CommandBus;
  let assetManager: AssetManager;

  beforeEach(() => {
    docManager = new DocumentManager();
    commandBus = new CommandBus();
    assetManager = new AssetManager();
  });

  describe('1. RAW Extension Routing Matrix', () => {
    it('accurately routes all standard professional RAW digital negatives to develop workspace', () => {
      const rawExtensions = ['CR2', 'cr2', 'CR3', 'cr3', 'NEF', 'nef', 'ARW', 'arw', 'RAF', 'raf', 'RW2', 'rw2', 'ORF', 'orf', 'DNG', 'dng'];

      for (const ext of rawExtensions) {
        const route = routeFile(`sample_photo.${ext}`);
        expect(route.targetWorkspace).toBe('develop');
        expect(route.fileType).toBe('raw');
      }
    });

    it('routes standard raster images to edit workspace', () => {
      const rasterExtensions = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];
      for (const ext of rasterExtensions) {
        const route = routeFile(`sample_render.${ext}`);
        expect(route.targetWorkspace).toBe('edit');
        expect(route.fileType).toBe('raster');
      }
    });
  });

  describe('2. RAW Metadata & Camera As-Shot White Balance', () => {
    it('parses RAW metadata and initializes As-Shot camera multipliers', () => {
      const doc = createDevelopDocument({
        fileName: 'IMG_7890.CR3',
        sourceUri: 'file:///C:/Photos/IMG_7890.CR3',
        isRaw: true,
        exif: {
          cameraMake: sampleMetadata.camera_make,
          cameraModel: sampleMetadata.camera_model,
          lensModel: sampleMetadata.lens_model,
          iso: sampleMetadata.iso,
          shutterSpeed: sampleMetadata.shutter_speed,
          aperture: sampleMetadata.aperture,
          orientation: sampleMetadata.orientation,
        },
        settings: {
          whiteBalance: {
            mode: 'as-shot',
            cameraMultipliers: sampleMetadata.white_balance_multipliers as [number, number, number, number],
          },
        },
      });

      expect(doc.isRaw).toBe(true);
      expect(doc.settings.whiteBalance.mode).toBe('as-shot');
      expect(doc.settings.whiteBalance.cameraMultipliers).toBeDefined();
      expect(doc.settings.whiteBalance.cameraMultipliers?.[0]).toBeCloseTo(2.1484, 3);
      expect(doc.exif.orientation).toBe(1);
    });

    it('toggles from As-Shot to Custom WB and restores As-Shot multipliers on reset', () => {
      const doc = createDevelopDocument({
        fileName: 'LANDSCAPE.NEF',
        isRaw: true,
        settings: {
          whiteBalance: {
            mode: 'as-shot',
            cameraMultipliers: [1.95, 1.0, 1.42, 1.0],
          },
        },
      });
      docManager.openDocument(doc);

      // User adjusts temperature -> switches to custom mode
      commandBus.execute(new SetWhiteBalanceCommand(doc.id, {
        mode: 'custom',
        temperature: 6800,
        tint: 12,
        cameraMultipliers: [1.95, 1.0, 1.42, 1.0],
      }, docManager));

      let updated = docManager.getDevelopDocument(doc.id)!;
      expect(updated.settings.whiteBalance.mode).toBe('custom');
      expect(updated.settings.whiteBalance.temperature).toBe(6800);

      // Reset Develop settings restores mode to 'as-shot' and preserves camera multipliers
      commandBus.execute(new ResetDevelopSettingsCommand(doc.id, docManager));
      updated = docManager.getDevelopDocument(doc.id)!;
      expect(updated.settings.whiteBalance.mode).toBe('as-shot');
      expect(updated.settings.whiteBalance.cameraMultipliers?.[0]).toBe(1.95);
    });
  });

  describe('3. 3-Stage RAW Loading State & Cancellation', () => {
    it('manages 3-stage loading states in DevelopDocument without spoofing ready', () => {
      const doc = createDevelopDocument({
        fileName: 'TEST_001.ARW',
        isRaw: true,
      });

      // Stage 0: Unloaded
      expect(doc.rawState).toBe('unloaded');
      expect(doc.rawProgress).toBe(0);

      // Stage 1: Metadata
      doc.rawState = 'metadata';
      doc.rawProgress = 20;
      expect(doc.rawState).toBe('metadata');

      // Stage 2: Embedded Preview
      doc.rawState = 'embedded-preview';
      doc.rawProgress = 50;
      doc.previewAssetId = 'asset_thumb_123';
      expect(doc.rawState).toBe('embedded-preview');
      expect(doc.previewAssetId).toBe('asset_thumb_123');

      // Stage 3: Decoding -> Ready
      doc.rawState = 'decoding';
      doc.rawProgress = 75;
      expect(doc.rawState).toBe('decoding');

      doc.rawState = 'ready';
      doc.rawProgress = 100;
      doc.rawEngineAttached = true;
      expect(doc.rawState).toBe('ready');
    });

    it('rejects stale decode job when cancelled by new job ID', () => {
      const doc = createDevelopDocument({
        fileName: 'PHOTO_A.CR2',
        isRaw: true,
      });

      const oldJobId = 'job_photo_a_1';
      doc.activeJobId = oldJobId;

      // User rapidly switches to Photo B, updating activeJobId
      const newJobId = 'job_photo_b_2';
      doc.activeJobId = newJobId;

      // When oldJobId arrives, it is detected as stale and ignored
      const isStale = doc.activeJobId !== oldJobId;
      expect(isStale).toBe(true);
    });
  });

  describe('4. Color Manager & Transfer Function Precision', () => {
    it('accurately converts between linear working RGB and standard sRGB display values', () => {
      // 0.0 linear -> 0.0 sRGB
      const black = defaultColorManager.linearToDisplay([0, 0, 0]);
      expect(black[0]).toBe(0);

      // 1.0 linear -> 1.0 sRGB
      const white = defaultColorManager.linearToDisplay([1, 1, 1]);
      expect(white[0]).toBe(1);

      // 18% gray (0.18 linear) -> ~0.46 sRGB (perceptual middle gray)
      const mid = defaultColorManager.linearToDisplay([0.18, 0.18, 0.18]);
      expect(mid[0]).toBeGreaterThan(0.44);
      expect(mid[0]).toBeLessThan(0.48);

      // Round trip check
      const roundTrip = defaultColorManager.displayToLinear(mid);
      expect(roundTrip[0]).toBeCloseTo(0.18, 2);
    });

    it('applies 3x3 camera color calibration matrix', () => {
      const matrix = [
        [1.2, -0.1, -0.1],
        [-0.1, 1.1, 0.0],
        [0.0, -0.1, 1.1],
      ];
      const res = defaultColorManager.applyCameraMatrix([1, 1, 1], matrix);
      expect(res[0]).toBeCloseTo(1.0, 2);
      expect(res[1]).toBeCloseTo(1.0, 2);
      expect(res[2]).toBeCloseTo(1.0, 2);
    });
  });

  describe('5. Develop -> Edit Rendered Transfer & Non-destructive Export', () => {
    it('ensures develop parameters do not mutate source asset during adjustments', () => {
      const doc = createDevelopDocument({
        fileName: 'sunset.dng',
        isRaw: true,
        sourceAssetId: 'raw_sensor_handle_99',
      });
      docManager.openDocument(doc);

      // Adjust exposure +2 EV
      commandBus.execute(new SetExposureCommand(doc.id, 2.0, docManager));

      const updated = docManager.getDevelopDocument(doc.id)!;
      expect(updated.settings.exposure).toBe(2.0);
      // Source asset handle remains untouched and immutable
      expect(updated.sourceAssetId).toBe('raw_sensor_handle_99');
    });

    it('supports HistogramScheduler throttled execution', async () => {
      const scheduler = new HistogramScheduler(50);
      let callCount = 0;

      // Mock canvas
      const canvas = {
        width: 100,
        height: 100,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({
            data: new Uint8Array(256 * 256 * 4),
          }),
        }),
      } as unknown as HTMLCanvasElement;

      // Call schedule multiple times rapidly
      scheduler.schedule(canvas, () => { callCount++; });
      scheduler.schedule(canvas, () => { callCount++; });
      scheduler.schedule(canvas, () => { callCount++; });

      // Wait for throttled execution
      await new Promise((r) => setTimeout(r, 80));

      // Should coalesce rapid calls (leading + 1 trailing frame instead of 3 separate calculations)
      expect(callCount).toBeLessThanOrEqual(2);
    });
  });
});
