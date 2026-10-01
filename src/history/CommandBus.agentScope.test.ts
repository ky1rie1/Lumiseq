import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { createDevelopDocument } from '../document/DevelopDocument';
import { DevelopOperationService } from '../develop/DevelopOperationService';
import { CommandBus } from './CommandBus';
import { SystemUndoTool, SystemRedoTool } from '../ai/tools/system';
import { SetExposureCommand } from '../commands/develop/SetExposureCommand';

function setup() {
  const docs = new DocumentManager();
  const doc = createDevelopDocument({ sourceUri: 'photo.jpg', fileName: 'photo.jpg', isRaw: false });
  docs.openDocument(doc);
  const bus = new CommandBus(docs);
  const manual = new DevelopOperationService(docs, bus);
  return { docs, doc, bus, manual, exposure: () => docs.getDevelopDocument(doc.id)!.settings.exposure };
}

describe('explicit AI command ownership', () => {
  it('reports blocked rollback even if it can abort only the unfinished task preview', () => {
    const { bus, docs, doc, manual, exposure } = setup();
    bus.beginAgentRun('AI', 'AI');
    const ai = new DevelopOperationService(docs, bus.forAgentRun('AI'));
    ai.setParameter({ documentId: doc.id, parameterId: 'exposure', value: 1, source: 'ai' });
    manual.setParameter({ documentId: doc.id, parameterId: 'exposure', value: 2, source: 'manual' });
    ai.beginParameterChange(doc.id, 'contrast');
    ai.previewParameterChange(doc.id, 'contrast', 10);
    expect(bus.rollbackAgentRun('AI')).toBe(false);
    expect(exposure()).toBe(2);
    expect(docs.getDevelopDocument(doc.id)!.settings.contrast).toBe(0);
    expect(bus.getHistory().map(entry => entry.agentRunId)).toEqual(['AI', undefined]);
  });
  it('lets canonical AI undo and redo use the same history as UI controls', async () => {
    const { bus, docs, doc, manual, exposure } = setup();
    manual.setParameter({ documentId: doc.id, parameterId: 'exposure', value: 1, source: 'manual' });
    bus.beginAgentRun('history-tool', 'Undo and redo');
    const context = { documentManager: docs, commandBus: bus.forAgentRun('history-tool'), currentWorkspace: 'develop' as const };
    expect((await new SystemUndoTool().execute(context, {}, 'undo')).success).toBe(true);
    expect(exposure()).toBe(0);
    expect((await new SystemRedoTool().execute(context, {}, 'redo')).success).toBe(true);
    expect(exposure()).toBe(1);
  });

  it('blocks scoped undo during a slider transaction and permits it after commit', () => {
    const { bus, doc, manual, exposure } = setup();
    bus.beginAgentRun('history-tool', 'Undo');
    const scope = bus.forAgentRun('history-tool');
    manual.beginParameterChange(doc.id, 'exposure');
    manual.previewParameterChange(doc.id, 'exposure', 1);
    expect(() => scope.undo()).toThrow();
    expect(exposure()).toBe(1);
    manual.commitParameterChange();
    expect(scope.undo()).toBe(true);
    expect(exposure()).toBe(0);
  });

  it('blocks scoped history changes during an async command and permits them after completion', async () => {
    const { bus, docs, doc, exposure } = setup();
    bus.beginAgentRun('history-tool', 'Undo');
    const scope = bus.forAgentRun('history-tool');
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const command = new SetExposureCommand(doc.id, 1, docs);
    const execute = command.execute.bind(command);
    command.execute = async () => { await waiting; execute(); };
    command.redo = execute;
    const pending = bus.execute(command);
    expect(() => scope.undo()).toThrow();
    expect(() => scope.redo()).toThrow();
    finish();
    await pending;
    expect(scope.undo()).toBe(true);
    expect(exposure()).toBe(0);
    expect(scope.redo()).toBe(true);
    expect(exposure()).toBe(1);
  });

  it('aborts its unfinished scoped transaction when the run rolls back', () => {
    const { bus, docs, doc, exposure } = setup();
    bus.beginAgentRun('tx', 'AI');
    const ai = new DevelopOperationService(docs, bus.forAgentRun('tx'));
    ai.beginParameterChange(doc.id, 'exposure');
    ai.previewParameterChange(doc.id, 'exposure', 1);
    expect(bus.rollbackAgentRun('tx')).toBe(true);
    expect(exposure()).toBe(0);
    expect(bus.getHistory()).toHaveLength(0);
  });
  it('keeps ordinary UI commands manual while an AI run is waiting', () => {
    const { bus, manual, doc, exposure } = setup();
    bus.beginAgentRun('waiting', 'AI');
    manual.setParameter({ documentId: doc.id, parameterId: 'exposure', value: 2, source: 'manual' });
    expect(bus.getHistory()[0].agentRunId).toBeUndefined();
    expect(bus.rollbackAgentRun('waiting')).toBe(false);
    expect(exposure()).toBe(2);
  });

  it('does not merge manual edits into scoped AI commands and refuses an unsafe rollback', () => {
    const { bus, manual, docs, doc, exposure } = setup();
    bus.beginAgentRun('AI', 'AI');
    const ai = new DevelopOperationService(docs, bus.forAgentRun('AI'));
    ai.setParameter({ documentId: doc.id, parameterId: 'exposure', value: 1, source: 'ai' });
    manual.setParameter({ documentId: doc.id, parameterId: 'exposure', value: 2, source: 'manual' });
    const before = bus.getHistory();
    expect(before.map(entry => entry.agentRunId)).toEqual(['AI', undefined]);
    expect(bus.rollbackAgentRun('AI')).toBe(false);
    expect(exposure()).toBe(2);
    expect(bus.getHistory()).toEqual(before);
  });

  it('refuses to undo an older run without changing later work or history', () => {
    const { bus, manual, docs, doc, exposure } = setup();
    bus.beginAgentRun('old', 'AI');
    new DevelopOperationService(docs, bus.forAgentRun('old')).setParameter({ documentId: doc.id, parameterId: 'exposure', value: 1, source: 'ai' });
    bus.commitAgentRun();
    manual.setParameter({ documentId: doc.id, parameterId: 'exposure', value: 2, source: 'manual' });
    const before = bus.getHistory();
    expect(bus.getAgentRunUndoBlockReason('old')).toContain('后续');
    expect(bus.rollbackAgentRun('old')).toBe(false);
    expect(exposure()).toBe(2);
    expect(bus.getHistory()).toEqual(before);
  });

  it('tags transactions with their own source instead of the ambient task', () => {
    const { bus, docs, doc, manual, exposure } = setup();
    bus.beginAgentRun('AI', 'AI');
    manual.beginParameterChange(doc.id, 'exposure');
    manual.previewParameterChange(doc.id, 'exposure', 2);
    manual.commitParameterChange();
    const ai = new DevelopOperationService(docs, bus.forAgentRun('AI'));
    ai.setParameter({ documentId: doc.id, parameterId: 'contrast', value: 10, source: 'ai' });
    expect(bus.getHistory().map(entry => entry.agentRunId)).toEqual([undefined, 'AI']);
    expect(bus.rollbackAgentRun('AI')).toBe(true);
    expect(exposure()).toBe(2);
  });

  it('rejects a stale scope before it can mutate a document', () => {
    const { bus, docs, doc, exposure } = setup();
    bus.beginAgentRun('ended', 'AI');
    const ai = new DevelopOperationService(docs, bus.forAgentRun('ended'));
    bus.commitAgentRun();
    expect(() => ai.setParameter({ documentId: doc.id, parameterId: 'exposure', value: 1, source: 'ai' })).toThrow();
    expect(exposure()).toBe(0);
    expect(bus.getHistory()).toHaveLength(0);
  });

  it('closes a scoped transaction with its run and blocks stale preview/undo', () => {
    const { bus, docs, doc, exposure } = setup();
    bus.beginAgentRun('tx', 'AI');
    const scope = bus.forAgentRun('tx');
    const ai = new DevelopOperationService(docs, scope);
    ai.beginParameterChange(doc.id, 'exposure');
    ai.previewParameterChange(doc.id, 'exposure', 1);
    bus.commitAgentRun();
    expect(bus.getHistory()).toHaveLength(1);
    expect(() => ai.previewParameterChange(doc.id, 'exposure', 2)).toThrow();
    expect(() => scope.undo()).toThrow();
    expect(exposure()).toBe(1);
  });

  it('does not let a scoped transaction controller commit a manual transaction', () => {
    const { bus, doc, manual, exposure } = setup();
    bus.beginAgentRun('AI', 'AI');
    manual.beginParameterChange(doc.id, 'exposure');
    manual.previewParameterChange(doc.id, 'exposure', 2);
    expect(() => bus.forAgentRun('AI').abortTransaction()).toThrow();
    expect(exposure()).toBe(2);
    manual.commitParameterChange();
    expect(bus.getHistory()[0].agentRunId).toBeUndefined();
  });
});
