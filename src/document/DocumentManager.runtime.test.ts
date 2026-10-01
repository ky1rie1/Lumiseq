import { expect, it } from 'vitest';
import { createDevelopDocument } from './DevelopDocument';
import { DocumentManager } from './DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { UpdateDevelopSettingsCommand } from '../commands/develop/UpdateDevelopSettingsCommand';

it('keeps a saved RAW project clean while its decoder updates runtime state', () => {
  const documents = new DocumentManager();
  const raw = createDevelopDocument({ sourceUri: 'C:\\photo.cr3', fileName: 'photo.cr3', isRaw: true });
  documents.openDocument(raw);
  documents.updateDocument({ ...raw, rawState: 'decoding' }, 'RAW decode', false);
  expect(documents.getDevelopDocument(raw.id)?.isDirty).toBe(false);
  documents.updateDocument({ ...raw, settings: { ...raw.settings, exposure: 1 } }, 'Exposure');
  documents.updateDocument({ ...raw, rawState: 'ready' }, 'RAW ready', false);
  expect(documents.getDevelopDocument(raw.id)?.isDirty).toBe(true);
});

it('preserves all persisted edits when an older RAW runtime document is published', () => {
  const documents = new DocumentManager();
  const raw = createDevelopDocument({ sourceUri: 'C:\\photo.cr3', fileName: 'photo.cr3', isRaw: true });
  documents.openDocument(raw);
  const snapshot = { id: 'new-snapshot', name: 'Current look', createdAt: 1, settings: structuredClone(raw.settings) };
  documents.updateDocument({ ...raw, fileName: 'renamed.cr3', settingsSnapshots: [snapshot], settings: { ...raw.settings, exposure: 2 } }, 'Save look');
  const edited = documents.getDevelopDocument(raw.id)!;
  documents.updateDocument({ ...raw, rawState: 'ready', rawProgress: 100 }, 'Old decode result', false);
  const current = documents.getDevelopDocument(raw.id)!;
  expect(current.settingsSnapshots).toEqual([snapshot]);
  expect(current.fileName).toBe('renamed.cr3');
  expect(current.settings.exposure).toBe(2);
  expect(current.updatedAt).toBe(edited.updatedAt);
  expect(current.isDirty).toBe(true);
});

it('does not resurrect a deleted snapshot from an older RAW runtime document', () => {
  const documents = new DocumentManager();
  const raw = createDevelopDocument({ sourceUri: 'C:\\photo.cr3', fileName: 'photo.cr3', isRaw: true });
  raw.settingsSnapshots = [{ id: 'old-snapshot', name: 'Old look', createdAt: 1, settings: structuredClone(raw.settings) }];
  documents.openDocument(raw);
  documents.updateDocument({ ...raw, settingsSnapshots: [] }, 'Delete look');
  documents.updateDocument({ ...raw, rawState: 'ready' }, 'Old decode result', false);
  expect(documents.getDevelopDocument(raw.id)!.settingsSnapshots).toEqual([]);
});

it('keeps the latest RAW decoder state and camera metadata through transaction undo and redo', () => {
  const documents = new DocumentManager();
  const raw = createDevelopDocument({ sourceUri: 'C:\\photo.cr3', fileName: 'photo.cr3', isRaw: true });
  documents.openDocument(raw);
  const bus = new CommandBus(documents);
  bus.beginTransaction('Exposure drag', raw.id);
  bus.preview(new UpdateDevelopSettingsCommand(raw.id, { exposure: 1 }, 'Exposure', documents));
  bus.commitTransaction();
  documents.updateDevelopRuntime(raw.id, { rawState: 'ready', rawProgress: 100, activeJobId: null,
    nativeAssetId: 'decoded-native', sourceAssetId: 'decoded-preview', previewAssetId: 'decoded-preview',
    rawEngineAttached: true, width: 6000, height: 4000,
    exif: { cameraMake: 'Decoded camera' }, cameraMultipliers: [2, 1, 1.5, 1] });
  for (const [action, expectedExposure] of [[() => bus.undo(), 0], [() => bus.redo(), 1]] as const) {
    expect(action()).toBe(true);
    const current = documents.getDevelopDocument(raw.id)!;
    expect(current.settings.exposure).toBe(expectedExposure);
    expect(current.rawState).toBe('ready');
    expect(current.nativeAssetId).toBe('decoded-native');
    expect(current.sourceAssetId).toBe('decoded-preview');
    expect(current.previewAssetId).toBe('decoded-preview');
    expect(current.rawProgress).toBe(100);
    expect(current.activeJobId).toBeNull();
    expect(current.width).toBe(6000);
    expect(current.height).toBe(4000);
    expect(current.exif.cameraMake).toBe('Decoded camera');
    expect(current.settings.whiteBalance.cameraMultipliers).toEqual([2, 1, 1.5, 1]);
  }
});

it('keeps RAW decoding ownership when a slider transaction aborts', () => {
  const documents = new DocumentManager();
  const raw = createDevelopDocument({ sourceUri: 'C:\\photo.cr3', fileName: 'photo.cr3', isRaw: true });
  documents.openDocument(raw);
  const bus = new CommandBus(documents);
  bus.beginTransaction('Exposure drag', raw.id);
  bus.preview(new UpdateDevelopSettingsCommand(raw.id, { exposure: 1 }, 'Exposure', documents));
  documents.updateDevelopRuntime(raw.id, { rawState: 'decoding', activeJobId: 'current-job', rawProgress: 70 });
  bus.abortTransaction();
  const current = documents.getDevelopDocument(raw.id)!;
  expect(current.settings.exposure).toBe(0);
  expect(current.rawState).toBe('decoding');
  expect(current.activeJobId).toBe('current-job');
  expect(current.rawProgress).toBe(70);
  expect(bus.getHistory()).toHaveLength(0);
});
