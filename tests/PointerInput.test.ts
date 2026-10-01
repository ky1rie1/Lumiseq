// tests/PointerInput.test.ts
//! Comprehensive Test Suite for Unified PointerInput Pipeline & Stylus Pressure Dynamics (Stage 3.1)

import { describe, it, expect, beforeEach } from 'vitest';
import { extractPointerInput, PointerInput } from '../src/input/PointerInput';
import { BrushRenderer } from '../src/brush/BrushRenderer';
import { BrushEngine } from '../src/brush/BrushEngine';
import { defaultCommandBus } from '../src/history/CommandBus';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultAssetManager } from '../src/assets/AssetManager';
import { createEditDocument, createPaintLayer } from '../src/document/EditDocument';
import { EditDocument } from '../src/types/edit';

describe('Unified PointerInput & Stylus Dynamics Suite', () => {
  describe('extractPointerInput', () => {
    it('normalizes desktop mouse click to 1.0 pressure when buttons are pressed', () => {
      const mockEvent = {
        clientX: 150,
        clientY: 250,
        pointerType: 'mouse',
        pressure: 0.5, // W3C default for mouse button press without hardware pressure
        button: 0,
        buttons: 1,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
        pointerId: 1,
        timeStamp: 1000,
      } as unknown as React.PointerEvent<HTMLCanvasElement>;

      const input = extractPointerInput(mockEvent, { docX: 50, docY: 75 });
      expect(input.pointerType).toBe('mouse');
      expect(input.pressure).toBe(1.0);
      expect(input.docX).toBe(50);
      expect(input.docY).toBe(75);
      expect(input.button).toBe(0);
      expect(input.buttons).toBe(1);
    });

    it('normalizes unpressed mouse hover to 0.0 pressure', () => {
      const mockEvent = {
        clientX: 100,
        clientY: 100,
        pointerType: 'mouse',
        pressure: 0.0,
        button: -1,
        buttons: 0,
        pointerId: 1,
      } as unknown as React.PointerEvent<HTMLCanvasElement>;

      const input = extractPointerInput(mockEvent, { docX: 10, docY: 10 });
      expect(input.pointerType).toBe('mouse');
      expect(input.pressure).toBe(0.0);
    });

    it('faithfully preserves stylus/pen pressure and tilt from Windows Ink / Wacom', () => {
      const mockEvent = {
        clientX: 300,
        clientY: 400,
        pointerType: 'pen',
        pressure: 0.72,
        tiltX: 15,
        tiltY: -20,
        twist: 45,
        button: 0,
        buttons: 1,
        pointerId: 2,
      } as unknown as React.PointerEvent<HTMLCanvasElement>;

      const input = extractPointerInput(mockEvent, { docX: 120, docY: 160 });
      expect(input.pointerType).toBe('pen');
      expect(input.pressure).toBeCloseTo(0.72);
      expect(input.tiltX).toBe(15);
      expect(input.tiltY).toBe(-20);
      expect(input.twist).toBe(45);
    });

    it('falls back to 0.5 pressure if pen driver reports 0.0 pressure during active contact', () => {
      const mockEvent = {
        clientX: 300,
        clientY: 400,
        pointerType: 'pen',
        pressure: 0.0,
        button: 0,
        buttons: 1,
        pointerId: 3,
      } as unknown as React.PointerEvent<HTMLCanvasElement>;

      const input = extractPointerInput(mockEvent, { docX: 100, docY: 100 });
      expect(input.pointerType).toBe('pen');
      expect(input.pressure).toBe(0.5);
    });

    it('clamps out-of-range pressure values strictly to [0.0, 1.0]', () => {
      const mockEventHigh = {
        clientX: 0,
        clientY: 0,
        pointerType: 'pen',
        pressure: 1.45,
        buttons: 1,
      } as unknown as React.PointerEvent<HTMLCanvasElement>;

      const high = extractPointerInput(mockEventHigh, { docX: 0, docY: 0 });
      expect(high.pressure).toBe(1.0);

      const mockEventLow = {
        clientX: 0,
        clientY: 0,
        pointerType: 'pen',
        pressure: -0.2,
        buttons: 0,
      } as unknown as React.PointerEvent<HTMLCanvasElement>;

      const low = extractPointerInput(mockEventLow, { docX: 0, docY: 0 });
      expect(low.pressure).toBe(0.0);
    });
  });

  describe('Brush Dynamics & Pressure Scaling', () => {
    let renderer: BrushRenderer;

    beforeEach(() => {
      renderer = new BrushRenderer();
    });

    it('reuses cached dab stamps for matching size, hardness, color, and flow', () => {
      const stamp1 = renderer.getDabStamp(30, 0.8, '#ff0000', 1.0);
      const stamp2 = renderer.getDabStamp(30, 0.8, '#ff0000', 1.0);
      expect(stamp1).toBe(stamp2);
    });

    it('scales dirty rect and stamps according to pressure when pressureSize is enabled', () => {
      const canvas = {
        getContext: () => ({
          save: () => {},
          restore: () => {},
          drawImage: () => {},
          globalAlpha: 1.0,
          globalCompositeOperation: 'source-over',
        }),
      } as unknown as HTMLCanvasElement;
      const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

      // Low pressure stroke (0.2)
      const lowRes = renderer.renderSegment(
        ctx,
        { x: 10, y: 10, pressure: 0.2 },
        { x: 50, y: 10, pressure: 0.2 },
        { size: 50, hardness: 0.8, opacity: 1.0, flow: 1.0, spacing: 0.25, color: '#000000', blendMode: 'normal', pressureSize: true }
      );

      // High pressure stroke (1.0)
      const highRes = renderer.renderSegment(
        ctx,
        { x: 10, y: 10, pressure: 1.0 },
        { x: 50, y: 10, pressure: 1.0 },
        { size: 50, hardness: 0.8, opacity: 1.0, flow: 1.0, spacing: 0.25, color: '#000000', blendMode: 'normal', pressureSize: true }
      );

      // Low pressure effective size = 50 * 0.2 = 10 (radius 5 -> height ~10)
      // High pressure effective size = 50 * 1.0 = 50 (radius 25 -> height ~50)
      expect(lowRes.dirtyRect.height).toBeLessThan(highRes.dirtyRect.height);
      expect(lowRes.dirtyRect.width).toBeLessThan(highRes.dirtyRect.width);
    });

    it('renders single dab with pressure scaling in renderFullStroke', () => {
      const canvas = {
        getContext: () => ({
          save: () => {},
          restore: () => {},
          drawImage: () => {},
          globalAlpha: 1.0,
          globalCompositeOperation: 'source-over',
        }),
      } as unknown as HTMLCanvasElement;
      const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

      const lightDab = renderer.renderFullStroke(
        ctx,
        [{ x: 100, y: 100, pressure: 0.1 }],
        { size: 40, hardness: 0.8, opacity: 1.0, flow: 1.0, spacing: 0.25, color: '#ffffff', blendMode: 'normal', pressureSize: true }
      );

      const heavyDab = renderer.renderFullStroke(
        ctx,
        [{ x: 100, y: 100, pressure: 1.0 }],
        { size: 40, hardness: 0.8, opacity: 1.0, flow: 1.0, spacing: 0.25, color: '#ffffff', blendMode: 'normal', pressureSize: true }
      );

      expect(lightDab.width).toBeLessThan(heavyDab.width);
      expect(lightDab.height).toBeLessThan(heavyDab.height);
    });
  });

  describe('BrushEngine with Stylus Pressure Interaction', () => {
    let doc: EditDocument;
    let engine: BrushEngine;

    beforeEach(() => {
      defaultCommandBus.clearHistory();
      defaultAssetManager.clearRuntimeCache();
      doc = createEditDocument({ name: 'Stylus Canvas', width: 200, height: 200 });
      defaultDocumentManager.openDocument(doc, true);
      engine = new BrushEngine();
    });

    it('records discrete pressure points during stylus drag gesture', async () => {
      const paintLayer = createPaintLayer({ name: 'Inking' });
      doc.layers.push(paintLayer);

      await engine.startStroke({
        documentId: doc.id,
        layerId: paintLayer.id,
        initialPoint: { x: 20, y: 20, pressure: 0.25 },
        settings: { size: 24, color: '#00e5ff', pressureSize: true, pressureFlow: true },
        initialAssetId: paintLayer.rasterAssetId,
        width: 200,
        height: 200,
      });

      expect(engine.isPainting).toBe(true);

      // Simulate increasing pressure as stylus presses down harder
      engine.addPoint({ x: 30, y: 25, pressure: 0.4 });
      engine.addPoint({ x: 45, y: 35, pressure: 0.75 });
      engine.addPoint({ x: 60, y: 50, pressure: 1.0 });

      const active = engine.getActiveStroke();
      expect(active).not.toBeNull();
      expect(active!.points.length).toBe(4);
      expect(active!.points[0].pressure).toBe(0.25);
      expect(active!.points[1].pressure).toBe(0.4);
      expect(active!.points[2].pressure).toBe(0.75);
      expect(active!.points[3].pressure).toBe(1.0);

      const cmd = await engine.endStroke(defaultCommandBus, defaultDocumentManager);
      expect(cmd).not.toBeNull();
      expect(engine.isPainting).toBe(false);
      expect(defaultCommandBus.getHistory().length).toBe(1);
    });
  });
});
