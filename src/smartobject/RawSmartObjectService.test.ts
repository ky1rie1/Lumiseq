import { describe, expect, it } from 'vitest';
import { AssetManager } from '../assets/AssetManager';
import { DocumentManager } from '../document/DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { createDevelopDocument } from '../document/DevelopDocument';
import { RawSmartObjectService } from './RawSmartObjectService';

describe('RAW smart objects', () => {
  it('rejects a missing captured original instead of substituting mutable disk bytes', async () => {
    const assets = new AssetManager(), documents = new DocumentManager(), bus = new CommandBus(documents);
    const raw = createDevelopDocument({ sourceUri: 'replaced.arw', fileName: 'sensor.arw', isRaw: true, width: 4, height: 3 });
    raw.originalRawAssetId = 'missing-original'; raw.rawState = 'ready'; raw.nativeAssetId = 'native';
    documents.openDocument(raw);
    let reads = 0;
    const service = new RawSmartObjectService(documents, bus, assets, {
      stage: async () => 'staged.arw', read: async () => { reads++; return new Uint8Array([1, 2, 3]); },
    });
    await expect(service.transfer(raw.id)).rejects.toThrow('原文件资源丢失');
    expect(reads).toBe(0);
    expect(documents.getOpenDocuments()).toHaveLength(1);
  });

  it('transfers original bytes and recipe, re-edits, applies and undoes once', async () => {
    const assets = new AssetManager(), documents = new DocumentManager(), bus = new CommandBus(documents);
    const handle = await assets.registerBlob(new Blob(['original sensor data']), 'image', 'sensor.arw', { width: 4, height: 3 });
    const raw = createDevelopDocument({ sourceUri: 'C:\\sensor.arw', fileName: 'sensor.arw', isRaw: true, width: 4, height: 3 });
    raw.originalRawAssetId = handle.id; raw.rawState = 'ready'; raw.nativeAssetId = 'raw-native'; raw.settings.exposure = 1;
    documents.openDocument(raw);
    const service = new RawSmartObjectService(documents, bus, assets, { stage: async () => 'C:\\staged.arw', read: async () => { throw new Error('must reuse original'); } });
    const edit = await service.transfer(raw.id);
    expect(edit.renderingVersion).toBe(2);
    const layer = edit.layers[0];
    expect(layer.type).toBe('develop-smart-object');
    if (layer.type !== 'develop-smart-object') throw new Error('wrong layer');
    expect(await (await assets.getBlob(layer.sourceAssetId!))!.text()).toBe('original sensor data');
    const variant = await service.openRecipe(edit.id, layer.id);
    variant.settings.exposure = 2;
    documents.updateDocument(variant);
    await service.applyRecipe(variant.id);
    expect((documents.getEditDocument(edit.id)!.layers[0] as any).developSettings.exposure).toBe(2);
    await bus.undo();
    expect((documents.getEditDocument(edit.id)!.layers[0] as any).developSettings.exposure).toBe(1);
  });
});

async function stagedSetup(stage: () => Promise<string>, remove: (path: string) => Promise<void>) {
  const assets = new AssetManager(), documents = new DocumentManager(), bus = new CommandBus(documents);
  const handle = await assets.registerBlob(new Blob(['sensor']), 'image', 'sensor.arw', { width: 4, height: 3 });
  const raw = createDevelopDocument({ sourceUri: 'original.arw', fileName: 'sensor.arw', isRaw: true, width: 4, height: 3 });
  raw.originalRawAssetId = handle.id;raw.rawState = 'ready';raw.nativeAssetId = 'native';documents.openDocument(raw);
  const service = new RawSmartObjectService(documents, bus, assets, { stage, remove, read: async () => new Uint8Array() });
  const edit = await service.transfer(raw.id);
  return { assets, documents, bus, service, edit, layerId: edit.layers[0].id };
}
it('cancels pending staging promptly and removes a late temporary file without opening it', async () => {
  let staged!: (path: string) => void, began!: () => void;const started = new Promise<void>(resolve => { began = resolve; });
  const removed: string[] = [], c = await stagedSetup(() => { began();return new Promise(resolve => { staged = resolve; }); }, async path => { removed.push(path); });
  const controller = new AbortController(), pending = c.service.openRecipe(c.edit.id, c.layerId, controller.signal);
  await started;controller.abort();await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  staged('late.raw');await new Promise(resolve => setTimeout(resolve, 0));
  expect(removed).toEqual(['late.raw']);expect(c.documents.getActiveDocument()?.id).toBe(c.edit.id);
});
it('cleans staged paths on stale opening and successful variant close without releasing original bytes', async () => {
  const removed: string[] = [], c = await stagedSetup(async () => 'variant.raw', async path => { removed.push(path); });
  const variant = await c.service.openRecipe(c.edit.id, c.layerId);
  c.documents.closeDocument(variant.id);await Promise.resolve();expect(removed).toEqual(['variant.raw']);
  expect(await c.assets.getBlob(variant.originalRawAssetId!)).not.toBeNull();
});
it('rejects a user switch while staging and removes the staged file', async () => {
  let staged!: (path: string) => void, began!: () => void;const started = new Promise<void>(resolve => { began = resolve; });
  const removed: string[] = [], c = await stagedSetup(() => { began();return new Promise(resolve => { staged = resolve; }); }, async path => { removed.push(path); });
  const pending = c.service.openRecipe(c.edit.id, c.layerId, new AbortController().signal);await started;
  const other = createDevelopDocument({ sourceUri: 'user.jpg', fileName: 'User', isRaw: false });c.documents.openDocument(other);
  staged('stale.raw');await expect(pending).rejects.toThrow();expect(removed).toEqual(['stale.raw']);expect(c.documents.getActiveDocument()?.id).toBe(other.id);
});
it('guards a cancelled queued apply before mutation and permits redo after a successful apply', async () => {
  const c = await stagedSetup(async () => 'variant.raw', async () => {}), variant = await c.service.openRecipe(c.edit.id, c.layerId);
  variant.settings.exposure = 2;c.documents.updateDocument(variant);
  const execute = c.bus.execute.bind(c.bus);let queued: any, finish!: () => void;
  c.bus.execute = command => { queued = command;return new Promise<void>(resolve => { finish = resolve; }); };
  const controller = new AbortController(), pending = c.service.applyRecipe(variant.id, controller.signal);
  controller.abort();await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(() => queued.execute()).toThrow();finish();expect((c.documents.getEditDocument(c.edit.id)!.layers[0] as any).developSettings.exposure).toBe(0);
  c.bus.execute = execute;await c.service.applyRecipe(variant.id, new AbortController().signal);
  await c.bus.undo();expect((c.documents.getEditDocument(c.edit.id)!.layers[0] as any).developSettings.exposure).toBe(0);
  await c.bus.redo();expect((c.documents.getEditDocument(c.edit.id)!.layers[0] as any).developSettings.exposure).toBe(2);
});
