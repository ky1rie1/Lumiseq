import { beforeEach, describe, expect, it } from 'vitest';
import { TransformCommand } from './TransformCommand';
import { defaultDocumentManager as manager } from '../../document/DocumentManager';
import { defaultCommandBus as bus } from '../../history/CommandBus';
import { createEditDocument, createGroupLayer, createImageLayer, findLayerById } from '../../document/EditDocument';
import type { EditDocument, ImageLayer } from '../../types/edit';

let doc: EditDocument, layer: ImageLayer;
const original = { x: 12, y: 34, width: 640, height: 480, rotation: 27, scaleX: 0.75, scaleY: 1.5 };
beforeEach(() => {
  bus.clearHistory();
  doc = createEditDocument({ width: 1000, height: 1000 });
  layer = createImageLayer({ name: 'Target', sourceAssetId: 'source', naturalWidth: 640, naturalHeight: 480 });
  layer.transform = { ...original };
});
const current = () => findLayerById(manager.getEditDocument(doc.id)!.layers, layer.id)!.transform;

describe('partial layer transforms', () => {
  it.each([false, true])('preserves omitted fields through execute/undo/redo (nested=%s)', async nested => {
    const sibling = createImageLayer({ name: 'Sibling', sourceAssetId: 'sibling', naturalWidth: 123, naturalHeight: 456 });
    const group = createGroupLayer({ children: [layer, sibling] }); group.transform.x = 250;
    doc.layers = nested ? [group] : [layer, sibling]; manager.openDocument(doc);
    const command = new TransformCommand(doc.id, layer.id, { x: 90 }, manager);
    await bus.execute(command);
    expect(current()).toEqual({ x: 90, y: 34, width: 640, height: 480, rotation: 27, scaleX: 0.75, scaleY: 1.5 });
    expect(findLayerById(manager.getEditDocument(doc.id)!.layers, sibling.id)!.transform).toEqual(sibling.transform);
    if (nested) expect(manager.getEditDocument(doc.id)!.layers[0].transform).toEqual(group.transform);
    await bus.undo(); expect(current()).toEqual(original);
    await bus.redo(); expect(current()).toEqual({ x: 90, y: 34, width: 640, height: 480, rotation: 27, scaleX: 0.75, scaleY: 1.5 });
  });
  it('merges omitted fields from the layer state at execution time', () => {
    doc.layers = [layer]; manager.openDocument(doc);
    const command = new TransformCommand(doc.id, layer.id, { scaleX: 2 }, manager);
    manager.updateDocument({ ...doc, layers: [{ ...layer, transform: { ...original, height: 700 } }] });
    command.execute();
    expect(current()).toEqual({ x: 12, y: 34, width: 640, height: 700, rotation: 27, scaleX: 2, scaleY: 1.5 });
    command.undo(); expect(current()).toEqual({ ...original, height: 700 });
    command.redo(); expect(current()).toEqual({ ...original, height: 700, scaleX: 2 });
  });
  it('treats undefined fields as omitted and preserves explicit zero values', () => {
    doc.layers = [layer]; manager.openDocument(doc);
    const update = { x: 0, rotation: 0, width: undefined };
    const command = new TransformCommand(doc.id, layer.id, update, manager);
    update.x = 100;
    command.execute();
    expect(current()).toEqual({ x: 0, y: 34, width: 640, height: 480, rotation: 0, scaleX: 0.75, scaleY: 1.5 });
  });
});
