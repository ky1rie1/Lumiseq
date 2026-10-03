import { expect, it } from 'vitest';
import { DocumentManager } from '../../document/DocumentManager';
import { createDevelopDocument } from '../../document/DevelopDocument';
import { CommandBus } from '../../history/CommandBus';
import { ResetDevelopSettingsCommand } from './ResetDevelopSettingsCommand';

it.each([undefined, 1, 2] as const)('preserves rendering version %s through reset, undo and redo', async version => {
  const docs = new DocumentManager(), history = new CommandBus(docs);
  const doc = createDevelopDocument({ sourceUri: 'sample.arw', fileName: 'sample.arw', isRaw: true });
  doc.settings.renderingVersion = version;
  doc.settings.exposure = 2;
  doc.settings.whiteBalance.cameraMultipliers = [2, 1, 1.5, 1];
  docs.openDocument(doc);
  await history.execute(new ResetDevelopSettingsCommand(doc.id, docs));
  expect(docs.getDevelopDocument(doc.id)!.settings.renderingVersion ?? 1).toBe(version ?? 1);
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
  expect(docs.getDevelopDocument(doc.id)!.settings.whiteBalance.cameraMultipliers).toEqual([2, 1, 1.5, 1]);
  history.undo();
  expect(docs.getDevelopDocument(doc.id)!.settings).toEqual(doc.settings);
  history.redo();
  expect(docs.getDevelopDocument(doc.id)!.settings.renderingVersion ?? 1).toBe(version ?? 1);
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
});
