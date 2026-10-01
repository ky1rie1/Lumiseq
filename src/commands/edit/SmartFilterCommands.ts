import { assertLayerEditable } from '../../edit/LayerTree';
import { BaseCommand } from '../../history/Command';
import type { IDocumentManager } from '../../types/document';
import type { SmartFilter, SmartObjectLayer } from '../../types/edit';
import { findLayerById, updateLayerInTree } from '../../document/EditDocument';
import { normalizeSmartFilter } from '../../filters/smartFilters';

function smartObject(manager: IDocumentManager, documentId: string, layerId: string): SmartObjectLayer {
  const document = manager.getEditDocument(documentId);
  const layer = document ? findLayerById(document.layers, layerId) : null;
  if (!layer || layer.type !== 'smart-object') throw new Error(`Smart Object ${layerId} not found`);
  return layer;
}

abstract class SmartFilterListCommand extends BaseCommand {
  protected readonly before: SmartFilter[];
  protected abstract readonly after: SmartFilter[];

  constructor(name: string, documentId: string, protected readonly layerId: string, protected readonly manager: IDocumentManager) {
    super(name, documentId);
    this.before = structuredClone(smartObject(manager, documentId, layerId).smartFilters || []);
  }

  protected write(filters: SmartFilter[], summary: string): void {
    const document = this.manager.getEditDocument(this.documentId);
    if (!document) return;
    const layer = smartObject(this.manager, this.documentId, this.layerId);
    const updated = { ...layer, smartFilters: structuredClone(filters) } as SmartObjectLayer;
    this.manager.updateDocument({ ...document, layers: updateLayerInTree(document.layers, updated) }, summary);
  }

  execute(): void {
    const doc = this.manager.getEditDocument(this.documentId);
    if (doc) assertLayerEditable(doc, this.layerId);
    this.write(this.after, this.name);
  }
  undo(): void { this.write(this.before, `Undo: ${this.name}`); }
}

export class AddSmartFilterCommand extends SmartFilterListCommand {
  protected readonly after: SmartFilter[];
  constructor(documentId: string, layerId: string, filter: SmartFilter, manager: IDocumentManager) {
    super('Add Smart Filter', documentId, layerId, manager);
    const normalized = normalizeSmartFilter(filter);
    if (this.before.some((entry) => entry.id === normalized.id)) throw new Error(`Smart filter ${normalized.id} already exists`);
    this.after = [...this.before, normalized];
  }
}

export class UpdateSmartFilterCommand extends SmartFilterListCommand {
  protected readonly after: SmartFilter[];
  constructor(documentId: string, layerId: string, filterId: string, patch: Partial<SmartFilter>, manager: IDocumentManager) {
    super('Update Smart Filter', documentId, layerId, manager);
    let found = false;
    this.after = this.before.map((filter) => {
      if (filter.id !== filterId) return filter;
      found = true;
      return normalizeSmartFilter({ ...filter, ...patch, id: filter.id, type: filter.type });
    });
    if (!found) throw new Error(`Smart filter ${filterId} not found`);
  }
}

export class SetSmartFilterEnabledCommand extends UpdateSmartFilterCommand {
  constructor(documentId: string, layerId: string, filterId: string, enabled: boolean, manager: IDocumentManager) {
    super(documentId, layerId, filterId, { enabled }, manager);
  }
}

export class RemoveSmartFilterCommand extends SmartFilterListCommand {
  protected readonly after: SmartFilter[];
  constructor(documentId: string, layerId: string, filterId: string, manager: IDocumentManager) {
    super('Remove Smart Filter', documentId, layerId, manager);
    this.after = this.before.filter((filter) => filter.id !== filterId);
    if (this.after.length === this.before.length) throw new Error(`Smart filter ${filterId} not found`);
  }
}

export class ReorderSmartFilterCommand extends SmartFilterListCommand {
  protected readonly after: SmartFilter[];
  constructor(documentId: string, layerId: string, filterId: string, toIndex: number, manager: IDocumentManager) {
    super('Reorder Smart Filters', documentId, layerId, manager);
    if (!Number.isFinite(toIndex)) throw new Error('Smart filter target index must be a finite number');
    const fromIndex = this.before.findIndex((filter) => filter.id === filterId);
    if (fromIndex < 0) throw new Error(`Smart filter ${filterId} not found`);
    const target = Math.max(0, Math.min(this.before.length - 1, Math.round(toIndex)));
    this.after = [...this.before];
    const [filter] = this.after.splice(fromIndex, 1);
    this.after.splice(target, 0, filter);
  }
}
