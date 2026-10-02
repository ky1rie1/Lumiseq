import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { createDevelopDocument } from '../document/DevelopDocument';
import { CommandBus } from '../history/CommandBus';
import { DevelopOperationService } from './DevelopOperationService';
import { CreateRawVariantTool } from '../ai/tools/develop';

describe('RAW variants preserve original coordinate contracts', () => {
  it('uses the same canonical command for AI and requires an explicit source', async () => {
    const documents = new DocumentManager();
    const history = new CommandBus(documents);
    const original = createDevelopDocument({ sourceUri: 'C:/photos/source.arw', fileName: 'source.arw', isRaw: true });
    documents.openDocument(original);
    const context = { documentManager: documents, commandBus: history } as any;
    const tool = new CreateRawVariantTool();
    expect((await tool.execute(context, { mode: 'uncorrected' }, 'invalid')).success).toBe(false);
    const result = await tool.execute(context, { documentId: original.id, mode: 'uncorrected' }, 'valid');
    expect(result.success).toBe(true);
    expect(history.getHistory()[0].command.id).toBe(result.commandId);
    expect(documents.getDevelopDocument(result.changedDocumentId!)?.rawCorrectionMode).toBe('uncorrected');
  });
  it('upgrades a separate document and redo rebuilds resources after close', async () => {
    const documents = new DocumentManager();
    const history = new CommandBus(documents);
    const original = createDevelopDocument({ sourceUri: 'C:/photos/source.arw', fileName: 'source.arw', isRaw: true, rawProcessingVersion: 1 });
    documents.openDocument(original);
    const service = new DevelopOperationService(documents, history);
    const result = await service.createRawVariant(original.id, 'uncorrected');
    const variant = documents.getDevelopDocument(result.documentId)!;
    expect(documents.getDevelopDocument(original.id)).toBe(original);
    expect(variant.rawProcessingVersion).toBe(2);
    expect(variant.rawCorrectionMode).toBe('uncorrected');
    expect(variant.settings).not.toBe(original.settings);
    documents.updateDevelopRuntime(variant.id, { nativeAssetId: 'temporary', rawState: 'ready' });
    expect(history.undo()).toBe(true);
    expect(documents.getDevelopDocument(variant.id)).toBeNull();
    expect(documents.getActiveDocument()?.id).toBe(original.id);
    expect(history.redo()).toBe(true);
    expect(documents.getDevelopDocument(variant.id)?.nativeAssetId).toBeUndefined();
    expect(documents.getDevelopDocument(variant.id)?.rawState).toBe('unloaded');
  });

  it('rejects invalid modes, raster sources and masks before creating history', async () => {
    const documents = new DocumentManager();
    const history = new CommandBus(documents);
    const service = new DevelopOperationService(documents, history);
    const original = createDevelopDocument({ sourceUri: 'C:/photos/source.arw', fileName: 'source.arw', isRaw: true });
    documents.openDocument(original);
    await expect(service.createRawVariant(original.id, 'guess' as any)).rejects.toThrow(/mode/i);
    original.settings.masks = [{ id: 'mask' } as any];
    await expect(service.createRawVariant(original.id, 'camera')).rejects.toThrow(/蒙版/);
    const raster = createDevelopDocument({ sourceUri: 'memory://image', fileName: 'image', isRaw: false });
    documents.openDocument(raster);
    await expect(service.createRawVariant(raster.id, 'camera')).rejects.toThrow(/RAW/);
    expect(history.getHistory()).toHaveLength(0);
    expect(documents.getOpenDocuments()).toHaveLength(2);
  });
});
