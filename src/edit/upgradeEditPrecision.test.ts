import { describe, expect, it } from 'vitest';
import { createEditDocument } from '../document/EditDocument';
import { DocumentManager } from '../document/DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { UpgradeEditPrecisionCommand } from './upgradeEditPrecision';

describe('precision upgrade copy', () => {
  it('preserves the original version and supports undo/redo of the copy', async () => {
    const documents = new DocumentManager(), bus = new CommandBus(documents), original = createEditDocument({ name: 'legacy' });
    documents.openDocument(original);
    const cmd = new UpgradeEditPrecisionCommand(original.id, documents);
    await bus.execute(cmd);
    expect(documents.getEditDocument(original.id)).toBe(original);
    expect(documents.getActiveDocument()?.id).toBe(cmd.upgradedDocument.id);
    expect(documents.getEditDocument(cmd.upgradedDocument.id)?.bitDepth).toBe(32);
    await bus.undo();
    expect(documents.getDocument(cmd.upgradedDocument.id)).toBeNull();
    await bus.redo();
    expect(documents.getEditDocument(cmd.upgradedDocument.id)?.renderingVersion).toBe(2);
  });
});
