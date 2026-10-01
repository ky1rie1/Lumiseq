import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../../document/DocumentManager';
import { CommandBus } from '../../history/CommandBus';
import { AssetManager } from '../../assets/AssetManager';
import { createEditDocument, createGroupLayer, createPaintLayer, createImageLayer, findLayerById } from '../../document/EditDocument';
import { TransformCommand } from './TransformCommand';
import { DeleteLayerCommand } from './DeleteLayerCommand';
import { BrushStrokeCommand } from '../../brush/BrushCommands';
import { ToolRegistry } from '../../ai/tools/ToolRegistry';
import { RenameLayerCommand } from './RenameLayerCommand';
import { SetLayerOpacityCommand } from './SetLayerOpacityCommand';
import { SetLayerBlendModeCommand } from './SetLayerBlendModeCommand';
import { ToggleLayerVisibilityCommand } from './ToggleLayerVisibilityCommand';
import { MoveLayerOrderCommand } from './MoveLayerOrderCommand';
import { CreateGroupCommand, MoveToGroupCommand } from './GroupCommands';
import { ResizeImageCommand, ResizeCanvasCommand } from './CropCommand';
import { CreateMaskFromSelectionCommand, InvertLayerMaskCommand } from '../../mask/MaskCommands';
import { defaultAssetManager } from '../../assets/AssetManager';
import { DrawGradientCommand } from '../../tools/gradient';

function setup(locked = false) {
  const child = createPaintLayer({ id: 'child', rasterAssetId: 'pixels', width: 20, height: 10, x: 30, y: 40 });
  const group = createGroupLayer({ id: 'group', children: [child] }); group.locked = locked;
  const doc = createEditDocument({ id: 'doc', width: 100, height: 80, layers: [group] });
  const documents = new DocumentManager(); documents.openDocument(doc);
  const bus = new CommandBus(documents);
  return { child, group, doc, documents, bus };
}

describe('recursive layer workflow', () => {
  it.each(['transform', 'delete', 'paint', 'gradient'])('rejects %s under a locked parent before recording history', operation => {
    const { child, doc, documents, bus } = setup(true);
    const command = operation === 'transform' ? new TransformCommand(doc.id, child.id, { x: 90 }, documents)
      : operation === 'delete' ? new DeleteLayerCommand(doc.id, child.id, documents)
      : operation === 'gradient' ? new DrawGradientCommand(doc.id, child.id, false, 'pixels', 'fresh-pixels', documents)
      : new BrushStrokeCommand(doc.id, child.id, {} as any, 'pixels', 'fresh-pixels', documents);
    expect(() => bus.execute(command)).toThrow(/locked|锁定/i);
    expect(documents.getEditDocument(doc.id)).toEqual(doc);
    expect(bus.getHistory()).toHaveLength(0);
  });

  it('registers the four canonical layer operations for MCP', () => {
    const registry = new ToolRegistry();
    for (const name of ['edit_duplicate_layer', 'edit_set_layer_locked', 'edit_align_layer', 'edit_flip_layer']) {
      expect(registry.get(name), name).toBeDefined();
      expect(registry.getMCPSchemas('edit').some(schema => schema.name === `studio_${name.slice(5)}`)).toBe(true);
    }
  });
});

it('edits and deletes nested layers, retaining their parent and exact order on undo', () => {
  const { child, group, doc, documents, bus } = setup();
  const sibling = createImageLayer({ id: 'sibling', name: 'sibling', sourceAssetId: 'image', naturalWidth: 3, naturalHeight: 4 });
  group.children.push(sibling);
  for (const command of [new RenameLayerCommand(doc.id, child.id, 'renamed', documents), new SetLayerOpacityCommand(doc.id, child.id, .5, documents), new SetLayerBlendModeCommand(doc.id, child.id, 'multiply', documents), new ToggleLayerVisibilityCommand(doc.id, child.id, documents)]) bus.execute(command);
  const edited = findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!;
  expect([edited.name, edited.opacity, edited.blendMode, edited.visible]).toEqual(['renamed', .5, 'multiply', false]);
  bus.execute(new MoveLayerOrderCommand(doc.id, child.id, 1, documents));
  expect((documents.getEditDocument(doc.id)!.layers[0] as any).children.map((l: any) => l.id)).toEqual(['sibling', 'child']);
  bus.undo(); bus.execute(new DeleteLayerCommand(doc.id, child.id, documents));
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)).toBeNull();
  bus.undo(); expect((documents.getEditDocument(doc.id)!.layers[0] as any).children.map((l: any) => l.id)).toEqual(['child', 'sibling']);
});

it('restores nested membership on grouping undo and rejects cycles atomically', () => {
  const { child, group, doc, documents, bus } = setup();
  const before = structuredClone(doc.layers);
  bus.execute(new CreateGroupCommand(doc.id, 'new group', [child.id], documents)); bus.undo();
  expect(documents.getEditDocument(doc.id)!.layers).toEqual(before);
  expect(() => bus.execute(new MoveToGroupCommand(doc.id, group.id, child.id, documents))).toThrow();
  expect(() => bus.execute(new MoveToGroupCommand(doc.id, group.id, group.id, documents))).toThrow();
  expect(documents.getEditDocument(doc.id)!.layers).toEqual(before);
});

it.each(['canvas', 'image'])('rejects %s resize when it would move locked descendants', type => {
  const { doc, documents, bus } = setup(true);
  const command = type === 'canvas' ? new ResizeCanvasCommand(doc.id, 200, 200, 'center', documents) : new ResizeImageCommand(doc.id, 200, 200, documents);
  expect(() => bus.execute(command)).toThrow(/locked|锁定/i);
  expect(documents.getEditDocument(doc.id)).toEqual(doc);
});

it('creates and inverts a nested mask with fresh immutable resources and stable redo pixels', async () => {
  const { child, doc, documents, bus } = setup();
  await bus.execute(new CreateMaskFromSelectionCommand(doc.id, child.id, 'reveal', documents));
  const mask = findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.mask!;
  const before = await defaultAssetManager.getMask(mask.assetId);
  await bus.execute(new InvertLayerMaskCommand(doc.id, child.id, documents));
  const inverted = findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.mask!;
  expect(inverted.assetId).not.toBe(mask.assetId);
  expect((await defaultAssetManager.getMask(inverted.assetId))![0]).toBe(0);
  expect(before![0]).toBe(255);
  bus.undo(); expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.mask!.assetId).toBe(mask.assetId);
  bus.redo(); expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.mask!.assetId).toBe(inverted.assetId);
});

async function service(documents: DocumentManager, bus: CommandBus, assets = new AssetManager()) {
  const path = '../../edit/LayerOperationService';
  const module = await import(path).catch(() => ({} as any));
  expect(module.LayerOperationService, 'shared layer operation service').toBeTypeOf('function');
  return new module.LayerOperationService(documents, bus, assets);
}

it('deeply duplicates a nested group beside its source with stable redo identities', async () => {
  const { child, group, doc, documents, bus } = setup();
  child.mask = { id: 'mask-original', assetId: 'mask-pixels', density: 1, feather: 0, linked: true, enabled: true };
  const outer = createGroupLayer({ id: 'outer', children: [group] });
  documents.openDocument({ ...doc, layers: [outer] });
  const operations = await service(documents, bus);
  const result = await operations.duplicate(doc.id, group.id);
  const duplicate = findLayerById(documents.getEditDocument(doc.id)!.layers, result.layerId)!;
  expect(duplicate.type).toBe('group');
  const copy = (duplicate as any).children[0];
  expect(copy.id).not.toBe(child.id); expect(copy.mask.id).not.toBe(child.mask.id);
  expect(copy.mask.assetId).toBe(child.mask.assetId);
  expect((documents.getEditDocument(doc.id)!.layers[0] as any).children.map((l: any) => l.id)).toEqual([group.id, duplicate.id]);
  bus.execute(new TransformCommand(doc.id, copy.id, { x: 3 }, documents));
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.transform.x).toBe(30);
  bus.undo(); bus.undo(); expect(findLayerById(documents.getEditDocument(doc.id)!.layers, duplicate.id)).toBeNull();
  bus.redo(); expect((findLayerById(documents.getEditDocument(doc.id)!.layers, duplicate.id) as any).children[0].id).toBe(copy.id);
});

it('aligns a rotated child in document space through its rotated parent and flips at its center', async () => {
  const { child, group, doc, documents, bus } = setup();
  // parent (10,5), rotation 90; child (30,40), rotation 90, size20x10.
  // world corners (-30,35),(-50,35),(-50,25),(-30,25). Right alignment needs +130 world X = -130 local Y.
  group.transform = { ...group.transform, x: 10, y: 5, rotation: 90 };
  child.transform.rotation = 90;
  const operations = await service(documents, bus);
  await operations.align(doc.id, child.id, 'right');
  let t = findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.transform;
  expect(t.x).toBeCloseTo(30); expect(t.y).toBeCloseTo(-90); expect(t.rotation).toBe(90);
  await operations.flip(doc.id, child.id, 'horizontal');
  t = findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.transform;
  expect(t.x).toBeCloseTo(30); expect(t.y).toBeCloseTo(-70); expect(t.scaleX).toBe(-1); expect(t.rotation).toBe(90);
  await operations.flip(doc.id, child.id, 'horizontal');
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.transform.y).toBeCloseTo(-90);
  expect(bus.getHistory()).toHaveLength(3);
});

it('supports ancestor locking, own unlocking, visibility and atomic singular-parent rejection', async () => {
  const { child, group, doc, documents, bus } = setup();
  const operations = await service(documents, bus);
  await operations.setLocked(doc.id, group.id, true);
  await expect(operations.setLocked(doc.id, child.id, false)).rejects.toThrow(/locked|锁定/i);
  await operations.setLocked(doc.id, group.id, false);
  const current = documents.getEditDocument(doc.id)!;
  documents.updateDocument({ ...current, layers: [{ ...current.layers[0], transform: { ...group.transform, scaleX: 0 } }] });
  const before = documents.getEditDocument(doc.id);
  await expect(operations.align(doc.id, child.id, 'left')).rejects.toThrow(/invert|逆|变换/i);
  expect(documents.getEditDocument(doc.id)).toBe(before);
  expect(bus.getHistory()).toHaveLength(2);
});

it('aligns and flips zero-sized groups using visible recursive content bounds', async () => {
  const { child, group, doc, documents, bus } = setup();
  const hidden = createImageLayer({ name: 'hidden', sourceAssetId: 'unused', naturalWidth: 1000, naturalHeight: 1000, x: 1000, y: 1000 }); hidden.visible = false;
  group.children.push(hidden);
  // Visible bounds: child at (30,40), 20x10. Align right: group x +50. Flip: group x +80 => child world bounds stay80..100.
  const operations = await service(documents, bus);
  await operations.align(doc.id, group.id, 'right');
  expect(documents.getEditDocument(doc.id)!.layers[0].transform.x).toBe(50);
  await operations.flip(doc.id, group.id, 'horizontal');
  const t = documents.getEditDocument(doc.id)!.layers[0].transform;
  expect(t.x).toBe(130); expect(t.scaleX).toBe(-1); expect(t.rotation).toBe(0);
  expect(findLayerById(documents.getEditDocument(doc.id)!.layers, child.id)!.transform).toEqual(child.transform);
});
