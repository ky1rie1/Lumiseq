import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../src/document/DocumentManager';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { CommandBus } from '../src/history/CommandBus';
import { DevelopOperationService } from '../src/develop/DevelopOperationService';

function setup() {
  const documents = new DocumentManager();
  const history = new CommandBus(documents);
  const operations = new DevelopOperationService(documents, history);
  const document = createDevelopDocument({ sourceUri: 'test.raw', fileName: 'test.raw', isRaw: true });
  documents.openDocument(document);
  return { documents, history, operations, document };
}

describe('DevelopOperationService', () => {
  it('requires a resolved auto correction before creating an undo entry', () => {
    const { operations, document, history } = setup();
    expect(() => operations.setWhiteBalance(document.id, { mode: 'auto' }, 'ai')).toThrow(/解析/);
    expect(history.canUndo()).toBe(false);
  });

  it('analyzes source pixels once and persists an undoable result for UI and AI', async () => {
    const { documents, history, document } = setup();
    let reads = 0;
    const operations = new DevelopOperationService(documents, history, undefined, async () => {
      reads++;
      return Array.from({ length: 100 }, () => [.24, .2, .17]);
    });
    await operations.resolveAutoWhiteBalance(document.id, 'ai');
    const wb = documents.getDevelopDocument(document.id)!.settings.whiteBalance;
    expect(wb.mode).toBe('auto');
    expect(wb.resolvedAuto?.status).toBe('resolved');
    expect(reads).toBe(1);
    expect(history.getHistory()).toHaveLength(1);
    history.undo();
    expect(documents.getDevelopDocument(document.id)!.settings.whiteBalance.mode).toBe('as-shot');
    history.redo();
    expect(documents.getDevelopDocument(document.id)!.settings.whiteBalance).toEqual(wb);
  });

  it('cancels a pending auto operation on document switching or settings edits', async () => {
    for (const change of ['document', 'settings', 'switch-back']) {
      const { documents, history, document } = setup();
      let finish!: (samples: number[][]) => void;
      const operations = new DevelopOperationService(documents, history, undefined,
        () => new Promise<number[][]>(resolve => { finish = resolve; }));
      const pending = operations.resolveAutoWhiteBalance(document.id, 'manual');
      if (change !== 'settings') {
        documents.setActiveDocument(null);
        if (change === 'switch-back') documents.setActiveDocument(document.id);
      } else operations.setWhiteBalance(document.id, { mode: 'as-shot' }, 'manual');
      finish(Array.from({ length: 100 }, () => [.24, .2, .17]));
      await expect(pending).rejects.toThrow(/cancelled/);
      expect(documents.getDevelopDocument(document.id)!.settings.whiteBalance.mode).toBe('as-shot');
    }
  });

  it('uses one validated path for manual and AI parameter changes', () => {
    const { documents, history, operations, document } = setup();
    operations.setParameter({ documentId: document.id, parameterId: 'exposure', value: 1.2, source: 'manual' });
    expect(documents.getDevelopDocument(document.id)?.settings.exposure).toBe(1.2);
    history.undo();
    operations.setParameter({ documentId: document.id, parameterId: 'exposure', value: 1.2, source: 'ai' });
    expect(documents.getDevelopDocument(document.id)?.settings.exposure).toBe(1.2);
  });

  it('rejects invalid values without mutating the document or history', () => {
    const { documents, history, operations, document } = setup();
    expect(() => operations.setParameter({ documentId: document.id, parameterId: 'exposure', value: Number.NaN, source: 'ai' })).toThrow();
    expect(() => operations.setParameter({ documentId: document.id, parameterId: 'exposure', value: 9, source: 'manual' })).toThrow();
    expect(documents.getDevelopDocument(document.id)?.settings.exposure).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it('preserves nested settings and changes WB mode when adjusting temperature', () => {
    const { documents, operations, document } = setup();
    operations.setParameter({ documentId: document.id, parameterId: 'temperature', value: 6200, source: 'manual' });
    const settings = documents.getDevelopDocument(document.id)?.settings;
    expect(settings?.whiteBalance).toMatchObject({ mode: 'custom', temperature: 6200 });
    operations.setParameter({ documentId: document.id, parameterId: 'sharpenRadius', value: 1.5, source: 'ai' });
    expect(documents.getDevelopDocument(document.id)?.settings.detail).toMatchObject({ sharpenRadius: 1.5, sharpenAmount: 0 });
  });

  it('commits repeated previews as one undoable change', () => {
    const { documents, history, operations, document } = setup();
    operations.beginParameterChange(document.id, 'contrast');
    operations.previewParameterChange(document.id, 'contrast', 10);
    operations.previewParameterChange(document.id, 'contrast', 30);
    operations.commitParameterChange();
    expect(history.getHistory()).toHaveLength(1);
    expect(documents.getDevelopDocument(document.id)?.settings.contrast).toBe(30);
    history.undo();
    expect(documents.getDevelopDocument(document.id)?.settings.contrast).toBe(0);
  });

  it('routes white balance, curves, and section reset through reversible commands', () => {
    const { documents, history, operations, document } = setup();
    operations.setWhiteBalance(document.id, { mode: 'custom', temperature: 6300, tint: 12 }, 'manual');
    expect(documents.getDevelopDocument(document.id)?.settings.whiteBalance.temperature).toBe(6300);
    expect(() => operations.setWhiteBalance(document.id, { mode: 'custom', temperature: 50000, tint: 0 }, 'ai')).toThrow();
    operations.setCurves(document.id, { ...document.settings.curves, rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] }, 'manual');
    expect(documents.getDevelopDocument(document.id)?.settings.curves.rgb).toHaveLength(3);
    operations.resetSection(document.id, 'wb', 'ai');
    expect(documents.getDevelopDocument(document.id)?.settings.whiteBalance.mode).toBe('as-shot');
    history.undo();
    expect(documents.getDevelopDocument(document.id)?.settings.whiteBalance.temperature).toBe(6300);
  });
});
