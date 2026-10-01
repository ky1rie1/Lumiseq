import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { createDocumentOperations } from '../src/app/DocumentOperationService';
import { ListOpenDocumentsTool, ActivateDocumentTool, CreateDocumentTool } from '../src/ai/tools/system';

describe('AI document operations', () => {
  it('uses the same create and activate operations as the desktop UI', async () => {
    const documentManager = new DocumentManager();
    const context = { documentManager, commandBus: new CommandBus(documentManager), currentWorkspace: 'edit' as const };
    const first = createDocumentOperations(documentManager).create({ kind: 'edit', name: '封面', width: 800, height: 600 });
    const created = await new CreateDocumentTool().execute(context, { kind: 'edit', name: '内页', width: 600, height: 400 }, 'create');
    expect(created.success).toBe(true);
    const listed = await new ListOpenDocumentsTool().execute(context, {}, 'list');
    expect((listed.data?.documents as unknown[]).length).toBe(2);
    const switched = await new ActivateDocumentTool().execute(context, { documentId: first.id }, 'activate');
    expect(switched.success).toBe(true);
    expect(documentManager.getActiveDocument()?.id).toBe(first.id);
    expect((await new ActivateDocumentTool().execute(context, { documentId: 'missing' }, 'bad')).success).toBe(false);
  });
});
