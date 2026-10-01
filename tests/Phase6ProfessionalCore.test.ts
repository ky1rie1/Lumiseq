// tests/Phase6ProfessionalCore.test.ts
//! Comprehensive Test Suite for Phase 6 — Professional Editing Core
//! Tests Photoshop blend modes, adjustments, brush engine, retouching, groups, smart objects,
//! transforms, PSD reader, project serialization, autosave, and Canonical Tools.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installPixelCanvas } from '../src/engine/editPixelTestCanvas';
import { blendColors, BlendMode } from '../src/engine/blendModes';
import { AdjustmentEngine } from '../src/engine/adjustments';
import { BrushEngine } from '../src/brush/BrushEngine';
import { RetouchEngine } from '../src/brush/RetouchEngine';
import { defaultEyedropper } from '../src/tools/eyedropper';
import { defaultGradientRenderer } from '../src/tools/gradient';
import { defaultSmartObjectManager } from '../src/smartobject/SmartObjectManager';
import { PsdReader } from '../src/psd/psdReader';
import { ProjectSerializer } from '../src/project/ProjectSerializer';
import { AutosaveManager, type RecoveryEntry } from '../src/project/AutosaveManager';
import { TransformCommand } from '../src/commands/edit/TransformCommand';
import { SetCropRectCommand, ResizeCanvasCommand, ResizeImageCommand } from '../src/commands/edit/CropCommand';
import { CreateGroupCommand, MoveToGroupCommand } from '../src/commands/edit/GroupCommands';
import { SetAdjustmentSettingsCommand } from '../src/commands/edit/SetAdjustmentSettingsCommand';
import { DocumentManager, defaultDocumentManager } from '../src/document/DocumentManager';
import { AssetManager, defaultAssetManager } from '../src/assets/AssetManager';
import { defaultCommandBus } from '../src/history/CommandBus';
import { defaultToolRegistry } from '../src/ai/tools/ToolRegistry';
import { IToolContext } from '../src/ai/tools/CanonicalTool';
import {
  createEditDocument,
  createPaintLayer,
  createAdjustmentLayer,
  createSmartObjectLayer,
  createGroupLayer,
  findLayerById,
  flattenLayerTree,
  updateLayerInTree,
  removeLayerFromTree
} from '../src/document/EditDocument';
import { defaultColorState } from '../src/color/colorState';
import { EditDocument, PaintLayer, AdjustmentLayer, SmartObjectLayer, GroupLayer } from '../src/types/edit';

describe('Phase 6 — Professional Editing Core Test Suite', () => {
  let doc: EditDocument;

  beforeEach(async () => {
    defaultCommandBus.clearHistory();
    defaultAssetManager.clearRuntimeCache();

    doc = createEditDocument({
      name: 'Phase6 Canvas',
      width: 100,
      height: 100,
    });
    defaultDocumentManager.openDocument(doc, true);
  });

  // --------------------------------------------------------------------------
  // 1. Blend Modes Math (All 16 Photoshop Blend Modes)
  // --------------------------------------------------------------------------
  describe('1. Blend Modes Math', () => {
    const allModes: BlendMode[] = [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
    ];

    it('implements all 16 Photoshop blend modes without NaN or out-of-bound values', () => {
      const top = { r: 180, g: 70, b: 210, a: 0.8 };
      const bottom = { r: 50, g: 120, b: 80, a: 1.0 };

      for (const mode of allModes) {
        const result = blendColors(top, bottom, mode);
        expect(result.r).toBeGreaterThanOrEqual(0);
        expect(result.r).toBeLessThanOrEqual(255);
        expect(result.g).toBeGreaterThanOrEqual(0);
        expect(result.g).toBeLessThanOrEqual(255);
        expect(result.b).toBeGreaterThanOrEqual(0);
        expect(result.b).toBeLessThanOrEqual(255);
        expect(result.a).toBeGreaterThanOrEqual(0);
        expect(result.a).toBeLessThanOrEqual(1.0);
        expect(Number.isNaN(result.r)).toBe(false);
        expect(Number.isNaN(result.g)).toBe(false);
        expect(Number.isNaN(result.b)).toBe(false);
      }
    });

    it('computes exact values for standard blend mode definitions', () => {
      // Multiply: (top * bottom) / 255
      // 128 * 128 / 255 ~= 64.25
      const mult = blendColors({ r: 128, g: 128, b: 128, a: 1 }, { r: 128, g: 128, b: 128, a: 1 }, 'multiply');
      expect(Math.round(mult.r)).toBe(64);

      // Screen: 255 - ((255 - top) * (255 - bottom)) / 255
      const scr = blendColors({ r: 128, g: 128, b: 128, a: 1 }, { r: 128, g: 128, b: 128, a: 1 }, 'screen');
      expect(Math.round(scr.r)).toBe(192);

      // Difference: |bottom - top|
      const diff = blendColors({ r: 200, g: 100, b: 50, a: 1 }, { r: 50, g: 100, b: 150, a: 1 }, 'difference');
      expect(Math.round(diff.r)).toBe(150);
      expect(Math.round(diff.g)).toBe(0);
      expect(Math.round(diff.b)).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Adjustment Engine
  // --------------------------------------------------------------------------
  describe('2. Adjustment Engine Evaluation', () => {
    it('applies exposure adjustments linearly', () => {
      const buffer = new Uint8ClampedArray([100, 100, 100, 255]);
      AdjustmentEngine.applyExposure(buffer, { exposure: 1.0, offset: 0, gamma: 1.0 }); // +1 EV = 2x
      expect(buffer[0]).toBe(200);
      expect(buffer[1]).toBe(200);
      expect(buffer[2]).toBe(200);
      expect(buffer[3]).toBe(255); // Alpha preserved
    });

    it('applies brightness and contrast with midpoint at 128', () => {
      const buffer = new Uint8ClampedArray([128, 64, 192, 255]);
      AdjustmentEngine.applyBrightnessContrast(buffer, { brightness: 20, contrast: 30 });
      // Brightness shifts values, contrast expands around midpoint
      expect(buffer[0]).toBeGreaterThan(128);
      expect(buffer[3]).toBe(255);
    });

    it('applies hue and saturation adjustments', () => {
      const buffer = new Uint8ClampedArray([255, 0, 0, 255]); // Pure red
      AdjustmentEngine.applyHueSaturation(buffer, { hue: 120, saturation: 0, lightness: 0 }); // Shift 120 deg to green
      expect(buffer[1]).toBeGreaterThan(200); // Green dominant
      expect(buffer[0]).toBeLessThan(50);
    });

    it('applies levels mapping black and white points', () => {
      const buffer = new Uint8ClampedArray([50, 128, 200, 255]);
      AdjustmentEngine.applyLevels(buffer, { inputBlack: 50, inputWhite: 200, inputGamma: 1.0, outputBlack: 0, outputWhite: 255 });
      expect(buffer[0]).toBe(0); // 50 mapped to black (0)
      expect(buffer[2]).toBe(255); // 200 mapped to white (255)
    });

    it('applies black and white grayscale conversion using custom weights', () => {
      const buffer = new Uint8ClampedArray([255, 0, 0, 255]); // Pure red
      AdjustmentEngine.applyBlackAndWhite(buffer, { reds: 100, greens: 0, blues: 0, yellows: 0, cyans: 0, magentas: 0 });
      expect(buffer[0]).toBe(buffer[1]);
      expect(buffer[1]).toBe(buffer[2]); // R=G=B
    });

    it('applies smooth Catmull-Rom curves evaluation', () => {
      const buffer = new Uint8ClampedArray([64, 128, 192, 255]);
      // S-curve points
      AdjustmentEngine.applyCurves(buffer, {
        rgb: [{ x: 0, y: 0 }, { x: 64, y: 32 }, { x: 192, y: 224 }, { x: 255, y: 255 }]
      });
      expect(buffer[0]).toBeLessThanOrEqual(40); // Dark tones darkened
      expect(buffer[2]).toBeGreaterThanOrEqual(210); // Bright tones brightened
    });
  });

  // --------------------------------------------------------------------------
  // 3. Brush Engine & Rule 2 (Single-Undo Step Command Generation)
  // --------------------------------------------------------------------------
  describe('3. Brush Engine', () => {
    it('generates exactly ONE undoable command for a multi-point stroke (Rule 2)', async () => {
      const paintLayer = createPaintLayer({ name: 'Sketch Layer' });
      doc.layers.push(paintLayer);

      const engine = new BrushEngine();
      expect(engine.isPainting).toBe(false);

      // Start stroke at (10, 10)
      await engine.startStroke({
        documentId: doc.id,
        layerId: paintLayer.id,
        initialPoint: { x: 10, y: 10 },
        settings: { size: 10, color: '#ff0000', opacity: 1.0 },
        initialAssetId: paintLayer.rasterAssetId,
        width: 100,
        height: 100,
      });
      expect(engine.isPainting).toBe(true);

      // Add multiple drag points
      for (let i = 11; i <= 50; i++) {
        engine.addPoint({ x: i, y: i, pressure: 1.0 });
      }

      // 40 points added, but NO commands dispatched yet
      expect(defaultCommandBus.getHistory().length).toBe(0);

      // End stroke commits gesture
      const cmd = await engine.endStroke(defaultCommandBus, defaultDocumentManager);
      expect(engine.isPainting).toBe(false);
      expect(cmd).not.toBeNull();

      // Exactly ONE command committed to history
      const history = defaultCommandBus.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].name).toBe('Brush Stroke');

      // Undo and Redo equivalence
      defaultCommandBus.undo();
      expect(defaultCommandBus.canRedo()).toBe(true);
      defaultCommandBus.redo();
      expect(defaultCommandBus.getHistory().length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Retouch Engine (Clone Stamp, Healing, Spot Healing)
  // --------------------------------------------------------------------------
  describe('4. Retouch Engine', () => {
    it('manages clone stamp source point correctly', () => {
      const retouch = new RetouchEngine();
      expect(retouch.getSourcePoint()).toBeNull();

      retouch.setSourcePoint({ x: 35, y: 45 });
      expect(retouch.getSourcePoint()).toEqual({ x: 35, y: 45 });

      retouch.beginStroke({ x: 50, y: 50 });
      retouch.endStroke();
      expect(retouch.getSourcePoint()).toEqual({ x: 35, y: 45 }); // Source persists across strokes
    });

    it('performs spot healing perimeter reconstruction on canvas context', () => {
      const retouch = new RetouchEngine();
      const width = 50;
      const height = 50;
      const buffer = new Uint8ClampedArray(width * height * 4);
      // Fill with background color (100, 100, 100)
      for (let i = 0; i < buffer.length; i += 4) {
        buffer[i] = 100;
        buffer[i + 1] = 100;
        buffer[i + 2] = 100;
        buffer[i + 3] = 255;
      }
      // Place dark blemish at center (25, 25)
      const blemishIdx = (25 * width + 25) * 4;
      buffer[blemishIdx] = 10;
      buffer[blemishIdx + 1] = 10;
      buffer[blemishIdx + 2] = 10;

      const mockCtx = {
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(buffer),
        }),
        putImageData: (imgData: any) => {
          buffer.set(imgData.data);
        },
      } as unknown as CanvasRenderingContext2D;

      const rect = retouch.applySpotHealing({
        ctx: mockCtx,
        center: { x: 25, y: 25 },
        settings: { size: 12, opacity: 1.0 },
      });

      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Group Layer Hierarchy
  // --------------------------------------------------------------------------
  describe('5. Group Layer Tree Hierarchy', () => {
    it('creates nested group layers and flattens tree correctly', () => {
      const layer1 = createPaintLayer({ name: 'Base Paint' });
      const layer2 = createAdjustmentLayer({ name: 'Levels 1', adjustmentType: 'levels' });
      const group1 = createGroupLayer({ name: 'Characters', children: [layer1, layer2] });
      const layer3 = createPaintLayer({ name: 'Background' });

      doc.layers = [layer3, group1];

      const flattened = flattenLayerTree(doc.layers);
      expect(flattened.length).toBe(4);
      expect(flattened.map((l) => l.name)).toContain('Base Paint');
      expect(flattened.map((l) => l.name)).toContain('Levels 1');
      expect(flattened.map((l) => l.name)).toContain('Characters');
      expect(flattened.map((l) => l.name)).toContain('Background');
    });

    it('finds and updates layers inside nested groups', () => {
      const child = createPaintLayer({ name: 'Deep Child' });
      const subGroup = createGroupLayer({ name: 'Inner Group', children: [child] });
      const rootGroup = createGroupLayer({ name: 'Outer Group', children: [subGroup] });
      doc.layers = [rootGroup];

      const found = findLayerById(doc.layers, child.id);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Deep Child');

      const updated = updateLayerInTree(doc.layers, child.id, (l) => ({ ...l, opacity: 0.5 }));
      const foundUpdated = findLayerById(updated, child.id);
      expect(foundUpdated?.opacity).toBe(0.5);

      const pruned = removeLayerFromTree(updated, child.id);
      expect(findLayerById(pruned, child.id)).toBeNull();
    });

    it('moves layers between groups using MoveToGroupCommand with full undo/redo', () => {
      const layerA = createPaintLayer({ name: 'Layer A', rasterAssetId: 'layer-a-pixels', width: 20, height: 10 });
      const groupA = createGroupLayer({ name: 'Folder 1', children: [] });
      doc.layers = [layerA, groupA];

      const cmd = new MoveToGroupCommand(doc.id, layerA.id, groupA.id, defaultDocumentManager);
      defaultCommandBus.execute(cmd);

      const current = defaultDocumentManager.getEditDocument(doc.id)!;
      let targetGroup = findLayerById(current.layers, groupA.id) as GroupLayer;
      expect(targetGroup.children.some((c) => c.id === layerA.id)).toBe(true);

      defaultCommandBus.undo();
      const afterUndo = defaultDocumentManager.getEditDocument(doc.id)!;
      targetGroup = findLayerById(afterUndo.layers, groupA.id) as GroupLayer;
      expect(targetGroup.children.some((c) => c.id === layerA.id)).toBe(false);

      defaultCommandBus.redo();
      const afterRedo = defaultDocumentManager.getEditDocument(doc.id)!;
      targetGroup = findLayerById(afterRedo.layers, groupA.id) as GroupLayer;
      expect(targetGroup.children.some((c) => c.id === layerA.id)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Smart Object & RAW Round-Trip
  // --------------------------------------------------------------------------
  describe('6. Smart Object & RAW Round-Trip', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('converts layer to smart object and updates develop parameters non-destructively', () => {
      const smartObj = createSmartObjectLayer({
        name: 'RAW Photo',
        sourceAssetId: 'preview_001',
        embeddedAssetId: 'asset_raw_001',
        sourceRawUri: 'photos/landscape.arw',
        developSettings: {
          exposure: 0,
          temperature: 5500,
          tint: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          contrast: 0,
          saturation: 0,
          clarity: 0,
          sharpness: 0,
        },
      });
      doc.layers.push(smartObj);

      const data = defaultSmartObjectManager.getDevelopRoundTripData(doc, smartObj.id);
      expect(data).not.toBeNull();
      expect(data?.rawUri).toBe('photos/landscape.arw');
      expect(data?.developSettings?.temperature).toBe(5500);

      // Update via updateSmartObject
      defaultSmartObjectManager.updateSmartObject({
        documentId: doc.id,
        layerId: smartObj.id,
        newSettings: { ...smartObj.developSettings!, exposure: 1.5, temperature: 6200 },
        newAssetId: 'rendered_preview_002',
        commandBus: defaultCommandBus,
        documentManager: defaultDocumentManager,
      });

      const updated = defaultDocumentManager.getEditDocument(doc.id)!;
      const updatedSO = findLayerById(updated.layers, smartObj.id) as SmartObjectLayer;
      expect(updatedSO.developSettings?.exposure).toBe(1.5);
      expect(updatedSO.developSettings?.temperature).toBe(6200);
      expect(updatedSO.sourceAssetId).toBe('rendered_preview_002');
      expect(updatedSO.embeddedAssetId).toBe('asset_raw_001'); // source preserved
    });

    it('rasterizes smart object into standard paint layer', async () => {
      const create = installPixelCanvas();
      const source = create(2, 2);
      const context = source.getContext('2d')!;
      context.fillStyle = '#4080c0'; context.fillRect(0, 0, 2, 2);
      const blob = await new Promise<Blob>(resolve => source.toBlob(value => resolve(value!)));
      const asset = await defaultAssetManager.registerBlob(blob, 'image', 'Smart Layer source', { width: 2, height: 2 });
      const smartObj = createSmartObjectLayer({
        name: 'Smart Layer',
        sourceAssetId: asset.id,
        embeddedAssetId: asset.id,
        originalWidth: 2,
        originalHeight: 2,
      });
      doc.layers.push(smartObj);

      await defaultSmartObjectManager.rasterize(doc.id, smartObj.id, defaultCommandBus, defaultDocumentManager);
      const current = defaultDocumentManager.getEditDocument(doc.id)!;
      const rasterized = findLayerById(current.layers, smartObj.id)!;
      expect(rasterized.type).toBe('paint');
      expect(rasterized.name).toContain('Smart Layer');
      expect('rasterAssetId' in rasterized).toBe(true);
      expect(defaultAssetManager.hasAsset((rasterized as PaintLayer).rasterAssetId)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Transform & Crop Commands
  // --------------------------------------------------------------------------
  describe('7. Transform & Crop Commands', () => {
    it('executes TransformCommand with full undo/redo', () => {
      const layer = createPaintLayer({ name: 'Transformable' });
      doc.layers.push(layer);

      const cmd = new TransformCommand(
        doc.id,
        layer.id,
        { x: 50, y: 80, scaleX: 1.5, scaleY: 1.5, rotation: 45 },
        defaultDocumentManager
      );
      defaultCommandBus.execute(cmd);

      let current = defaultDocumentManager.getEditDocument(doc.id)!;
      let currentLayer = findLayerById(current.layers, layer.id)!;
      expect(currentLayer.transform.x).toBe(50);
      expect(currentLayer.transform.y).toBe(80);
      expect(currentLayer.transform.scaleX).toBe(1.5);
      expect(currentLayer.transform.rotation).toBe(45);

      // Undo
      defaultCommandBus.undo();
      current = defaultDocumentManager.getEditDocument(doc.id)!;
      currentLayer = findLayerById(current.layers, layer.id)!;
      expect(currentLayer.transform.x).toBe(0);
      expect(currentLayer.transform.rotation).toBe(0);

      // Redo
      defaultCommandBus.redo();
      current = defaultDocumentManager.getEditDocument(doc.id)!;
      currentLayer = findLayerById(current.layers, layer.id)!;
      expect(currentLayer.transform.x).toBe(50);
      expect(currentLayer.transform.rotation).toBe(45);
    });

    it('executes SetCropRectCommand and ResizeCanvasCommand', () => {
      // Set crop rect
      const cropCmd = new SetCropRectCommand(doc.id, { x: 10, y: 10, width: 80, height: 80 }, defaultDocumentManager);
      defaultCommandBus.execute(cropCmd);
      let current = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(current.cropRect).toEqual({ x: 10, y: 10, width: 80, height: 80 });

      defaultCommandBus.undo();
      current = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(current.cropRect).toBeNull();

      // Resize canvas with center anchor
      const resizeCmd = new ResizeCanvasCommand(doc.id, 200, 200, 'center', defaultDocumentManager);
      defaultCommandBus.execute(resizeCmd);
      current = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(current.width).toBe(200);
      expect(current.height).toBe(200);

      defaultCommandBus.undo();
      current = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(current.width).toBe(100);
      expect(current.height).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // 8. PSD Binary Reader (MVP Header & Record Parsing)
  // --------------------------------------------------------------------------
  describe('8. PSD Binary Reader', () => {
    it('parses valid 8BPS header into document structure', () => {
      // Construct minimal valid 26-byte PSD header
      const buffer = new ArrayBuffer(26);
      const view = new DataView(buffer);

      // Signature: '8BPS' (0x38425053)
      view.setUint32(0, 0x38425053, false);
      // Version: 1
      view.setUint16(4, 1, false);
      // Reserved: 6 bytes 0 (bytes 6-11)
      // Channels: 3 (RGB)
      view.setUint16(12, 3, false);
      // Height: 64
      view.setUint32(14, 64, false);
      // Width: 128
      view.setUint32(18, 128, false);
      // Depth: 8 bits
      view.setUint16(22, 8, false);
      // ColorMode: 3 (RGB)
      view.setUint16(24, 3, false);

      const header = PsdReader.readHeader(view);

      expect(header.signature).toBe('8BPS');
      expect(header.version).toBe(1);
      expect(header.channels).toBe(3);
      expect(header.width).toBe(128);
      expect(header.height).toBe(64);
      expect(header.depth).toBe(8);
      expect(header.colorMode).toBe(3);
    });

    it('rejects corrupt or non-PSD file headers', () => {
      const buffer = new ArrayBuffer(26);
      const view = new DataView(buffer);
      view.setUint32(0, 0x46494c45, false); // 'FILE' instead of '8BPS'

      expect(() => PsdReader.readHeader(view)).toThrow(/Invalid PSD signature/);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Project Serialization & Autosave
  // --------------------------------------------------------------------------
  describe('9. Project Serialization & Autosave', () => {
    it('bundles document JSON and assets into .aistudio archive', async () => {
      const asset = await defaultAssetManager.registerBlob(new Blob(['pixels']), 'image', 'Archive pixels', {width:100,height:100});
      const layer = createPaintLayer({ name: 'Archive Layer', rasterAssetId:asset.id, width:100, height:100 });
      doc.layers.push(layer);

      const serializer = new ProjectSerializer();
      const projectJson = await serializer.serialize(doc, defaultAssetManager);
      expect(typeof projectJson).toBe('string');
      expect(projectJson.length).toBeGreaterThan(0);

      const restored = await serializer.deserialize(projectJson, defaultDocumentManager, defaultAssetManager);
      expect(restored.id).toBe(doc.id);
      expect(restored.name).toBe(doc.name);
      expect(restored.layers.length).toBe(doc.layers.length);
      expect(restored.layers[0].name).toBe('Archive Layer');
    });

    it('saves and recovers autosaves cleanly', async () => {
      const entries = new Map<string, RecoveryEntry>();
      const store = {
        put: async (entry: RecoveryEntry) => { entries.set(entry.documentId, structuredClone(entry)); },
        list: async () => [...entries.values()],
        remove: async (id: string) => { entries.delete(id); },
      };
      const documents = new DocumentManager();
      documents.openDocument({ ...doc, isDirty: true });
      const autosave = new AutosaveManager(documents, 30000, new AssetManager(), store);
      await autosave.performAutosave();
      const recoveries = await autosave.checkForRecovery();
      expect(recoveries).toHaveLength(1);
      const freshDocuments = new DocumentManager();
      const recovery = new AutosaveManager(freshDocuments, 30000, new AssetManager(), store);
      await recovery.restore(recoveries[0]);
      expect(freshDocuments.getEditDocument(doc.id)?.name).toBe(doc.name);
      expect(freshDocuments.getEditDocument(doc.id)?.isDirty).toBe(true);
      await recovery.discard(doc.id);
      expect(await recovery.checkForRecovery()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 10. Canonical Tools & MCP Integration for Phase 6
  // --------------------------------------------------------------------------
  describe('10. Canonical Tools & MCP Integration', () => {
    const toolCtx: IToolContext = {
      documentManager: defaultDocumentManager,
      commandBus: defaultCommandBus,
      currentWorkspace: 'edit',
    };

    it('executes edit_create_paint_layer via ToolRegistry', async () => {
      const tool = defaultToolRegistry.get('edit_create_paint_layer');
      expect(tool).toBeDefined();

      const res = await tool!.execute(
        toolCtx,
        { documentId: doc.id, name: 'Agent Paint Layer' },
        'call_paint_1'
      );

      expect(res.success).toBe(true);
      expect(res.renderRequired).toBe(true);
      const current = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(current.layers.some((l) => l.name === 'Agent Paint Layer')).toBe(true);

      // Verify command in CommandBus
      expect(defaultCommandBus.getHistory().some((c) => c.name.startsWith('Create Layer'))).toBe(true);
    });

    it('executes edit_create_adjustment_layer and edit_set_adjustment_settings', async () => {
      // 1. Create adjustment layer
      const createTool = defaultToolRegistry.get('edit_create_adjustment_layer');
      expect(createTool).toBeDefined();
      const resCreate = await createTool!.execute(
        toolCtx,
        { documentId: doc.id, adjustmentType: 'exposure', name: 'Agent Exposure' },
        'call_adj_1'
      );
      expect(resCreate.success).toBe(true);
      const current = defaultDocumentManager.getEditDocument(doc.id)!;
      const adjLayer = current.layers.find((l) => l.name === 'Agent Exposure') as AdjustmentLayer;
      expect(adjLayer).toBeDefined();

      // 2. Set adjustment settings
      const setTool = defaultToolRegistry.get('edit_set_adjustment_settings');
      expect(setTool).toBeDefined();
      const resSet = await setTool!.execute(
        toolCtx,
        { documentId: doc.id, layerId: adjLayer.id, settings: { exposure: 1.2, offset: 0.05, gamma: 1.0 } },
        'call_adj_2'
      );
      expect(resSet.success).toBe(true);
      const updated = defaultDocumentManager.getEditDocument(doc.id)!;
      const updatedAdj = findLayerById(updated.layers, adjLayer.id) as AdjustmentLayer;
      expect(updatedAdj.settings).toEqual({ exposure: 1.2, offset: 0.05, gamma: 1.0 });
    });

    it('executes edit_transform tool via ToolRegistry', async () => {
      const layer = createPaintLayer({ name: 'Scale Me' });
      doc.layers.push(layer);

      const tool = defaultToolRegistry.get('edit_transform');
      expect(tool).toBeDefined();
      const res = await tool!.execute(
        toolCtx,
        { documentId: doc.id, layerId: layer.id, transform: { x: 25, y: 35, scaleX: 2.0 } },
        'call_tr_1'
      );
      expect(res.success).toBe(true);
      const current = defaultDocumentManager.getEditDocument(doc.id)!;
      const currentLayer = findLayerById(current.layers, layer.id)!;
      expect(currentLayer.transform.x).toBe(25);
      expect(currentLayer.transform.y).toBe(35);
      expect(currentLayer.transform.scaleX).toBe(2.0);
    });

    it('reports unavailable pixels through edit_sample_color instead of a placeholder in a non-canvas environment', async () => {
      const tool = defaultToolRegistry.get('edit_sample_color');
      expect(tool).toBeDefined();
      const res = await tool!.execute(
        toolCtx,
        { documentId: doc.id, x: 50, y: 50, sampleSize: 3 },
        'call_color_1'
      );
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('SOURCE_UNAVAILABLE');
      expect(res.after).toBeUndefined();
    });
  });
});
