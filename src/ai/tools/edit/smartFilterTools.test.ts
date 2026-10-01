import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../../../document/DocumentManager';
import { createEditDocument, createSmartObjectLayer, findLayerById } from '../../../document/EditDocument';
import { CommandBus } from '../../../history/CommandBus';
import { SmartObjectLayer } from '../../../types/edit';
import { AddSmartFilterTool, ManageSmartFilterTool } from './professionalTools';

describe('AI smart filter tools', () => {
  it('adds and updates a smart filter through the canonical command path', async () => {
    const documents = new DocumentManager();
    const layer = createSmartObjectLayer({ id: 'smart', sourceAssetId: 'asset', originalWidth: 10, originalHeight: 10 });
    const document = createEditDocument({ id: 'doc', width: 10, height: 10, layers: [layer] });
    documents.openDocument(document);
    const context = { documentManager: documents, commandBus: new CommandBus(documents), currentWorkspace: 'edit' as const };

    const added = await new AddSmartFilterTool().execute(context, { layerId: layer.id, filterType: 'gaussian_blur', settings: { radius: 12 } }, 'add-filter');
    expect(added.success).toBe(true);
    const filterId = added.after.filterId as string;
    expect((findLayerById(documents.getEditDocument(document.id)!.layers, layer.id) as SmartObjectLayer).smartFilters?.[0].settings).toEqual({ radius: 12 });

    const managed = await new ManageSmartFilterTool().execute(context, { layerId: layer.id, filterId, action: 'toggle', enabled: false }, 'toggle-filter');
    expect(managed.success).toBe(true);
    expect((findLayerById(documents.getEditDocument(document.id)!.layers, layer.id) as SmartObjectLayer).smartFilters?.[0].enabled).toBe(false);
  });

  it('rejects incomplete action-specific arguments without mutating the document', async () => {
    const documents = new DocumentManager();
    const layer = createSmartObjectLayer({ id: 'smart', sourceAssetId: 'asset', originalWidth: 10, originalHeight: 10 });
    const document = createEditDocument({ id: 'doc', width: 10, height: 10, layers: [layer] });
    documents.openDocument(document);
    const context = { documentManager: documents, commandBus: new CommandBus(documents), currentWorkspace: 'edit' as const };

    const added = await new AddSmartFilterTool().execute(context, { layerId: layer.id, filterType: 'gaussian_blur' }, 'add-filter');
    const filterId = added.after.filterId as string;
    const result = await new ManageSmartFilterTool().execute(context, { layerId: layer.id, filterId, action: 'reorder' }, 'bad-reorder');

    expect(result).toMatchObject({ success: false, error: { code: 'INVALID_ARGUMENT' } });
    expect((findLayerById(documents.getEditDocument(document.id)!.layers, layer.id) as SmartObjectLayer).smartFilters?.[0].id).toBe(filterId);
  });
});
