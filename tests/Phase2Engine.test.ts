// tests/Phase2Engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { AssetManager } from '../src/assets/AssetManager';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { createEditDocument, createImageLayer, createTextLayer } from '../src/document/EditDocument';

// Develop Commands
import { SetTemperatureCommand } from '../src/commands/develop/SetTemperatureCommand';
import { SetTintCommand } from '../src/commands/develop/SetTintCommand';
import { SetSaturationCommand } from '../src/commands/develop/SetSaturationCommand';
import { ResetDevelopSettingsCommand } from '../src/commands/develop/ResetDevelopSettingsCommand';
import { SetExposureCommand } from '../src/commands/develop/SetExposureCommand';
import { SetContrastCommand } from '../src/commands/develop/SetContrastCommand';

// Edit Commands
import { MoveLayerCommand } from '../src/commands/edit/MoveLayerCommand';
import { ScaleLayerCommand } from '../src/commands/edit/ScaleLayerCommand';
import { RotateLayerCommand } from '../src/commands/edit/RotateLayerCommand';
import { DeleteLayerCommand } from '../src/commands/edit/DeleteLayerCommand';
import { ToggleLayerVisibilityCommand } from '../src/commands/edit/ToggleLayerVisibilityCommand';
import { SetLayerBlendModeCommand } from '../src/commands/edit/SetLayerBlendModeCommand';

// Histogram
import { computeHistogramFromImageData } from '../src/engine/histogram';

describe('Phase 2 — Real Image Engine & Command Precision Suite', () => {
  let docManager: DocumentManager;
  let commandBus: CommandBus;
  let assetManager: AssetManager;

  beforeEach(() => {
    docManager = new DocumentManager();
    commandBus = new CommandBus();
    assetManager = new AssetManager();
  });

  describe('1. Asset Engine Precision & Reference Integrity', () => {
    it('registers binary image asset, tracks dimensions, and isolates memory from React state', async () => {
      // Mock binary blob
      const rawData = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
      const blob = new Blob([rawData], { type: 'image/png' });

      const handle = await assetManager.registerBlob(blob, 'image', 'test_sample.png', {
        width: 1920,
        height: 1080,
      });

      expect(handle.id).toMatch(/^asset_/);
      expect(handle.width).toBe(1920);
      expect(handle.height).toBe(1080);
      expect(handle.sizeBytes).toBe(blob.size);

      // Verify Blob is retrievable intact
      const retrievedBlob = await assetManager.getBlob(handle.id);
      expect(retrievedBlob).not.toBeNull();
      expect(retrievedBlob?.size).toBe(blob.size);

      // Verify reference counting
      assetManager.acquireRef(handle.id);
      assetManager.releaseAsset(handle.id);
      expect(assetManager.hasAsset(handle.id)).toBe(true);

      assetManager.releaseAsset(handle.id);
      expect(assetManager.hasAsset(handle.id)).toBe(false);
    });
  });

  describe('2. Develop Commands & Photographic Parameter Scale', () => {
    it('mutates Temperature and Tint with undo/redo restoring As-Shot White Balance', () => {
      const doc = createDevelopDocument({
        fileName: 'RAW_001.CR3',
        isRaw: true,
        sourceRawUri: 'file:///C:/Photos/RAW_001.CR3',
      });
      docManager.openDocument(doc);

      // Initial state is as-shot
      expect(doc.settings.whiteBalance.mode).toBe('as-shot');

      // 1. Set Temperature
      const tempCmd = new SetTemperatureCommand(doc.id, 6500, docManager);
      commandBus.execute(tempCmd);

      const updated1 = docManager.getDevelopDocument(doc.id)!;
      expect(updated1.settings.whiteBalance.mode).toBe('custom');
      expect(updated1.settings.whiteBalance.temperature).toBe(6500);

      // 2. Set Tint
      const tintCmd = new SetTintCommand(doc.id, 15, docManager);
      commandBus.execute(tintCmd);

      const updated2 = docManager.getDevelopDocument(doc.id)!;
      expect(updated2.settings.whiteBalance.tint).toBe(15);

      // Undo Tint
      commandBus.undo();
      const undoneTint = docManager.getDevelopDocument(doc.id)!;
      expect(undoneTint.settings.whiteBalance.tint).toBe(0);

      // Undo Temperature
      commandBus.undo();
      const undoneTemp = docManager.getDevelopDocument(doc.id)!;
      expect(undoneTemp.settings.whiteBalance.mode).toBe('as-shot');
    });

    it('mutates Saturation and resets all develop settings cleanly', () => {
      const doc = createDevelopDocument({
        fileName: 'landscape.arw',
        isRaw: true,
      });
      docManager.openDocument(doc);

      // Set exposure, contrast, saturation
      commandBus.execute(new SetExposureCommand(doc.id, 1.5, docManager));
      commandBus.execute(new SetContrastCommand(doc.id, 25, docManager));
      commandBus.execute(new SetSaturationCommand(doc.id, 30, docManager));

      const modified = docManager.getDevelopDocument(doc.id)!;
      expect(modified.settings.exposure).toBe(1.5);
      expect(modified.settings.contrast).toBe(25);
      expect(modified.settings.saturation).toBe(30);

      // Reset Develop Settings
      commandBus.execute(new ResetDevelopSettingsCommand(doc.id, docManager));
      const resetDoc = docManager.getDevelopDocument(doc.id)!;
      expect(resetDoc.settings.exposure).toBe(0.0);
      expect(resetDoc.settings.contrast).toBe(0);
      expect(resetDoc.settings.saturation).toBe(0);

      // Undo Reset restores all three modified values
      commandBus.undo();
      const restoredDoc = docManager.getDevelopDocument(doc.id)!;
      expect(restoredDoc.settings.exposure).toBe(1.5);
      expect(restoredDoc.settings.contrast).toBe(25);
      expect(restoredDoc.settings.saturation).toBe(30);
    });
  });

  describe('3. Edit Layer Commands & Geometry Transforms', () => {
    it('executes Move, Scale, Rotate, and Blend Mode commands with exact reversibility', () => {
      const layer1 = createImageLayer({
        id: 'layer_bg',
        name: 'Background',
        sourceAssetId: 'asset_bg',
        naturalWidth: 1920,
        naturalHeight: 1080,
      });

      const doc = createEditDocument({
        id: 'doc_edit_test',
        name: 'Poster',
        width: 1920,
        height: 1080,
        layers: [layer1],
      });
      docManager.openDocument(doc);

      // 1. Move Layer
      commandBus.execute(new MoveLayerCommand(doc.id, layer1.id, 150, 200, docManager));
      let curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers[0].transform.x).toBe(150);
      expect(curDoc.layers[0].transform.y).toBe(200);

      // 2. Scale Layer
      commandBus.execute(new ScaleLayerCommand(doc.id, layer1.id, 1.5, 1.5, docManager));
      curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers[0].transform.scaleX).toBe(1.5);
      expect(curDoc.layers[0].transform.scaleY).toBe(1.5);

      // 3. Rotate Layer
      commandBus.execute(new RotateLayerCommand(doc.id, layer1.id, 45, docManager));
      curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers[0].transform.rotation).toBe(45);

      // 4. Set Blend Mode
      commandBus.execute(new SetLayerBlendModeCommand(doc.id, layer1.id, 'multiply', docManager));
      curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers[0].blendMode).toBe('multiply');

      // Undo Blend Mode
      commandBus.undo();
      curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers[0].blendMode).toBe('normal');

      // Undo Rotate
      commandBus.undo();
      curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers[0].transform.rotation).toBe(0);

      // Undo Scale
      commandBus.undo();
      curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers[0].transform.scaleX).toBe(1);

      // Undo Move
      commandBus.undo();
      curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers[0].transform.x).toBe(0);
      expect(curDoc.layers[0].transform.y).toBe(0);
    });

    it('preserves exact layer stack index when deleting and undoing deletion', () => {
      const l1 = createImageLayer({ id: 'l1', name: 'L1', sourceAssetId: 'a1', naturalWidth: 100, naturalHeight: 100 });
      const l2 = createTextLayer({ id: 'l2', name: 'L2', text: 'Text in Middle' });
      const l3 = createImageLayer({ id: 'l3', name: 'L3', sourceAssetId: 'a3', naturalWidth: 100, naturalHeight: 100 });

      const doc = createEditDocument({
        id: 'doc_stack_test',
        layers: [l1, l2, l3], // Index 0: l1, Index 1: l2, Index 2: l3
      });
      docManager.openDocument(doc);

      // Delete the middle layer (l2 at index 1)
      commandBus.execute(new DeleteLayerCommand(doc.id, l2.id, docManager));
      let curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers.length).toBe(2);
      expect(curDoc.layers[0].id).toBe('l1');
      expect(curDoc.layers[1].id).toBe('l3');

      // Undo deletion: l2 MUST be restored back at index 1
      commandBus.undo();
      curDoc = docManager.getEditDocument(doc.id)!;
      expect(curDoc.layers.length).toBe(3);
      expect(curDoc.layers[0].id).toBe('l1');
      expect(curDoc.layers[1].id).toBe('l2');
      expect(curDoc.layers[2].id).toBe('l3');
    });

    it('toggles visibility of layer and reverses correctly', () => {
      const layer = createTextLayer({ id: 'l_vis', text: 'Visible Text' });
      const doc = createEditDocument({ id: 'doc_vis', layers: [layer] });
      docManager.openDocument(doc);

      expect(doc.layers[0].visible).toBe(true);

      commandBus.execute(new ToggleLayerVisibilityCommand(doc.id, layer.id, docManager));
      let cur = docManager.getEditDocument(doc.id)!;
      expect(cur.layers[0].visible).toBe(false);

      commandBus.undo();
      cur = docManager.getEditDocument(doc.id)!;
      expect(cur.layers[0].visible).toBe(true);
    });
  });

  describe('4. Real 256-bin Histogram Computation', () => {
    it('computes accurate 256-bin RGB and Luminance data from raw pixel buffer', () => {
      // Create a test 4x4 RGBA pixel buffer (16 pixels = 64 bytes)
      const pixelBuffer = new Uint8Array(4 * 4 * 4);

      // Fill with known pixels:
      // Pixel 0: Pure Red (255, 0, 0, 255)
      pixelBuffer[0] = 255;
      pixelBuffer[1] = 0;
      pixelBuffer[2] = 0;
      pixelBuffer[3] = 255;

      // Pixel 1: Pure Green (0, 255, 0, 255)
      pixelBuffer[4] = 0;
      pixelBuffer[5] = 255;
      pixelBuffer[6] = 0;
      pixelBuffer[7] = 255;

      // Pixel 2: Pure Blue (0, 0, 255, 255)
      pixelBuffer[8] = 0;
      pixelBuffer[9] = 0;
      pixelBuffer[10] = 255;
      pixelBuffer[11] = 255;

      // Pixel 3: White (255, 255, 255, 255)
      pixelBuffer[12] = 255;
      pixelBuffer[13] = 255;
      pixelBuffer[14] = 255;
      pixelBuffer[15] = 255;

      const histogram = computeHistogramFromImageData(pixelBuffer, pixelBuffer.length);

      // Verify all 4 channels have exactly 256 bins
      expect(histogram.r.length).toBe(256);
      expect(histogram.g.length).toBe(256);
      expect(histogram.b.length).toBe(256);
      expect(histogram.lum.length).toBe(256);

      // Red channel has values at 255 (from Pixel 0 and Pixel 3)
      expect(histogram.r[255]).toBeGreaterThanOrEqual(2);

      // Green channel has values at 255 (from Pixel 1 and Pixel 3)
      expect(histogram.g[255]).toBeGreaterThanOrEqual(2);

      // Blue channel has values at 255 (from Pixel 2 and Pixel 3)
      expect(histogram.b[255]).toBeGreaterThanOrEqual(2);

      // maxCount is positive and non-zero
      expect(histogram.maxCount).toBeGreaterThan(0);
    });
  });
});
