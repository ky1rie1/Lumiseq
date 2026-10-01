import { afterEach, expect, it, vi } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { defaultAssetManager as assets } from '../assets/AssetManager';
import { createEditDocument, createGroupLayer, createPaintLayer, findLayerById, createSmartObjectLayer } from '../document/EditDocument';
import { installPixelCanvas, pixelBytes } from '../engine/editPixelTestCanvas';
import { WebGLImageEngine } from '../engine/WebGLImageEngine';
import { LayerOperationService } from './LayerOperationService';
import { BrushStrokeCommand } from '../brush/BrushCommands';
import { ProjectSerializer } from '../project/ProjectSerializer';
import { RasterizeSmartObjectCommand } from '../smartobject/SmartObjectManager';
import { CreateMaskFromSelectionCommand } from '../mask/MaskCommands';
import { ToolRegistry } from '../ai/tools/ToolRegistry';
import { MCPSchemaAdapter } from '../ai/tools/schemaAdapters/MCPSchemaAdapter';
import { BrushEngine } from '../brush/BrushEngine';
import { defaultInpaintingService } from '../ai/inpainting/InpaintingService';
import { AddGeneratedPatchLayerCommand } from '../commands/edit/AddGeneratedPatchLayerCommand';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function raster(bytes: number[], width: number, height: number) {
  const create = installPixelCanvas(); const canvas = create(width, height); const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(width, height); pixels.data.set(bytes); ctx.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
  return assets.registerBlob(blob, 'image', 'pixels', { width, height });
}
function supportBitmapDisposal() {
  const decode = globalThis.createImageBitmap;
  vi.stubGlobal('createImageBitmap', async (...args: Parameters<typeof decode>) => {
    const bitmap = await decode(...args); bitmap.close ??= () => {}; return bitmap;
  });
}

it('restores a canonical generated patch and its pixels after undo/redo while retaining its resource identity', async () => {
  const source = await raster([255,0,0,255], 1, 1);
  const generated = await raster([0,0,255,255], 1, 1);
  const mask = await assets.registerMask(new Uint8ClampedArray([255]), 1, 1, 'fill selection');
  const child = createPaintLayer({ rasterAssetId: source.id, width: 1, height: 1 });
  const doc = createEditDocument({ width: 1, height: 1, layers: [createGroupLayer({ children: [child] })], backgroundColor: 'transparent' });
  doc.selectedLayerId = child.id;
  doc.selection = { id: 'fill-selection', documentId: doc.id, width: 1, height: 1, assetId: mask.id, bounds: { x: 0, y: 0, width: 1, height: 1 }, feather: 0, inverted: false, active: true };
  // Supply deterministic generation pixels; canonical resource creation, insertion and history remain real.
  vi.spyOn(defaultInpaintingService, 'executeInpaint').mockResolvedValue({
    patchBlob: (await assets.getBlob(generated.id))!, width: 1, height: 1, bounds: doc.selection.bounds,
    metadata: { provider: 'pixel-fixture', model: 'deterministic', sourceDocumentId: doc.id, sourceLayerId: child.id, maskId: mask.id, timestamp: 1 },
  });
  const documents = new DocumentManager(); documents.openDocument(doc); const bus = new CommandBus(documents);
  const registry = new ToolRegistry();
  const create = installPixelCanvas(); const engine = new WebGLImageEngine();
  supportBitmapDisposal();
  const render = async () => { const canvas = create(1, 1); await engine.renderEdit(documents.getEditDocument(doc.id)!, canvas); return pixelBytes(canvas); };
  const result = await registry.get('edit_generative_fill')!.execute({ documentManager: documents, commandBus: bus, currentWorkspace: 'edit' }, { documentId: doc.id, prompt: 'blue' }, 'fill');
  expect(result.success).toBe(true); expect(bus.getHistory()).toHaveLength(2);
  const patch = documents.getEditDocument(doc.id)!.layers[1];
  expect(patch.type).toBe('generated-patch'); expect(await render()).toEqual([0,0,255,255]);
  bus.undo(); bus.undo(); expect(await render()).toEqual([255,0,0,255]); expect(bus.getHistory()).toHaveLength(0);
  bus.redo(); bus.redo();
  expect(documents.getEditDocument(doc.id)!.layers[1]).toEqual(patch);
  expect(documents.getEditDocument(doc.id)!.selection).toBeNull();
  expect(await render()).toEqual([0,0,255,255]); expect(bus.getHistory()).toHaveLength(2);
});

it('still rejects an initially stale generated-patch commit without changing source pixels or history', async () => {
  const source = await raster([255,0,0,255], 1, 1);
  supportBitmapDisposal();
  const mask = await assets.registerMask(new Uint8ClampedArray([255]), 1, 1, 'patch selection');
  const child = createPaintLayer({ rasterAssetId: source.id, width: 1, height: 1 });
  const doc = createEditDocument({ width: 1, height: 1, layers: [child], backgroundColor: 'transparent' });
  const documents = new DocumentManager(); documents.openDocument(doc); const bus = new CommandBus(documents);
  const patch = await defaultInpaintingService.createPatchLayer({
    patchBlob: (await assets.getBlob(source.id))!, width: 1, height: 1, bounds: { x: 0, y: 0, width: 1, height: 1 },
    metadata: { provider: 'pixel-fixture', model: 'deterministic', sourceDocumentId: doc.id, sourceLayerId: child.id, maskId: mask.id, timestamp: 1 },
  });
  documents.updateDocument({ ...doc, name: 'newer document' }); const newer = documents.getEditDocument(doc.id)!;
  expect(() => bus.execute(new AddGeneratedPatchLayerCommand(doc.id, patch, documents, doc))).toThrow(/changed|修改/i);
  expect(documents.getEditDocument(doc.id)).toBe(newer); expect(bus.getHistory()).toHaveLength(0);
  const create = installPixelCanvas(); const canvas = create(1, 1); await new WebGLImageEngine().renderEdit(newer, canvas);
  expect(pixelBytes(canvas)).toEqual([255,0,0,255]);
});

it.each(['reveal', 'hide'] as const)('creates a no-selection %s-all mask with correct pixels and stable undo/redo identity', async mode => {
  const source = await raster([255,0,0,255], 1, 1);
  const child = createPaintLayer({ rasterAssetId: source.id, width: 1, height: 1 });
  const doc = createEditDocument({ width: 1, height: 1, layers: [createGroupLayer({ children: [child] })], backgroundColor: 'transparent' });
  const documents = new DocumentManager(); documents.openDocument(doc); const bus = new CommandBus(documents);
  const create = installPixelCanvas(); const engine = new WebGLImageEngine();
  const render = async () => { const canvas = create(1, 1); await engine.renderEdit(documents.getEditDocument(doc.id)!, canvas); return pixelBytes(canvas); };
  expect(await render()).toEqual([255,0,0,255]);
  await bus.execute(new CreateMaskFromSelectionCommand(doc.id, child.id, mode, documents));
  const mask = findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.mask!;
  const expected = mode === 'hide' ? [0,0,0,0] : [255,0,0,255];
  expect(await render()).toEqual(expected);
  expect(Array.from((await assets.getMask(mask.assetId))!)).toEqual([mode === 'hide' ? 0 : 255]);
  expect(bus.getHistory()).toHaveLength(1);
  bus.undo(); expect(await render()).toEqual([255,0,0,255]);
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.mask).toBeUndefined();
  bus.redo(); expect(await render()).toEqual(expected);
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.mask).toEqual(mask);
  expect(bus.getHistory()).toHaveLength(1);
});

it('exports independent duplicate pixels and retains the complete locked tree through save/reopen and history', async () => {
  const source = await raster([255,0,0,255,255,255,0,255], 2, 1);
  const child = createPaintLayer({ id: 'source', rasterAssetId: source.id, width: 2, height: 1 });
  const group = createGroupLayer({ id: 'group', children: [child] }); group.transform.x = 1;
  const doc = createEditDocument({ width: 6, height: 2, layers: [group], backgroundColor: 'transparent' });
  const documents = new DocumentManager(); documents.openDocument(doc); const bus = new CommandBus(documents);
  const service = new LayerOperationService(documents, bus, assets);
  const result = await service.duplicate(doc.id, child.id); await service.align(doc.id, result.layerId, 'right');
  const replacement = await raster([0,0,255,255,0,255,255,255], 2, 1);
  bus.execute(new BrushStrokeCommand(doc.id, result.layerId, {} as any, source.id, replacement.id, documents));
  await service.setLocked(doc.id, group.id, true);
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)).toEqual(child);
  const create = installPixelCanvas(); const engine = new WebGLImageEngine();
  const render = async (document: typeof doc) => { const canvas = create(6, 2); await engine.renderEdit(document, canvas); return pixelBytes(canvas); };
  const expected = [0,0,0,0,255,0,0,255,255,255,0,255,0,0,0,0,0,0,255,255,0,255,255,255,...Array(24).fill(0)];
  expect(await render(documents.getEditDocument(doc.id)!)).toEqual(expected);
  const serializer = new ProjectSerializer();
  const reopened = await serializer.hydrate(await serializer.serialize(documents.getEditDocument(doc.id)!, assets), assets);
  expect(reopened.layers[0].locked).toBe(true); expect(await render(reopened)).toEqual(expected);
  bus.undo(); bus.undo();
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, result.layerId)!.type).toBe('paint');
  expect(await render(documents.getEditDocument(doc.id)!)).toEqual([0,0,0,0,255,0,0,255,255,255,0,255,0,0,0,0,255,0,0,255,255,255,0,255,...Array(24).fill(0)]);
  bus.redo(); bus.redo(); expect(await render(documents.getEditDocument(doc.id)!)).toEqual(expected);
});

it('rejects locked-parent rasterization before allocating pixels', async () => {
  const asset = await raster([255,0,0,255], 1, 1);
  const smart = createSmartObjectLayer({ sourceAssetId: asset.id, originalWidth: 1, originalHeight: 1 });
  const group = createGroupLayer({ children: [smart] }); group.locked = true;
  const doc = createEditDocument({ layers: [group] }); const documents = new DocumentManager(); documents.openDocument(doc);
  const bus = new CommandBus(documents); const count = assets.listAssets().length;
  await expect(bus.execute(new RasterizeSmartObjectCommand(doc.id, smart.id, documents))).rejects.toThrow(/locked|锁定/i);
  expect(assets.listAssets()).toHaveLength(count); expect(documents.getEditDocument(doc.id)).toBe(doc); expect(bus.getHistory()).toHaveLength(0);
});

it('rejects a mask registration raced by a document edit and releases its new resource', async () => {
  const child = createPaintLayer({ rasterAssetId: 'source', width: 2, height: 1 });
  const doc = createEditDocument({ width: 2, height: 1, layers: [createGroupLayer({ children: [child] })] });
  const documents = new DocumentManager(); documents.openDocument(doc); const bus = new CommandBus(documents);
  const count = assets.listAssets().length; const register = assets.registerMask.bind(assets);
  vi.spyOn(assets, 'registerMask').mockImplementation(async (...args) => {
    const asset = await register(...args); documents.updateDocument({ ...documents.getEditDocument(doc.id)!, name: 'newer edit' }); return asset;
  });
  await expect(bus.execute(new CreateMaskFromSelectionCommand(doc.id, child.id, 'reveal', documents))).rejects.toThrow(/修改|关闭/i);
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.mask).toBeUndefined();
  expect(documents.getEditDocument(doc.id)!.name).toBe('newer edit'); expect(assets.listAssets()).toHaveLength(count); expect(bus.getHistory()).toHaveLength(0);
});

it('matches UI operations through the scoped AI bus and MCP name mapping, including locked errors', async () => {
  const registry = new ToolRegistry();
  const child = createPaintLayer({ id: 'child', rasterAssetId: 'pixels', width: 20, height: 10, x: 25, y: 15 }); child.transform.rotation = 90;
  const doc = createEditDocument({ id: 'equivalence', width: 100, height: 80, layers: [createGroupLayer({ id: 'group', children: [child] })] });
  const uiDocuments = new DocumentManager(); const aiDocuments = new DocumentManager(); uiDocuments.openDocument(structuredClone(doc)); aiDocuments.openDocument(structuredClone(doc));
  const uiBus = new CommandBus(uiDocuments); const aiBus = new CommandBus(aiDocuments); aiBus.beginAgentRun('task-layer', 'layers');
  const context = { documentManager: aiDocuments, commandBus: aiBus.forAgentRun('task-layer'), currentWorkspace: 'edit' as const };
  const ui = new LayerOperationService(uiDocuments, uiBus, assets);
  for (const [name, extra, action] of [
    ['edit_align_layer', { alignment: 'right' }, () => ui.align(doc.id, child.id, 'right')],
    ['edit_flip_layer', { axis: 'vertical' }, () => ui.flip(doc.id, child.id, 'vertical')],
    ['edit_set_layer_locked', { locked: true }, () => ui.setLocked(doc.id, child.id, true)],
  ] as const) {
    await action(); const result = await registry.get(name)!.execute(context, { documentId: doc.id, layerId: child.id, ...extra }, name);
    expect(result.success).toBe(true); expect(result.commandId).toBeTruthy();
    expect(findLayerById(aiDocuments.getEditDocument(doc.id)!.layers, child.id)).toEqual(findLayerById(uiDocuments.getEditDocument(doc.id)!.layers, child.id));
    expect(MCPSchemaAdapter.mcpToCanonicalName(MCPSchemaAdapter.canonicalToMcpName(name))).toBe(name);
  }
  const blocked = await registry.get('edit_transform')!.execute(context, { documentId: doc.id, layerId: child.id, x: 0 }, 'locked-transform');
  expect(blocked.success).toBe(false); expect(blocked.error?.code).toBe('LAYER_LOCKED'); expect(aiBus.getHistory()).toHaveLength(3);
  expect(aiBus.getHistory().every(entry => entry.agentRunId === 'task-layer')).toBe(true);
  aiBus.commitAgentRun(); const before = aiDocuments.getEditDocument(doc.id);
  const stale = await registry.get('edit_set_layer_locked')!.execute(context, { documentId: doc.id, layerId: child.id, locked: false }, 'stale-run');
  expect(stale.success).toBe(false); expect(aiDocuments.getEditDocument(doc.id)).toBe(before);
});

it('flips real rotated pixels around the same displayed center and restores them in one undo', async () => {
  const asset = await raster([255,0,0,255,255,255,0,255], 2, 1);
  const child = createPaintLayer({ rasterAssetId: asset.id, width: 2, height: 1, x: 1 }); child.transform.rotation = 90;
  const group = createGroupLayer({ children: [child] }); group.transform.x = 1;
  const doc = createEditDocument({ width: 4, height: 4, backgroundColor: 'transparent', layers: [group] });
  const documents = new DocumentManager(); documents.openDocument(doc); const bus = new CommandBus(documents);
  const service = new LayerOperationService(documents, bus, assets); const create = installPixelCanvas(); const engine = new WebGLImageEngine();
  const render = async () => { const canvas = create(4, 4); await engine.renderEdit(documents.getEditDocument(doc.id)!, canvas); return pixelBytes(canvas); };
  const before = Array(64).fill(0); before.splice(4, 4, 255,0,0,255); before.splice(20, 4, 255,255,0,255);
  expect(await render()).toEqual(before);
  await service.flip(doc.id, child.id, 'horizontal');
  const flipped = Array(64).fill(0); flipped.splice(4, 4, 255,255,0,255); flipped.splice(20, 4, 255,0,0,255);
  expect(await render()).toEqual(flipped); expect(bus.getHistory()).toHaveLength(1);
  bus.undo(); expect(await render()).toEqual(before); bus.redo(); expect(await render()).toEqual(flipped);
});

it('discards a fresh paint resource when registration races a newer document revision', async () => {
  const asset = await raster([255,0,0,255], 1, 1);
  const child = createPaintLayer({ rasterAssetId: asset.id, width: 1, height: 1 });
  const doc = createEditDocument({ width: 1, height: 1, layers: [createGroupLayer({ children: [child] })] });
  const documents = new DocumentManager(); documents.openDocument(doc); const bus = new CommandBus(documents);
  const brush = new BrushEngine(undefined, documents);
  await brush.startStroke({ documentId: doc.id, layerId: child.id, initialPoint: { x: 0, y: 0 }, initialAssetId: asset.id, width: 1, height: 1, settings: { size: 1, color: '#00ff00' } });
  const count = assets.listAssets().length; const register = assets.registerBlob.bind(assets);
  vi.spyOn(assets, 'registerBlob').mockImplementation(async (...args) => {
    const asset = await register(...args); documents.updateDocument({ ...documents.getEditDocument(doc.id)!, name: 'newer paint edit' }); return asset;
  });
  await expect(brush.endStroke(bus, documents)).rejects.toThrow(/changed|修改/i);
  expect(assets.listAssets()).toHaveLength(count); expect(brush.isPainting).toBe(false); expect(bus.getHistory()).toHaveLength(0);
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.type).toBe('paint');
  expect(documents.getEditDocument(doc.id)!.name).toBe('newer paint edit');
});

it('returns the same locked error across existing canonical content routes', async () => {
  const child = createPaintLayer({ id: 'locked-child', rasterAssetId: 'immutable-pixels', width: 2, height: 1 });
  const group = createGroupLayer({ children: [child] }); group.locked = true;
  const doc = createEditDocument({ layers: [group] }); doc.selectedLayerId = child.id;
  const documents = new DocumentManager(); documents.openDocument(doc); const bus = new CommandBus(documents); const registry = new ToolRegistry();
  for (const name of ['edit_transform', 'edit_delete_layer', 'edit_rename_layer', 'edit_set_layer_opacity', 'edit_set_blend_mode', 'edit_brush_stroke', 'edit_paint_mask', 'edit_draw_gradient', 'edit_create_smart_object', 'edit_set_adjustment_settings', 'edit_clone_stamp', 'edit_heal']) {
    const tool = registry.get(name); expect(tool, name).toBeDefined();
    const result = await tool!.execute({ documentManager: documents, commandBus: bus, currentWorkspace: 'edit' }, { documentId: doc.id, layerId: child.id, x: 0, name: 'changed' }, name);
    expect(result.success, name).toBe(false); expect(result.error?.code, name).toBe('LAYER_LOCKED');
  }
  expect(documents.getEditDocument(doc.id)).toBe(doc); expect(bus.getHistory()).toHaveLength(0);
});
