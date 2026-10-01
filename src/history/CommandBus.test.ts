import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument } from '../document/EditDocument';
import type { ICommand, ICommandBus } from '../types/history';
import { CommandBus } from './CommandBus';

function setup() {
  const docs = new DocumentManager();
  const doc = createEditDocument({ name: 'history', width: 10, height: 10 });
  docs.openDocument(doc);
  const bus = new CommandBus(docs);
  let next = 0;
  const command = (): ICommand => {
    const id = String(++next);
    const before = structuredClone(docs.getDocument(doc.id)!);
    const after = { ...before, width: before.width + 1 };
    return { id, name: id, documentId: doc.id, timestamp: 0,
      execute: () => docs.updateDocument(after), undo: () => docs.updateDocument(before) };
  };
  const execute = (count: number, executor: ICommandBus = bus) => { for (let i = 0; i < count; i++) executor.execute(command()); };
  return { docs, doc, bus, command, execute };
}

describe('bounded command history', () => {
  it('defaults to 100 retained commands and retains the latest undo/redo result', () => {
    const { bus, execute, docs, doc } = setup();
    execute(105);
    expect(bus.getHistory()).toHaveLength(100);
    for (let i = 0; i < 100; i++) expect(bus.undo()).toBe(true);
    expect(bus.undo()).toBe(false);
    expect(docs.getDocument(doc.id)?.width).toBe(15);
    for (let i = 0; i < 100; i++) expect(bus.redo()).toBe(true);
    expect(docs.getDocument(doc.id)?.width).toBe(115);
  });

  it('validates limits and trims the oldest retained entries across undo and redo', () => {
    const { bus, execute, docs, doc } = setup();
    execute(30);
    for (let i = 0; i < 5; i++) bus.undo();
    for (const invalid of [19, 201, 20.5, NaN, Infinity]) expect(() => bus.setHistoryLimit(invalid)).toThrow();
    bus.setHistoryLimit(20);
    expect(bus.getHistory()).toHaveLength(15);
    for (let i = 0; i < 15; i++) bus.undo();
    expect(bus.undo()).toBe(false);
    expect(docs.getDocument(doc.id)?.width).toBe(20);
    for (let i = 0; i < 20; i++) expect(bus.redo()).toBe(true);
    expect(docs.getDocument(doc.id)?.width).toBe(40);
  });

  it('defers trimming during a transaction and commits all previews as one step', () => {
    const { bus, execute, command, docs, doc } = setup();
    execute(30);
    bus.beginTransaction('resize', doc.id);
    bus.preview(command());
    bus.preview(command());
    bus.setHistoryLimit(20);
    expect(bus.getHistory()).toHaveLength(30);
    bus.commitTransaction();
    expect(bus.getHistory()).toHaveLength(20);
    bus.undo();
    expect(docs.getDocument(doc.id)?.width).toBe(40);
    bus.redo();
    expect(docs.getDocument(doc.id)?.width).toBe(42);
  });

  it('keeps a complete active AI run available for rollback beyond the limit', () => {
    const { bus, execute, docs, doc } = setup();
    bus.setHistoryLimit(20);
    execute(10);
    bus.beginAgentRun('active', 'AI');
    execute(25, bus.forAgentRun('active'));
    expect(bus.getHistory()).toHaveLength(35);
    expect(bus.rollbackAgentRun('active')).toBe(true);
    expect(docs.getDocument(doc.id)?.width).toBe(20);
    bus.commitAgentRun();
    for (let i = 0; i < 25; i++) expect(bus.redo()).toBe(true);
    expect(docs.getDocument(doc.id)?.width).toBe(45);
  });

  it('evicts completed AI runs in whole groups even when a run spans undo and redo', () => {
    const { bus, execute, docs, doc } = setup();
    bus.beginAgentRun('old', 'AI');
    execute(15, bus.forAgentRun('old'));
    bus.commitAgentRun();
    execute(15);
    for (let i = 0; i < 20; i++) bus.undo();
    bus.setHistoryLimit(20);
    expect(bus.getHistory()).toHaveLength(0);
    expect(bus.undoLastAgentRun()).toBe(false);
    for (let i = 0; i < 15; i++) expect(bus.redo()).toBe(true);
    expect(bus.redo()).toBe(false);
    expect(docs.getDocument(doc.id)?.width).toBe(40);
  });

  it('retains a newest oversized run until a later commit can evict the entire group', () => {
    const { bus, execute } = setup();
    bus.setHistoryLimit(20);
    bus.beginAgentRun('large', 'AI');
    execute(25, bus.forAgentRun('large'));
    bus.commitAgentRun();
    expect(bus.getHistory()).toHaveLength(25);
    execute(1);
    expect(bus.getHistory()).toHaveLength(1);
    expect(bus.undoLastAgentRun()).toBe(false);
  });

  it('keeps the run identity and defers trimming while an asynchronous command is executing', async () => {
    const { bus, execute, command } = setup();
    execute(25);
    bus.beginAgentRun('async', 'AI');
    const original = command(); let release!: () => void;
    const waiting = new Promise<void>(resolve => release = resolve);
    const pending = bus.forAgentRun('async').execute({ ...original, execute: async () => { await waiting; original.execute(); } });
    bus.commitAgentRun(); bus.setHistoryLimit(20);
    expect(bus.getHistory()).toHaveLength(25);
    release(); await pending;
    expect(bus.getHistory()).toHaveLength(20);
    expect(bus.getHistory().at(-1)?.agentRunId).toBe('async');
    expect(bus.undoLastAgentRun()).toBe(true);
  });

  it.each([['failed', 25], ['cancelled', 0]] as const)(
    'ends a %s run on rollback so subsequent manual commands are ungrouped and bounded',
    (runId, count) => {
      const { bus, execute, docs, doc } = setup();
      bus.setHistoryLimit(20);
      bus.beginAgentRun(runId, 'AI');
      execute(count, bus.forAgentRun(runId));
      expect(bus.rollbackAgentRun(runId)).toBe(count > 0);
      expect(docs.getDocument(doc.id)?.width).toBe(10);
      execute(30);
      expect(bus.getHistory().every(entry => entry.agentRunId === undefined)).toBe(true);
      expect(bus.getHistory()).toHaveLength(20);
      expect(bus.undoLastAgentRun()).toBe(false);
      for (let i = 0; i < 20; i++) expect(bus.undo()).toBe(true);
      expect(bus.undo()).toBe(false);
      expect(docs.getDocument(doc.id)?.width).toBe(20);
    }
  );

  it('keeps a different active run when rolling back an older completed run', () => {
    const { bus, execute } = setup();
    bus.setHistoryLimit(20);
    bus.beginAgentRun('older', 'AI'); execute(1, bus.forAgentRun('older')); bus.commitAgentRun();
    bus.beginAgentRun('current', 'AI');
    expect(bus.rollbackAgentRun('older')).toBe(true);
    execute(25, bus.forAgentRun('current'));
    expect(bus.getHistory()).toHaveLength(25);
    expect(bus.getHistory().every(entry => entry.agentRunId === 'current')).toBe(true);
    expect(bus.rollbackAgentRun('current')).toBe(true);
  });
});
