import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { SetExposureCommand } from '../src/commands/develop/SetExposureCommand';

describe('CommandBus & Undo/Redo Engine', () => {
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

  it('1. SetExposureCommand changes DevelopDocument params', () => {
    const cmd = new SetExposureCommand(docId, 1.25, docManager);
    commandBus.execute(cmd);

    const doc = docManager.getDevelopDocument(docId);
    expect(doc?.settings.exposure).toBe(1.25);
    expect(commandBus.canUndo()).toBe(true);
    expect(commandBus.canRedo()).toBe(false);
  });

  it('2. Undo restores previous value', () => {
    const cmd = new SetExposureCommand(docId, 0.75, docManager);
    commandBus.execute(cmd);

    const undone = commandBus.undo();
    expect(undone).toBe(true);

    const doc = docManager.getDevelopDocument(docId);
    expect(doc?.settings.exposure).toBe(0.0);
    expect(commandBus.canUndo()).toBe(false);
    expect(commandBus.canRedo()).toBe(true);
  });

  it('3. Redo reapplies new value', () => {
    const cmd = new SetExposureCommand(docId, 0.75, docManager);
    commandBus.execute(cmd);
    commandBus.undo();

    const redone = commandBus.redo();
    expect(redone).toBe(true);

    const doc = docManager.getDevelopDocument(docId);
    expect(doc?.settings.exposure).toBe(0.75);
    expect(commandBus.canUndo()).toBe(true);
    expect(commandBus.canRedo()).toBe(false);
  });

  it('keeps the latest value and original undo state when commands merge', () => {
    commandBus.execute(new SetExposureCommand(docId, 0.5, docManager));
    commandBus.execute(new SetExposureCommand(docId, 1.25, docManager));

    expect(commandBus.getHistory()).toHaveLength(1);
    expect(docManager.getDevelopDocument(docId)?.settings.exposure).toBe(1.25);

    commandBus.undo();
    expect(docManager.getDevelopDocument(docId)?.settings.exposure).toBe(0);
    commandBus.redo();
    expect(docManager.getDevelopDocument(docId)?.settings.exposure).toBe(1.25);
  });

  it('clears the redo branch when a new command merges into history', () => {
    commandBus.execute(new SetExposureCommand(docId, 0.5, docManager));
    commandBus.execute(new SetExposureCommand(docId, 1.25, docManager));
    commandBus.undo();
    expect(commandBus.canRedo()).toBe(true);

    commandBus.execute(new SetExposureCommand(docId, 2, docManager));

    expect(commandBus.canRedo()).toBe(false);
    expect(docManager.getDevelopDocument(docId)?.settings.exposure).toBe(2);
  });

  it('keeps separate agent runs independently reversible', () => {
    commandBus.beginAgentRun('run-one', 'First adjustment');
    commandBus.forAgentRun('run-one').execute(new SetExposureCommand(docId, 0.5, docManager));
    commandBus.commitAgentRun();

    commandBus.beginAgentRun('run-two', 'Second adjustment');
    commandBus.forAgentRun('run-two').execute(new SetExposureCommand(docId, 1.25, docManager));
    commandBus.commitAgentRun();

    expect(commandBus.getHistory()).toHaveLength(2);
    expect(commandBus.rollbackAgentRun('run-two')).toBe(true);
    expect(docManager.getDevelopDocument(docId)?.settings.exposure).toBe(0.5);
  });
});
