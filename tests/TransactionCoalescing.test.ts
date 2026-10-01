import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { SetExposureCommand } from '../src/commands/develop/SetExposureCommand';

describe('Transaction & Command Coalescing (Rule 2)', () => {
  let docManager: DocumentManager;
  let commandBus: CommandBus;
  let docId: string;

  beforeEach(() => {
    docManager = new DocumentManager();
    commandBus = new CommandBus(docManager);

    const doc = createDevelopDocument({
      sourceUri: 'photos/sample.cr3',
      fileName: 'sample.cr3',
      isRaw: true,
      settings: { exposure: 0.0 },
    });
    docManager.openDocument(doc);
    docId = doc.id;
  });

  it('4. Continuous 20 slider previews produce ONLY 1 history entry upon commit', () => {
    // User starts dragging Exposure slider: 0.0 -> 0.8 in 20 intermediate steps
    commandBus.beginTransaction('Adjust Exposure', docId);

    for (let i = 1; i <= 20; i++) {
      const intermediateValue = Number((i * 0.04).toFixed(2)); // 0.04, 0.08, ... 0.80
      const previewCmd = new SetExposureCommand(docId, intermediateValue, docManager);
      commandBus.preview(previewCmd);

      // Intermediate preview state is immediately visible on document
      const currentDoc = docManager.getDevelopDocument(docId);
      expect(currentDoc?.settings.exposure).toBe(intermediateValue);

      // But history must remain EMPTY during the drag!
      expect(commandBus.getHistory().length).toBe(0);
    }

    // User releases mouse, committing transaction
    commandBus.commitTransaction();

    // Now exactly ONE entry in history
    const history = commandBus.getHistory();
    expect(history.length).toBe(1);
    expect(history[0].name).toBe('Adjust Exposure');

    // Final value is 0.80
    const finalDoc = docManager.getDevelopDocument(docId);
    expect(finalDoc?.settings.exposure).toBe(0.8);

    // Single Undo restores ALL THE WAY back to initial 0.0!
    commandBus.undo();
    const revertedDoc = docManager.getDevelopDocument(docId);
    expect(revertedDoc?.settings.exposure).toBe(0.0);

    // Redo restores to 0.80
    commandBus.redo();
    const redoneDoc = docManager.getDevelopDocument(docId);
    expect(redoneDoc?.settings.exposure).toBe(0.8);
  });
});
