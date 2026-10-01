// tests/DevelopStoreAndCommands.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultCommandBus } from '../src/history/CommandBus';
import { createDevelopDocument, createDefaultDevelopSettings } from '../src/document/DevelopDocument';
import { UpdateDevelopSettingsCommand } from '../src/commands/develop/UpdateDevelopSettingsCommand';
import { useDevelopStore } from '../src/stores/useDevelopStore';

describe('Develop Store & CommandBus Transaction Coalescing', () => {
  beforeEach(() => {
    defaultCommandBus.clear();
  });

  it('updates basic develop settings and properly records undo/redo', () => {
    const doc = createDevelopDocument({
      sourceUri: 'file:///test/photo.jpg',
      fileName: 'photo.jpg',
      isRaw: false,
    });
    defaultDocumentManager.openDocument(doc);

    // Initial exposure is 0.0
    expect(defaultDocumentManager.getDevelopDocument(doc.id)?.settings.exposure).toBe(0.0);

    // Execute update command
    const cmd = new UpdateDevelopSettingsCommand(
      doc.id,
      { exposure: 1.5, contrast: 25 },
      'Adjust Tone',
      defaultDocumentManager
    );
    defaultCommandBus.execute(cmd);

    const updated = defaultDocumentManager.getDevelopDocument(doc.id);
    expect(updated?.settings.exposure).toBe(1.5);
    expect(updated?.settings.contrast).toBe(25);

    // Undo
    defaultCommandBus.undo();
    const undone = defaultDocumentManager.getDevelopDocument(doc.id);
    expect(undone?.settings.exposure).toBe(0.0);
    expect(undone?.settings.contrast).toBe(0);

    // Redo
    defaultCommandBus.redo();
    const redone = defaultDocumentManager.getDevelopDocument(doc.id);
    expect(redone?.settings.exposure).toBe(1.5);
    expect(redone?.settings.contrast).toBe(25);
  });

  it('coalesces slider drag previews into a single command transaction (Rule 2)', () => {
    const doc = createDevelopDocument({
      sourceUri: 'file:///test/raw_test.cr2',
      fileName: 'raw_test.cr2',
      isRaw: true,
    });
    defaultDocumentManager.openDocument(doc);

    const store = useDevelopStore.getState();

    // Start drag
    store.startSettingDrag(doc.id, 'Scrub Texture');
    expect(defaultCommandBus.canUndo()).toBe(false);

    // Multiple drag previews
    store.previewSettingDrag(doc.id, 'texture', 10);
    store.previewSettingDrag(doc.id, 'texture', 25);
    store.previewSettingDrag(doc.id, 'texture', 40);

    // Commit drag
    store.commitSettingDrag();

    // Exactly 1 history transaction committed!
    expect(defaultCommandBus.canUndo()).toBe(true);
    expect(defaultDocumentManager.getDevelopDocument(doc.id)?.settings.texture).toBe(40);

    // Undoing takes it back to 0 in one step
    defaultCommandBus.undo();
    expect(defaultDocumentManager.getDevelopDocument(doc.id)?.settings.texture).toBe(0);
    expect(defaultCommandBus.canUndo()).toBe(false);
  });

  it('supports section reset via resetSection', () => {
    const doc = createDevelopDocument({
      sourceUri: 'file:///test/raw_test.cr2',
      fileName: 'raw_test.cr2',
      isRaw: true,
    });
    defaultDocumentManager.openDocument(doc);

    const store = useDevelopStore.getState();

    // Modify multiple basic tone parameters
    store.updateSetting(doc.id, 'exposure', 2.0);
    store.updateSetting(doc.id, 'contrast', 50);
    store.updateSetting(doc.id, 'highlights', -30);

    expect(defaultDocumentManager.getDevelopDocument(doc.id)?.settings.exposure).toBe(2.0);

    // Reset section
    store.resetSection(doc.id, 'basic');

    const resetDoc = defaultDocumentManager.getDevelopDocument(doc.id);
    expect(resetDoc?.settings.exposure).toBe(0.0);
    expect(resetDoc?.settings.contrast).toBe(0);
    expect(resetDoc?.settings.highlights).toBe(0);

    // Undo should restore the modified values
    defaultCommandBus.undo();
    const restoredDoc = defaultDocumentManager.getDevelopDocument(doc.id);
    expect(restoredDoc?.settings.exposure).toBe(2.0);
    expect(restoredDoc?.settings.contrast).toBe(50);
    expect(restoredDoc?.settings.highlights).toBe(-30);
  });

  it('merges repeated setting updates without losing earlier fields on redo', () => {
    const doc = createDevelopDocument({
      sourceUri: 'file:///test/photo.jpg',
      fileName: 'photo.jpg',
      isRaw: false,
    });
    defaultDocumentManager.openDocument(doc);
    const store = useDevelopStore.getState();

    store.updateSetting(doc.id, 'exposure', 1, 'Adjust Tone');
    store.updateSetting(doc.id, 'contrast', 20, 'Adjust Tone');
    store.updateSetting(doc.id, 'exposure', 2, 'Adjust Tone');

    expect(defaultCommandBus.getHistory()).toHaveLength(1);
    expect(defaultDocumentManager.getDevelopDocument(doc.id)?.settings).toMatchObject({ exposure: 2, contrast: 20 });

    defaultCommandBus.undo();
    expect(defaultDocumentManager.getDevelopDocument(doc.id)?.settings).toMatchObject({ exposure: 0, contrast: 0 });
    defaultCommandBus.redo();
    expect(defaultDocumentManager.getDevelopDocument(doc.id)?.settings).toMatchObject({ exposure: 2, contrast: 20 });
  });
});
