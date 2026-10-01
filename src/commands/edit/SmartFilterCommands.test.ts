import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../../document/DocumentManager';
import { createEditDocument, createSmartObjectLayer, findLayerById } from '../../document/EditDocument';
import { CommandBus } from '../../history/CommandBus';
import { SmartObjectLayer } from '../../types/edit';
import { createSmartFilter } from '../../filters/smartFilters';
import {
  AddSmartFilterCommand,
  RemoveSmartFilterCommand,
  ReorderSmartFilterCommand,
  SetSmartFilterEnabledCommand,
  UpdateSmartFilterCommand,
} from './SmartFilterCommands';

describe('smart filter commands', () => {
  it('adds, updates, toggles, reorders and removes filters with undo', () => {
    const manager = new DocumentManager();
    const first = createSmartFilter('gaussian_blur');
    const second = createSmartFilter('unsharp_mask');
    const layer = createSmartObjectLayer({ id: 'smart', sourceAssetId: 'asset', originalWidth: 4, originalHeight: 4 });
    const doc = createEditDocument({ id: 'doc', width: 4, height: 4, layers: [layer] });
    manager.openDocument(doc);
    const bus = new CommandBus(manager);

    bus.execute(new AddSmartFilterCommand(doc.id, layer.id, first, manager));
    bus.execute(new AddSmartFilterCommand(doc.id, layer.id, second, manager));
    let current = findLayerById(manager.getEditDocument(doc.id)!.layers, layer.id) as SmartObjectLayer;
    expect(current.smartFilters?.map((filter) => filter.id)).toEqual([first.id, second.id]);

    bus.execute(new UpdateSmartFilterCommand(doc.id, layer.id, second.id, { settings: { radius: 3, amount: 1.8, threshold: 12 } }, manager));
    bus.execute(new SetSmartFilterEnabledCommand(doc.id, layer.id, first.id, false, manager));
    bus.execute(new ReorderSmartFilterCommand(doc.id, layer.id, second.id, 0, manager));
    current = findLayerById(manager.getEditDocument(doc.id)!.layers, layer.id) as SmartObjectLayer;
    expect(current.smartFilters?.[0]).toMatchObject({ id: second.id, settings: { radius: 3, amount: 1.8, threshold: 12 } });
    expect(current.smartFilters?.[1]).toMatchObject({ id: first.id, enabled: false });

    bus.execute(new RemoveSmartFilterCommand(doc.id, layer.id, second.id, manager));
    expect((findLayerById(manager.getEditDocument(doc.id)!.layers, layer.id) as SmartObjectLayer).smartFilters).toHaveLength(1);
    bus.undo();
    expect((findLayerById(manager.getEditDocument(doc.id)!.layers, layer.id) as SmartObjectLayer).smartFilters).toHaveLength(2);
  });

  it('rejects filters on ordinary layers', () => {
    const manager = new DocumentManager();
    const doc = createEditDocument({ id: 'doc', width: 4, height: 4 });
    manager.openDocument(doc);
    expect(() => new AddSmartFilterCommand(doc.id, 'missing', createSmartFilter('gaussian_blur'), manager)).toThrow();
  });
});
