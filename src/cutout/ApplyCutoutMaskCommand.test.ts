import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument, createGroupLayer, createImageLayer } from '../document/EditDocument';
import { ApplyCutoutMaskCommand } from './ApplyCutoutMaskCommand';

describe('non destructive cutout output', () => {
  it('applies and undoes a mask inside a nested group without altering source pixels', () => {
    const manager = new DocumentManager();
    const image = createImageLayer({ name: 'Photo', sourceAssetId: 'source', naturalWidth: 4, naturalHeight: 4 });
    const group = createGroupLayer({ name: 'Group', children: [image] });
    const doc = createEditDocument({ width: 4, height: 4, layers: [group] });
    manager.openDocument(doc);
    const command = new ApplyCutoutMaskCommand(doc.id, image.id, 'cutout-mask', manager);
    command.execute();
    const layer = (manager.getEditDocument(doc.id)!.layers[0] as typeof group).children[0];
    expect(layer.mask?.assetId).toBe('cutout-mask');
    expect((layer as typeof image).sourceAssetId).toBe('source');
    command.undo();
    expect((manager.getEditDocument(doc.id)!.layers[0] as typeof group).children[0].mask).toBeUndefined();
    command.redo();
    expect((manager.getEditDocument(doc.id)!.layers[0] as typeof group).children[0].mask?.assetId).toBe('cutout-mask');
  });
});
