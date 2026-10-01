import { describe, expect, it, vi } from 'vitest';
import { DocumentManager } from './DocumentManager';
import { createEditDocument } from './EditDocument';

describe('DocumentManager.markSaved', () => {
  it('clears the dirty state and updates subscribers only after a successful save', () => {
    const manager = new DocumentManager();
    const doc = createEditDocument({ name: '封面', width: 600, height: 400 });
    manager.openDocument(doc);
    manager.updateDocument(doc);
    const listener = vi.fn();
    manager.subscribe(listener);
    manager.markSaved(doc.id);
    expect(manager.getDocument(doc.id)?.isDirty).toBe(false);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'updated', changeSummary: 'saved' }));
    expect(() => manager.markSaved('missing')).toThrow();
  });
});
