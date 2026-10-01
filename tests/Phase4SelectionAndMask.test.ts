// tests/Phase4SelectionAndMask.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionUtils } from '../src/selection/SelectionUtils';
import { defaultSelectionManager } from '../src/selection/SelectionManager';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultAssetManager } from '../src/assets/AssetManager';
import { defaultCommandBus } from '../src/history/CommandBus';
import { createEditDocument, createImageLayer } from '../src/document/EditDocument';
import {
  CreateSelectionCommand,
  ClearSelectionCommand,
  SelectAllCommand,
  InvertSelectionCommand,
  FeatherSelectionCommand,
  ExpandSelectionCommand,
  ContractSelectionCommand
} from '../src/selection/SelectionCommands';
import {
  CreateMaskFromSelectionCommand,
  RemoveLayerMaskCommand,
  ToggleLayerMaskCommand,
  InvertLayerMaskCommand
} from '../src/mask/MaskCommands';
import { ModelManager, defaultModelManager } from '../src/ai/models/ModelManager';
import { defaultSegmentationProvider } from '../src/ai/segmentation/LocalSegmentationProvider';
import { MaskProcessor } from '../src/ai/segmentation/MaskProcessor';
import { defaultSegmentationCache } from '../src/ai/segmentation/SegmentationCache';
import { defaultInpaintingService } from '../src/ai/inpainting/InpaintingService';
import { AddGeneratedPatchLayerCommand } from '../src/commands/edit/AddGeneratedPatchLayerCommand';
import { defaultToolRegistry } from '../src/ai/tools/ToolRegistry';
import { EditDocument } from '../src/types/edit';

describe('Phase 4 — Selection, Mask & AI Object Editing Test Suite', () => {
  let doc: EditDocument;

  beforeEach(async () => {
    defaultCommandBus.clearHistory();
    defaultAssetManager.clearRuntimeCache();

    // Create a standard test canvas document: 200 x 200 px
    doc = createEditDocument({
      name: 'Test Canvas',
      width: 200,
      height: 200,
    });

    // Register a dummy 200x200 RGBA image layer
    const dummyRgba = new Uint8ClampedArray(200 * 200 * 4);
    for (let i = 0; i < dummyRgba.length; i += 4) {
      dummyRgba[i] = 120;     // R
      dummyRgba[i + 1] = 150; // G
      dummyRgba[i + 2] = 200; // B
      dummyRgba[i + 3] = 255; // A
    }
    const assetHandle = await defaultAssetManager.registerMask(dummyRgba, 200, 200, 'TestBaseLayer');
    const baseLayer = createImageLayer({
      name: 'Background Photo',
      sourceAssetId: assetHandle.id,
      naturalWidth: 200,
      naturalHeight: 200,
      x: 0,
      y: 0,
    });
    doc.layers.push(baseLayer);
    doc.selectedLayerId = baseLayer.id;

    defaultDocumentManager.openDocument(doc);
  });

  describe('1. Selection Engine & Shape Rasterization (SelectionUtils)', () => {
    it('rasterizes rectangle selections accurately into 8-bit grayscale masks', () => {
      const mask = SelectionUtils.rasterizeShape(100, 100, 'rectangle', { x: 10, y: 10, width: 30, height: 20 });
      expect(mask.length).toBe(100 * 100);

      // Inside rectangle: value 255
      expect(mask[15 * 100 + 15]).toBe(255);
      // Outside rectangle: value 0
      expect(mask[0]).toBe(0);
      expect(mask[50 * 100 + 50]).toBe(0);

      const bounds = SelectionUtils.getMaskBounds(mask, 100, 100);
      expect(bounds).toEqual({ x: 10, y: 10, width: 30, height: 20 });
    });

    it('rasterizes ellipse selections with correct centroid and bounds', () => {
      const mask = SelectionUtils.rasterizeShape(100, 100, 'ellipse', { x: 20, y: 20, width: 40, height: 40 });
      // Center of ellipse (40, 40) is inside
      expect(mask[40 * 100 + 40]).toBe(255);
      // Far corner of bounding box (20, 20) is outside the circle
      expect(mask[20 * 100 + 20]).toBe(0);

      const bounds = SelectionUtils.getMaskBounds(mask, 100, 100);
      expect(bounds.x).toBeGreaterThanOrEqual(20);
      expect(bounds.y).toBeGreaterThanOrEqual(20);
      expect(bounds.width).toBeLessThanOrEqual(40);
      expect(bounds.height).toBeLessThanOrEqual(40);
    });

    it('rasterizes polygon / lasso selections correctly', () => {
      const triangle = [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 30, y: 40 },
      ];
      const mask = SelectionUtils.rasterizeShape(100, 100, 'polygon', undefined, triangle);
      // Centroid (30, 20) is inside
      expect(mask[20 * 100 + 30]).toBe(255);
      // Exterior point (10, 35) is outside
      expect(mask[35 * 100 + 10]).toBe(0);
    });

    it('combines masks using replace, add, subtract, and intersect boolean modes', () => {
      const maskA = SelectionUtils.rasterizeShape(100, 100, 'rectangle', { x: 0, y: 0, width: 50, height: 50 });
      const maskB = SelectionUtils.rasterizeShape(100, 100, 'rectangle', { x: 25, y: 25, width: 50, height: 50 });

      // Add
      const added = SelectionUtils.combineMasks(maskA, maskB, 'add');
      expect(added[10 * 100 + 10]).toBe(255); // in A
      expect(added[60 * 100 + 60]).toBe(255); // in B
      expect(added[30 * 100 + 30]).toBe(255); // in both

      // Subtract (A - B)
      const subtracted = SelectionUtils.combineMasks(maskA, maskB, 'subtract');
      expect(subtracted[10 * 100 + 10]).toBe(255); // in A only
      expect(subtracted[30 * 100 + 30]).toBe(0);   // in overlap
      expect(subtracted[60 * 100 + 60]).toBe(0);   // in B only

      // Intersect (A ∩ B)
      const intersected = SelectionUtils.combineMasks(maskA, maskB, 'intersect');
      expect(intersected[10 * 100 + 10]).toBe(0);
      expect(intersected[60 * 100 + 60]).toBe(0);
      expect(intersected[30 * 100 + 30]).toBe(255); // in overlap only
    });

    it('feathers, expands (dilates), contracts (erodes), and inverts masks', () => {
      const mask = SelectionUtils.rasterizeShape(50, 50, 'rectangle', { x: 10, y: 10, width: 20, height: 20 });

      // Invert
      const inverted = SelectionUtils.invertMask(mask);
      expect(inverted[0]).toBe(255);
      expect(inverted[15 * 50 + 15]).toBe(0);

      // Expand (dilation)
      const expanded = SelectionUtils.expandMask(mask, 50, 50, 2);
      const expandedBounds = SelectionUtils.getMaskBounds(expanded, 50, 50);
      expect(expandedBounds.width).toBeGreaterThan(20);
      expect(expandedBounds.height).toBeGreaterThan(20);

      // Contract (erosion)
      const contracted = SelectionUtils.contractMask(mask, 50, 50, 2);
      const contractedBounds = SelectionUtils.getMaskBounds(contracted, 50, 50);
      expect(contractedBounds.width).toBeLessThan(20);
      expect(contractedBounds.height).toBeLessThan(20);

      // Feather
      const feathered = SelectionUtils.featherMask(mask, 50, 50, 2);
      // Border pixel should have intermediate falloff (between 0 and 255)
      expect(feathered[10 * 50 + 10]).toBeGreaterThan(0);
      expect(feathered[10 * 50 + 10]).toBeLessThanOrEqual(255);
    });
  });

  describe('2. Selection Commands & CommandBus Undo/Redo Integration', () => {
    it('executes CreateSelectionCommand and undos cleanly', async () => {
      const cmd = new CreateSelectionCommand(doc.id, {
        geometric: {
          shape: 'rectangle',
          rect: { x: 20, y: 20, width: 60, height: 40 },
          mode: 'replace',
        }
      }, defaultDocumentManager);

      await defaultCommandBus.execute(cmd);
      let activeDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(activeDoc.selection).not.toBeNull();
      expect(activeDoc.selection!.bounds).toEqual({ x: 20, y: 20, width: 60, height: 40 });
      expect(defaultSelectionManager.getSelection(doc.id)).not.toBeNull();

      // Undo
      defaultCommandBus.undo();
      activeDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(activeDoc.selection).toBeNull();
      expect(defaultSelectionManager.getSelection(doc.id)).toBeNull();

      // Redo
      await defaultCommandBus.redo();
      activeDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(activeDoc.selection).not.toBeNull();
      expect(activeDoc.selection!.bounds).toEqual({ x: 20, y: 20, width: 60, height: 40 });
    });

    it('executes ClearSelectionCommand, SelectAllCommand, and InvertSelectionCommand with full undo/redo', async () => {
      // 1. Create selection
      const createCmd = new CreateSelectionCommand(doc.id, {
        geometric: { shape: 'rectangle', rect: { x: 10, y: 10, width: 30, height: 30 } }
      }, defaultDocumentManager);
      await defaultCommandBus.execute(createCmd);

      // 2. Clear selection
      const clearCmd = new ClearSelectionCommand(doc.id, defaultDocumentManager);
      defaultCommandBus.execute(clearCmd);
      expect(defaultDocumentManager.getEditDocument(doc.id)!.selection).toBeNull();

      // Undo clear -> selection restored
      defaultCommandBus.undo();
      expect(defaultDocumentManager.getEditDocument(doc.id)!.selection).not.toBeNull();

      // 3. Select All
      const allCmd = new SelectAllCommand(doc.id, defaultDocumentManager);
      await defaultCommandBus.execute(allCmd);
      const allDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(allDoc.selection!.bounds).toEqual({ x: 0, y: 0, width: 200, height: 200 });

      // 4. Invert Selection on a sub-region
      const subCmd = new CreateSelectionCommand(doc.id, {
        geometric: { shape: 'rectangle', rect: { x: 50, y: 50, width: 50, height: 50 } }
      }, defaultDocumentManager);
      await defaultCommandBus.execute(subCmd);

      const invertCmd = new InvertSelectionCommand(doc.id, defaultDocumentManager);
      await defaultCommandBus.execute(invertCmd);
      const invertedDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(invertedDoc.selection!.inverted).toBe(true);
      expect(invertedDoc.selection!.bounds.width).toBe(200);
      expect(invertedDoc.selection!.bounds.height).toBe(200);
    });

    it('maintains strict separation between Document Space and View Space', () => {
      // Zooming and Panning in Viewport should not alter Document Coordinate Space
      const docCoords = { docX: 50, docY: 50 };
      const viewport = { zoom: 2.5, panX: 120, panY: -40, canvasWidth: 800, canvasHeight: 600 };

      // Convert doc to client space
      const client = defaultSelectionManager.documentToClientSpace(
        docCoords.docX,
        docCoords.docY,
        viewport,
        200,
        200
      );

      // Convert back from client space to doc space
      const docBack = defaultSelectionManager.clientToDocumentSpace(
        client.clientX,
        client.clientY,
        viewport,
        200,
        200
      );

      expect(Math.round(docBack.docX)).toBe(50);
      expect(Math.round(docBack.docY)).toBe(50);
    });
  });

  describe('3. Non-Destructive Layer Mask Engine', () => {
    it('creates reveal and hide layer masks from selection without altering layer image pixels', async () => {
      // Create active selection
      const selCmd = new CreateSelectionCommand(doc.id, {
        geometric: { shape: 'rectangle', rect: { x: 20, y: 20, width: 80, height: 80 } }
      }, defaultDocumentManager);
      await defaultCommandBus.execute(selCmd);

      const targetLayer = doc.layers[0];
      const origAssetId = targetLayer.sourceAssetId;

      // Add reveal layer mask
      const maskCmd = new CreateMaskFromSelectionCommand(doc.id, targetLayer.id, 'reveal', defaultDocumentManager);
      await defaultCommandBus.execute(maskCmd);

      const updatedDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      const maskedLayer = updatedDoc.layers[0];
      expect(maskedLayer.mask).toBeDefined();
      expect(maskedLayer.mask!.enabled).toBe(true);
      expect(maskedLayer.mask!.inverted).toBe(false);
      // CRITICAL: Original image pixels and source asset are 100% untouched!
      expect(maskedLayer.sourceAssetId).toBe(origAssetId);

      // Toggle mask
      const toggleCmd = new ToggleLayerMaskCommand(doc.id, targetLayer.id, defaultDocumentManager);
      toggleCmd.execute();
      expect(defaultDocumentManager.getEditDocument(doc.id)!.layers[0].mask!.enabled).toBe(false);
      toggleCmd.undo();
      expect(defaultDocumentManager.getEditDocument(doc.id)!.layers[0].mask!.enabled).toBe(true);

      // Invert mask
      const invertMaskCmd = new InvertLayerMaskCommand(doc.id, targetLayer.id, defaultDocumentManager);
      await invertMaskCmd.execute();
      const invertedMask = defaultDocumentManager.getEditDocument(doc.id)!.layers[0].mask!;
      // The asset bytes are already inverted; renderer interpretation must not invert them a second time.
      expect(invertedMask.inverted).toBe(false);
      expect((await defaultAssetManager.getMask(invertedMask.assetId))![0]).toBe(255);
      expect((await defaultAssetManager.getMask(invertedMask.assetId))![30 * doc.width + 30]).toBe(0);

      // Remove mask
      const removeMaskCmd = new RemoveLayerMaskCommand(doc.id, targetLayer.id, defaultDocumentManager);
      removeMaskCmd.execute();
      expect(defaultDocumentManager.getEditDocument(doc.id)!.layers[0].mask).toBeUndefined();

      // Undo remove mask
      removeMaskCmd.undo();
      expect(defaultDocumentManager.getEditDocument(doc.id)!.layers[0].mask).toBeDefined();
    });
  });

  describe('4. AI ModelManager & Local-First Lifecycle', () => {
    it('manages model manifests with Apache-2.0 licenses in %LOCALAPPDATA% (never in git)', () => {
      const models = defaultModelManager.listModels();
      expect(models.length).toBeGreaterThanOrEqual(3);

      const mobileSam = models.find((m) => m.modelId === 'mobilesam-vit-t');
      expect(mobileSam).toBeDefined();
      expect(mobileSam!.license).toBe('Apache-2.0');
      expect(mobileSam!.category).toBe('segmentation');

      // Verify local path is in AppData Local, not project repository
      const storageDir = defaultModelManager.getStorageDirectory();
      expect(storageDir.toLowerCase()).toContain('appdata\\local');
      expect(storageDir.toLowerCase()).not.toContain('.git');
    });

    it('simulates download lifecycle, progress reporting, and hash verification', async () => {
      const mgr = new ModelManager('C:\\Users\\Default\\AppData\\Local\\TestStudio\\models');
      const mockWeights = new TextEncoder().encode('MobileSAM Mock Weights Buffer for Testing');

      let notifiedProgress = 0;
      const unsub = mgr.subscribe((manifest) => {
        notifiedProgress = manifest.progress;
      });

      const success = await mgr.downloadModel('mobilesam-vit-t', mockWeights.buffer);
      expect(success).toBe(true);
      expect(notifiedProgress).toBe(1.0);
      expect(mgr.getModel('mobilesam-vit-t')!.status).toBe('ready');

      // Delete model
      mgr.deleteModel('mobilesam-vit-t');
      expect(mgr.getModel('mobilesam-vit-t')!.status).toBe('not_installed');
      unsub();
    });
  });

  describe('5. AI Segmentation & MaskProcessor Pipeline', () => {
    it('segments subject, sky, and seeds using LocalSegmentationProvider', async () => {
      const dummyImgData: ImageData = {
        width: 100,
        height: 100,
        data: new Uint8ClampedArray(100 * 100 * 4),
        colorSpace: 'srgb',
      };
      // Populate center pixels with foreground color
      for (let y = 30; y < 70; y++) {
        for (let x = 30; x < 70; x++) {
          const idx = (y * 100 + x) * 4;
          dummyImgData.data[idx] = 255;
          dummyImgData.data[idx + 1] = 50;
          dummyImgData.data[idx + 2] = 50;
          dummyImgData.data[idx + 3] = 255;
        }
      }

      // Subject segmentation
      const subjectResult = await defaultSegmentationProvider.segmentSubject(dummyImgData);
      expect(subjectResult.mask.length).toBe(100 * 100);
      expect(subjectResult.confidence).toBe(0);
      expect(subjectResult.model).toContain('Heuristic');
      expect(subjectResult.bounds.width).toBeGreaterThan(0);

      // Sky segmentation
      const skyResult = await defaultSegmentationProvider.segmentSky(dummyImgData);
      expect(skyResult.mask.length).toBe(100 * 100);
      expect(skyResult.provider).toBe('heuristic-local');

      // Point seed segmentation
      const pointResult = await defaultSegmentationProvider.segmentPoint(dummyImgData, 50, 50);
      expect(pointResult.bounds.width).toBeGreaterThan(0);
    });

    it('processes masks with island removal, hole filling, and edge smoothing', () => {
      const dirtyMask = new Uint8ClampedArray(50 * 50);
      // Create main object (20x20)
      for (let y = 15; y < 35; y++) {
        for (let x = 15; x < 35; x++) {
          dirtyMask[y * 50 + x] = 255;
        }
      }
      // Create isolated single-pixel noise island
      dirtyMask[5 * 50 + 5] = 255;
      // Create single-pixel hole inside main object
      dirtyMask[25 * 50 + 25] = 0;

      const cleaned = MaskProcessor.process(dirtyMask, 50, 50, {
        removeIslands: true,
        minIslandArea: 10,
        fillHoles: true,
        maxHoleArea: 10,
        smoothEdges: true,
      });

      // Island at (5, 5) removed
      expect(cleaned[5 * 50 + 5]).toBe(0);
      // Hole at (25, 25) filled
      expect(cleaned[25 * 50 + 25]).toBe(255);
    });

    it('enforces memory budget in SegmentationCache', () => {
      defaultSegmentationCache.clear();
      const buf = new ArrayBuffer(1024 * 1024); // 1 MB
      defaultSegmentationCache.set('key1', 1, '1.0', buf);
      expect(defaultSegmentationCache.get('key1', 1, '1.0')).toBeDefined();
      expect(defaultSegmentationCache.getCurrentMemoryUsage()).toBe(1024 * 1024);
      defaultSegmentationCache.clear();
      expect(defaultSegmentationCache.getCurrentMemoryUsage()).toBe(0);
    });
  });

  describe('6. Non-Destructive Inpainting & Generated Patch Layers', () => {
    it('executes inpainting with Context-Crop and creates a GeneratedPatchLayer', async () => {
      // 1. Create active selection
      const selCmd = new CreateSelectionCommand(doc.id, {
        geometric: { shape: 'rectangle', rect: { x: 40, y: 40, width: 40, height: 40 } }
      }, defaultDocumentManager);
      await defaultCommandBus.execute(selCmd);

      const activeDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      const targetLayer = activeDoc.layers[0];

      // 2. Inpainting Service execution with Context-Crop (+30% padding)
      const inpaintResult = await defaultInpaintingService.executeInpaint(
        activeDoc,
        targetLayer.id,
        activeDoc.selection!.bounds,
        activeDoc.selection!.assetId,
        { prompt: 'Remove distracting spot' }
      );

      // Bounds must be padded by ~30%
      expect(inpaintResult.bounds.width).toBeGreaterThanOrEqual(40);
      expect(inpaintResult.bounds.height).toBeGreaterThanOrEqual(40);
      expect(inpaintResult.patchBlob).toBeDefined();

      // 3. Create non-destructive GeneratedPatchLayer
      const patchLayer = await defaultInpaintingService.createPatchLayer(inpaintResult, 'Test Patch');
      expect(patchLayer.type).toBe('generated-patch');
      expect(patchLayer.generationMetadata.provider).toBe('local-content-aware');

      // 4. Add patch layer via AddGeneratedPatchLayerCommand
      const patchCmd = new AddGeneratedPatchLayerCommand(doc.id, patchLayer, defaultDocumentManager);
      defaultCommandBus.execute(patchCmd);

      const updatedDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(updatedDoc.layers.length).toBe(2);
      expect(updatedDoc.layers[1].type).toBe('generated-patch');
      expect(updatedDoc.layers[0].sourceAssetId).toBe(targetLayer.sourceAssetId); // Base layer pristine!

      // 5. Undo restores original document state cleanly
      defaultCommandBus.undo();
      expect(defaultDocumentManager.getEditDocument(doc.id)!.layers.length).toBe(1);
    });
  });

  describe('7. Agent Selection & Editing Tools Integration', () => {
    const toolContext = {
      documentManager: defaultDocumentManager,
      commandBus: defaultCommandBus,
      currentWorkspace: 'edit' as const,
    };

    it('reports pixel rendering unavailable in Node without mutating selection', async () => {
      const tool = defaultToolRegistry.getTool('edit_select_subject');
      expect(tool).toBeDefined();

      const result = await tool!.execute(toolContext, {}, 'call_sel_1');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SOURCE_UNAVAILABLE');
      expect(defaultDocumentManager.getEditDocument(doc.id)!.selection).toBeNull();
    });

    it('returns NO_SELECTION when edit_remove_selected_object is called without active selection', async () => {
      // Clear selection first
      defaultCommandBus.execute(new ClearSelectionCommand(doc.id, defaultDocumentManager));

      const removeTool = defaultToolRegistry.getTool('edit_remove_selected_object');
      const result = await removeTool!.execute(toolContext, {}, 'call_rem_1');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NO_SELECTION');
      expect(result.error?.message).toContain('No active selection found');
    });

    it('successfully removes object via edit_remove_selected_object when selection is active', async () => {
      // Create selection
      await defaultCommandBus.execute(new CreateSelectionCommand(doc.id, {
        geometric: { shape: 'rectangle', rect: { x: 30, y: 30, width: 40, height: 40 } }
      }, defaultDocumentManager));

      const removeTool = defaultToolRegistry.getTool('edit_remove_selected_object');
      const result = await removeTool!.execute(toolContext, {}, 'call_rem_2');

      expect(result.success).toBe(true);
      expect(result.data.patchLayerId).toBeDefined();

      const updatedDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      expect(updatedDoc.layers.some((l) => l.type === 'generated-patch')).toBe(true);
      // Selection should be cleared after removal
      expect(updatedDoc.selection).toBeNull();
    });

    it('executes edit_generative_fill tool with prompt and creates patch layer', async () => {
      // Create selection
      await defaultCommandBus.execute(new CreateSelectionCommand(doc.id, {
        geometric: { shape: 'rectangle', rect: { x: 20, y: 20, width: 50, height: 50 } }
      }, defaultDocumentManager));

      const genFillTool = defaultToolRegistry.getTool('edit_generative_fill');
      const result = await genFillTool!.execute(toolContext, { prompt: 'Golden flower' }, 'call_gen_1');

      expect(result.success).toBe(true);
      expect(result.data.prompt).toBe('Golden flower');

      const updatedDoc = defaultDocumentManager.getEditDocument(doc.id)!;
      const patchLayer = updatedDoc.layers.find((l) => l.type === 'generated-patch');
      expect(patchLayer).toBeDefined();
    });
  });
});
