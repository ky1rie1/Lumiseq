import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectSubjectTool, SelectBackgroundTool, SelectSkyTool, SelectObjectTool } from '../src/ai/tools/edit/selectionTools';
import { defaultLocalCutoutProvider } from '../src/cutout/LocalCutoutProvider';
import { defaultAssetManager } from '../src/assets/AssetManager';
import { defaultDocumentManager as manager } from '../src/document/DocumentManager';
import { defaultCommandBus as bus } from '../src/history/CommandBus';
import { createEditDocument, createGroupLayer, createImageLayer } from '../src/document/EditDocument';
import { SelectionCanvas } from './support/selectionCanvas';

const context = { documentManager: manager, commandBus: bus, currentWorkspace: 'edit' as const };
let doc: ReturnType<typeof createEditDocument>;
let onInfer: (() => void) | undefined;
beforeEach(async () => {
  bus.clearHistory(); onInfer = undefined;
  vi.stubGlobal('document', { createElement: () => new SelectionCanvas() });
  vi.stubGlobal('window', { document: globalThis.document });
  vi.stubGlobal('HTMLCanvasElement', SelectionCanvas);
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    const bitmap = new SelectionCanvas(); bitmap.pixels = Uint8ClampedArray.from([Number(await blob.text()), 0, 0, 255]);
    return Object.assign(bitmap, { close() {} });
  });
  vi.spyOn(defaultLocalCutoutProvider, 'inferRefined').mockImplementation(async canvas => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    onInfer?.();
    const output = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0; i < output.length; i++) output[i] = data[i * 4];
    return output;
  });
  doc = createEditDocument({ width: 4, height: 2, name: 'Actual pixels' });
  const first = await defaultAssetManager.registerBlob(new Blob(['80']), 'image', 'lower', { width: 1, height: 1 });
  const second = await defaultAssetManager.registerBlob(new Blob(['160']), 'image', 'upper', { width: 1, height: 1 });
  const child = createImageLayer({ sourceAssetId: second.id, naturalWidth: 1, naturalHeight: 1 });
  const group = createGroupLayer({ children: [child] }); group.transform.x = 2;
  doc.layers = [createImageLayer({ sourceAssetId: first.id, naturalWidth: 1, naturalHeight: 1 }), group];
  doc.selectedLayerId = child.id; manager.openDocument(doc);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mask() { const current = manager.getEditDocument(doc.id)!; return current.selection ? Array.from((await defaultAssetManager.getMask(current.selection.assetId))!) : null; }

describe('real document selection', () => {
  it('rejects stale pixels even if the document changes during mask registration', async () => {
    const register = defaultAssetManager.registerMask.bind(defaultAssetManager);
    vi.spyOn(defaultAssetManager, 'registerMask').mockImplementation(async (...args) => {
      const asset = await register(...args);
      manager.updateDocument({ ...manager.getEditDocument(doc.id)!, name: 'Newer edit' });
      return asset;
    });
    const result = await new SelectSubjectTool().execute(context, {}, 'late-stale');
    expect(result.success).toBe(false); expect(await mask()).toBeNull();
    expect(manager.getEditDocument(doc.id)?.name).toBe('Newer edit');
  });
  it('selects the actual visible composite and preserves model soft alpha', async () => {
    const result = await new SelectSubjectTool().execute(context, { target: 'composite', feather: 0 }, 'composite');
    expect(result.success).toBe(true);
    expect(await mask()).toEqual([80, 0, 160, 0, 0, 0, 0, 0]);
    expect(result.data.provider).toBe('birefnet-local');
  });
  it('selects only the active nested source in document coordinates', async () => {
    const result = await new SelectSubjectTool().execute(context, { target: 'active_layer', feather: 0 }, 'active');
    expect(result.success).toBe(true);
    expect(await mask()).toEqual([0, 0, 160, 0, 0, 0, 0, 0]);
  });
  it('inverts the real composite alpha for background in one undoable operation', async () => {
    await new SelectBackgroundTool().execute(context, { feather: 0 }, 'background');
    expect(await mask()).toEqual([175, 255, 95, 255, 255, 255, 255, 255]);
    await bus.undo(); expect(await mask()).toBeNull();
  });
  it('rejects a result after the document source changes during inference', async () => {
    onInfer = () => manager.updateDocument({ ...manager.getEditDocument(doc.id)!, width: 5 });
    const result = await new SelectSubjectTool().execute(context, { feather: 0 }, 'stale');
    expect(result.success).toBe(false); expect(result.error?.code).toBe('STALE_SOURCE');
    expect(await mask()).toBeNull();
  });
  it('fails explicitly without a browser pixel renderer instead of producing synthetic pixels', async () => {
    vi.stubGlobal('document', undefined); vi.stubGlobal('window', undefined);
    const result = await new SelectSubjectTool().execute(context, {}, 'no-browser');
    expect(result.success).toBe(false); expect(result.error?.code).toBe('SOURCE_UNAVAILABLE');
    expect(await mask()).toBeNull();
  });
  it('does not mutate selection when the installed model is unavailable', async () => {
    vi.mocked(defaultLocalCutoutProvider.inferRefined).mockRejectedValue(new Error('Model not installed'));
    const result = await new SelectSubjectTool().execute(context, {}, 'no-model');
    expect(result.success).toBe(false); expect(result.error?.code).toBe('SEGMENTATION_UNAVAILABLE');
    expect(await mask()).toBeNull();
  });
  it('does not mutate selection after cancellation', async () => {
    const controller = new AbortController(); onInfer = () => controller.abort();
    const result = await new SelectBackgroundTool().execute(context, { signal: controller.signal }, 'cancel');
    expect(result.success).toBe(false); expect(await mask()).toBeNull();
  });
  it('rejects a result when only the source asset or ancestor transform changes', async () => {
    onInfer = () => {
      const current = manager.getEditDocument(doc.id)!;
      const group = current.layers[1]; group.transform.x = 1;
      manager.updateDocument({ ...current, layers: [...current.layers] });
    };
    const result = await new SelectSubjectTool().execute(context, { target: 'active_layer' }, 'stale-parent');
    expect(result.error?.code).toBe('STALE_SOURCE'); expect(await mask()).toBeNull();
  });
  it('fails when active source is missing instead of substituting the composite', async () => {
    manager.updateDocument({ ...doc, selectedLayerId: 'missing' });
    const result = await new SelectSubjectTool().execute(context, { target: 'active_layer' }, 'missing-layer');
    expect(result.error?.code).toBe('SOURCE_UNAVAILABLE'); expect(await mask()).toBeNull();
  });
  it.each([['sky', SelectSkyTool], ['object', SelectObjectTool]] as const)('keeps legacy %s operations truthful while reading actual pixels', async (_name, Tool) => {
    const result = await new Tool().execute(context, { x: 2, y: 0, feather: 0 }, 'heuristic');
    expect(result.success).toBe(true); expect(result.data.provider).toBe('heuristic-local');
    expect(result.data.confidence).toBe(0);
  });
});
