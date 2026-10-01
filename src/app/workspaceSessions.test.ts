import { afterEach, describe, expect, it } from 'vitest';
import { createEditDocument } from '../document/EditDocument';
import { createDevelopDocument } from '../document/DevelopDocument';
import { defaultDocumentManager } from '../document/DocumentManager';
import { useAppStore } from '../stores/useAppStore';

afterEach(() => {
  defaultDocumentManager.closeAll();
  useAppStore.getState().setWorkspace('home');
});

describe('workspace sessions', () => {
  it('restores the last open document of each workspace when switching through Home', () => {
    const edit = createEditDocument({ name: 'Canvas', width: 300, height: 200 });
    const develop = createDevelopDocument({ fileName: 'Photo', sourceUri: 'memory://photo', isRaw: false, width: 300, height: 200 });
    defaultDocumentManager.openDocument(edit);
    defaultDocumentManager.openDocument(develop);

    useAppStore.getState().setWorkspace('edit');
    expect(defaultDocumentManager.getActiveDocument()?.id).toBe(edit.id);
    useAppStore.getState().setWorkspace('home');
    useAppStore.getState().setWorkspace('develop');
    expect(defaultDocumentManager.getActiveDocument()?.id).toBe(develop.id);
    useAppStore.getState().setWorkspace('edit');
    expect(defaultDocumentManager.getActiveDocument()?.id).toBe(edit.id);
  });

  it('falls back to another open document after the remembered one closes', () => {
    const first = createEditDocument({ name: 'First', width: 200, height: 200 });
    const second = createEditDocument({ name: 'Second', width: 200, height: 200 });
    const develop = createDevelopDocument({ fileName: 'Photo', sourceUri: 'memory://photo', isRaw: false, width: 200, height: 200 });
    defaultDocumentManager.openDocument(first);
    defaultDocumentManager.openDocument(second);
    defaultDocumentManager.openDocument(develop);
    defaultDocumentManager.closeDocument(second.id);

    useAppStore.getState().setWorkspace('edit');
    expect(defaultDocumentManager.getActiveDocument()?.id).toBe(first.id);
  });

  it('shows an empty workspace without closing the document in another workspace', () => {
    const develop = createDevelopDocument({ fileName: 'Photo', sourceUri: 'memory://photo', isRaw: false, width: 200, height: 200 });
    defaultDocumentManager.openDocument(develop);
    useAppStore.getState().setWorkspace('edit');
    expect(defaultDocumentManager.getActiveDocument()).toBeNull();
    expect(defaultDocumentManager.getDocument(develop.id)).toBe(develop);
    useAppStore.getState().setWorkspace('develop');
    expect(defaultDocumentManager.getActiveDocument()?.id).toBe(develop.id);
  });
});
