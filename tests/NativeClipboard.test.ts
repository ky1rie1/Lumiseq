// tests/NativeClipboard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rgbaToBmpBlob,
  extractRgbaFromBlob,
  pasteClipboardImageToDocument,
  copyActiveLayerToClipboard,
} from '../src/clipboard/ClipboardService';
import { PasteImageCommand } from '../src/commands/edit/PasteImageCommand';
import { DocumentManager } from '../src/document/DocumentManager';
import { createEditDocument, createImageLayer, createTextLayer } from '../src/document/EditDocument';
import { AssetManager } from '../src/assets/AssetManager';
import { CommandBus } from '../src/history/CommandBus';
import { IPlatformBridge, ClipboardImage } from '../src/platform/IPlatformBridge';

describe('Native Clipboard & PasteImageCommand (Stage 1A)', () => {
  let docMgr: DocumentManager;
  let assetMgr: AssetManager;
  let commandBus: CommandBus;
  let mockBridge: IPlatformBridge;

  beforeEach(() => {
    docMgr = new DocumentManager();
    assetMgr = new AssetManager();
    commandBus = new CommandBus(docMgr);

    let clipboardImage: ClipboardImage | null = null;
    let clipboardText: string = '';

    mockBridge = {
      isDesktop: true,
      openFileDialog: vi.fn(),
      saveFileDialog: vi.fn(),
      readBinaryFile: vi.fn(),
      writeBinaryFile: vi.fn(),
      getAppPaths: vi.fn(),
      readTextFile: vi.fn(),
      writeTextFileAtomic: vi.fn(),
      listDirFiles: vi.fn(),
      deleteFile: vi.fn(),
      readClipboardText: vi.fn(async () => clipboardText),
      writeClipboardText: vi.fn(async (t: string) => {
        clipboardText = t;
      }),
      readClipboardImage: vi.fn(async () => clipboardImage),
      writeClipboardImage: vi.fn(async (w: number, h: number, rgba: Uint8Array) => {
        clipboardImage = { width: w, height: h, rgbaBytes: rgba };
      }),
      getRawMetadata: vi.fn(),
      extractRawThumbnail: vi.fn(),
      decodeRawImage: vi.fn(),
      cancelRawDecode: vi.fn(),
      exportRawDevelop: vi.fn(),
      saveSecureSecret: vi.fn(),
      getSecureSecret: vi.fn(),
      hasSecureSecret: vi.fn(),
    };
  });

  describe('rgbaToBmpBlob', () => {
    it('correctly creates a valid 32-bit BMP with proper header and BGRA payload', async () => {
      // 2x2 image: Red, Green, Blue, White
      const rgba = new Uint8Array([
        255, 0, 0, 255,     // Red
        0, 255, 0, 255,     // Green
        0, 0, 255, 255,     // Blue
        255, 255, 255, 255, // White
      ]);

      const blob = rgbaToBmpBlob(rgba, 2, 2);
      expect(blob.type).toBe('image/bmp');
      expect(blob.size).toBe(54 + 2 * 2 * 4); // 54 header + 16 pixel bytes = 70 bytes

      const buffer = await blob.arrayBuffer();
      const view = new DataView(buffer);

      // Check 'BM' signature
      expect(view.getUint8(0)).toBe(0x42);
      expect(view.getUint8(1)).toBe(0x4d);
      // File size
      expect(view.getUint32(2, true)).toBe(70);
      // Pixel offset
      expect(view.getUint32(10, true)).toBe(54);
      // DIB header size
      expect(view.getUint32(14, true)).toBe(40);
      // Width
      expect(view.getInt32(18, true)).toBe(2);
      // Height (negative = top-down)
      expect(view.getInt32(22, true)).toBe(-2);
      // Color planes
      expect(view.getUint16(26, true)).toBe(1);
      // BPP
      expect(view.getUint16(28, true)).toBe(32);

      // First pixel in BMP must be BGRA: Blue=0, Green=0, Red=255, Alpha=255
      const raw = new Uint8Array(buffer, 54);
      expect(raw[0]).toBe(0);   // B
      expect(raw[1]).toBe(0);   // G
      expect(raw[2]).toBe(255); // R
      expect(raw[3]).toBe(255); // A

      // Roundtrip extraction test
      const extracted = await extractRgbaFromBlob(blob);
      expect(extracted).not.toBeNull();
      expect(extracted?.width).toBe(2);
      expect(extracted?.height).toBe(2);
      expect(Array.from(extracted!.rgba)).toEqual(Array.from(rgba));
    });

    it('throws on non-positive dimensions', () => {
      expect(() => rgbaToBmpBlob(new Uint8Array(0), 0, 10)).toThrow(RangeError);
      expect(() => rgbaToBmpBlob(new Uint8Array(0), 10, -5)).toThrow(RangeError);
    });
  });

  describe('PasteImageCommand & pasteClipboardImageToDocument', () => {
    it('executes PasteImageCommand, sets selection, and supports undo/redo via CommandBus', () => {
      const doc = createEditDocument({ id: 'doc-clipboard-1', width: 800, height: 600 });
      docMgr.openDocument(doc, true);

      const layer = createImageLayer({
        name: 'Pasted Layer',
        sourceAssetId: 'asset_test_1',
        naturalWidth: 200,
        naturalHeight: 150,
        x: 300,
        y: 225,
      });

      const cmd = new PasteImageCommand(doc.id, layer, docMgr);
      commandBus.execute(cmd);

      let current = docMgr.getEditDocument(doc.id)!;
      expect(current.layers.length).toBe(1);
      expect(current.layers[0].id).toBe(layer.id);
      expect(current.selectedLayerId).toBe(layer.id);
      expect(current.isDirty).toBe(true);

      // Undo
      commandBus.undo();
      current = docMgr.getEditDocument(doc.id)!;
      expect(current.layers.length).toBe(0);
      expect(current.selectedLayerId).toBeNull();

      // Redo
      commandBus.redo();
      current = docMgr.getEditDocument(doc.id)!;
      expect(current.layers.length).toBe(1);
      expect(current.selectedLayerId).toBe(layer.id);
    });

    it('pastes image directly from clipboard into centered document coordinate', async () => {
      const doc = createEditDocument({ id: 'doc-paste-2', width: 1000, height: 800 });
      docMgr.openDocument(doc, true);

      // Set mock clipboard image (100x100 green image)
      const greenRgba = new Uint8Array(100 * 100 * 4);
      for (let i = 0; i < 100 * 100; i++) {
        greenRgba[i * 4 + 1] = 255;
        greenRgba[i * 4 + 3] = 255;
      }
      await mockBridge.writeClipboardImage(100, 100, greenRgba);

      const pastedLayer = await pasteClipboardImageToDocument(doc.id, {
        bridge: mockBridge,
        assetManager: assetMgr,
        documentManager: docMgr,
        commandBus,
      });

      expect(pastedLayer).not.toBeNull();
      expect(pastedLayer?.naturalWidth).toBe(100);
      expect(pastedLayer?.naturalHeight).toBe(100);
      // Centered: (1000 - 100) / 2 = 450, (800 - 100) / 2 = 350
      expect(pastedLayer?.transform.x).toBe(450);
      expect(pastedLayer?.transform.y).toBe(350);

      const updated = docMgr.getEditDocument(doc.id)!;
      expect(updated.layers.length).toBe(1);
      expect(updated.layers[0].id).toBe(pastedLayer!.id);

      // Verify asset was registered in AssetManager
      const asset = assetMgr.getHandle(pastedLayer!.sourceAssetId);
      expect(asset).not.toBeNull();
      expect(asset?.width).toBe(100);
      expect(asset?.height).toBe(100);

      // Verify undo works via CommandBus
      commandBus.undo();
      expect(docMgr.getEditDocument(doc.id)!.layers.length).toBe(0);
    });
  });

  describe('copyActiveLayerToClipboard', () => {
    it('copies selected image layer BMP pixels to clipboard', async () => {
      const doc = createEditDocument({ id: 'doc-copy-1', width: 500, height: 500 });

      // Create an image asset
      const rgba = new Uint8Array([255, 128, 0, 255]);
      const blob = rgbaToBmpBlob(rgba, 1, 1);
      const asset = await assetMgr.registerBlob(blob, 'image', 'Test Asset', { width: 1, height: 1 });

      const layer = createImageLayer({
        name: 'Layer to Copy',
        sourceAssetId: asset.id,
        naturalWidth: 1,
        naturalHeight: 1,
      });

      doc.layers.push(layer);
      doc.selectedLayerId = layer.id;
      docMgr.openDocument(doc, true);

      const success = await copyActiveLayerToClipboard(doc.id, {
        bridge: mockBridge,
        assetManager: assetMgr,
        documentManager: docMgr,
      });

      expect(success).toBe(true);
      const clipboardContent = await mockBridge.readClipboardImage();
      expect(clipboardContent).not.toBeNull();
      expect(clipboardContent?.width).toBe(1);
      expect(clipboardContent?.height).toBe(1);
      expect(clipboardContent?.rgbaBytes[0]).toBe(255);
      expect(clipboardContent?.rgbaBytes[1]).toBe(128);
      expect(clipboardContent?.rgbaBytes[2]).toBe(0);
      expect(clipboardContent?.rgbaBytes[3]).toBe(255);
    });

    it('copies text layer string to clipboard text fallback', async () => {
      const doc = createEditDocument({ id: 'doc-copy-text', width: 500, height: 500 });
      const textLayer = createTextLayer({ text: 'Hello Lumiseq Studio!' });
      doc.layers.push(textLayer);
      doc.selectedLayerId = textLayer.id;
      docMgr.openDocument(doc, true);

      const success = await copyActiveLayerToClipboard(doc.id, {
        bridge: mockBridge,
        assetManager: assetMgr,
        documentManager: docMgr,
      });

      expect(success).toBe(true);
      const text = await mockBridge.readClipboardText();
      expect(text).toBe('Hello Lumiseq Studio!');
    });
  });
});
