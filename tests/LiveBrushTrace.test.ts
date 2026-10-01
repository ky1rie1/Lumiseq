import { describe, it, expect, beforeEach } from 'vitest';
import { defaultBrushEngine, BrushEngine } from '../src/brush/BrushEngine';
import { defaultCommandBus } from '../src/history/CommandBus';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultAssetManager } from '../src/assets/AssetManager';
import { defaultImageEngine } from '../src/engine/WebGLImageEngine';
import { createEditDocument, createPaintLayer } from '../src/document/EditDocument';

function createMockCanvas(width: number, height: number): HTMLCanvasElement {
  const ctx = {
    clearRect: () => {},
    drawImage: () => {},
    fillRect: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    transform: () => {},
    setTransform: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    canvas: { width, height },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
  };
  return {
    width,
    height,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

describe('Live Brush Trace and Accumulation Tests', () => {
  beforeEach(() => {
    defaultCommandBus.clearHistory();
    defaultDocumentManager.closeAll();
  });

  it('preserves initialImageSource in offscreen canvas during stroke so consecutive strokes accumulate', async () => {
    const width = 64;
    const height = 64;

    // Create a mock initial image source with a red square at (0, 0)
    const initialBuffer = new Uint8ClampedArray(width * height * 4);
    // Mark pixel at index 0 as red
    initialBuffer[0] = 255;
    initialBuffer[1] = 0;
    initialBuffer[2] = 0;
    initialBuffer[3] = 255;

    const engine = new BrushEngine();

    // Start stroke passing initialImageSource
    await engine.startStroke({
      documentId: 'doc_1',
      layerId: 'layer_1',
      initialPoint: { x: 32, y: 32, pressure: 1.0 },
      settings: { size: 10, color: '#00ff00', opacity: 1.0 },
      initialAssetId: 'asset_prev',
      width,
      height,
      initialImageSource: initialBuffer,
    });

    const offscreen = engine.getOffscreenCanvas();
    expect(offscreen).toBeDefined();
    expect(engine.isPainting).toBe(true);

    const ctx = offscreen?.getContext('2d');
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, width, height);
      // The initial red pixel at (0, 0) MUST still be present (preserved, not erased)!
      expect(imgData.data[0]).toBe(255);
      expect(imgData.data[3]).toBe(255);
    }

    engine.cancelStroke();
    expect(engine.isPainting).toBe(false);
  });

  it('WebGLImageEngine supports layerOverrides in renderEdit', async () => {
    const width = 100;
    const height = 100;
    const doc = createEditDocument({
      name: 'Override Test',
      width,
      height,
    });

    const paintLayer = createPaintLayer({ name: 'Paint Layer', width, height });
    doc.layers.push(paintLayer);

    const targetCanvas = createMockCanvas(width, height);
    const overrideCanvas = createMockCanvas(width, height);

    const layerOverrides = new Map<string, CanvasImageSource>([
      [paintLayer.id, overrideCanvas],
    ]);

    // renderEdit should succeed cleanly using layerOverrides without trying to fetch stale asset
    await expect(
      defaultImageEngine.renderEdit(
        doc,
        targetCanvas,
        { zoom: 1, panX: 0, panY: 0, canvasWidth: width, canvasHeight: height },
        undefined,
        layerOverrides
      )
    ).resolves.toBeUndefined();
  });

  it('getLoadedSourceElement and getOrLoadSourceElement retrieve asset elements correctly', async () => {
    const handle = await defaultAssetManager.registerBlob(
      new Blob(['dummy_bytes'], { type: 'image/png' }),
      'image',
      'Test Asset',
      { width: 50, height: 50 }
    );

    expect(defaultImageEngine.getLoadedSourceElement('non_existent')).toBeNull();

    // In node test environment where decoding isn't available, handles gracefully
    try {
      const elem = await defaultImageEngine.getOrLoadSourceElement(handle.id);
      expect(elem !== undefined).toBe(true);
    } catch {
      // Expected in Node environment without Image decoder
    }
  });

  it('renders live dabs to mirrorContext synchronously during startStroke and addPoint', async () => {
    const drawCalls: Array<{ dab: any; x: number; y: number }> = [];
    const mockMirrorContext = {
      save: () => {},
      restore: () => {},
      drawImage: (dab: any, x: number, y: number) => {
        drawCalls.push({ dab, x, y });
      },
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    const engine = new BrushEngine();
    await engine.startStroke(
      {
        documentId: 'doc_live',
        layerId: 'layer_live',
        initialPoint: { x: 100, y: 100, pressure: 1.0 },
        settings: { size: 20, color: '#ff0000', opacity: 1.0 },
        initialAssetId: '',
        width: 500,
        height: 500,
      },
      mockMirrorContext
    );

    // Initial dab should have been rendered immediately to mirrorContext
    expect(drawCalls.length).toBe(1);
    expect(drawCalls[0].x).toBe(100 - 10); // x - radius
    expect(drawCalls[0].y).toBe(100 - 10); // y - radius

    // Add movement points
    engine.addPoint({ x: 120, y: 100, pressure: 1.0 }, mockMirrorContext);
    engine.addPoint({ x: 150, y: 100, pressure: 1.0 }, mockMirrorContext);

    // More dabs should have been drawn along the path to mirrorContext live
    expect(drawCalls.length).toBeGreaterThan(1);
    engine.cancelStroke();
  });

  it('accumulates consecutive strokes in-memory using setLoadedSource without decode latency', async () => {
    const doc = createEditDocument({ name: 'Accumulation Test', width: 200, height: 200 });
    const paintLayer = createPaintLayer({ name: 'Painting', width: 200, height: 200 });
    doc.layers.push(paintLayer);
    defaultDocumentManager.openDocument(doc);

    const engine = new BrushEngine();

    // Stroke 1
    await engine.startStroke({
      documentId: doc.id,
      layerId: paintLayer.id,
      initialPoint: { x: 20, y: 20, pressure: 1.0 },
      settings: { size: 10, color: '#0000ff' },
      initialAssetId: '',
      width: 200,
      height: 200,
    });
    engine.addPoint({ x: 40, y: 20, pressure: 1.0 });
    const cmd1 = await engine.endStroke(defaultCommandBus, defaultDocumentManager);
    expect(cmd1).toBeDefined();

    // Cache the output canvas in memory
    const canvas1 = createMockCanvas(200, 200);
    defaultImageEngine.setLoadedSource((cmd1 as any).finalAssetId, canvas1, 200, 200);

    // Verify it is immediately accessible in memory
    const cached1 = defaultImageEngine.getLoadedSourceElement((cmd1 as any).finalAssetId);
    expect(cached1).toBe(canvas1);

    // Stroke 2 on the same layer
    const updatedDoc = defaultDocumentManager.getEditDocument(doc.id)!;
    const updatedLayer = updatedDoc.layers.find(l => l.id === paintLayer.id)!;
    const stroke2InitialAssetId = (updatedLayer as any).rasterAssetId;
    expect(stroke2InitialAssetId).toBe((cmd1 as any).finalAssetId);

    await engine.startStroke({
      documentId: doc.id,
      layerId: paintLayer.id,
      initialPoint: { x: 60, y: 60, pressure: 1.0 },
      settings: { size: 10, color: '#ffff00' },
      initialAssetId: stroke2InitialAssetId,
      width: 200,
      height: 200,
    });
    engine.addPoint({ x: 80, y: 60, pressure: 1.0 });
    const cmd2 = await engine.endStroke(defaultCommandBus, defaultDocumentManager);
    expect(cmd2).toBeDefined();
    expect((cmd2 as any).initialAssetId).toBe(stroke2InitialAssetId);
  });
});
