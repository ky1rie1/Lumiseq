import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { Layer } from '../../types/edit';
import { assertLayerEditable, locateLayer, replaceSiblings } from '../../edit/LayerTree';
import { removeLayerFromTree } from '../../document/EditDocument';

function cloneLayer(source: Layer): Layer {
  const layer = structuredClone(source);
  layer.id = `layer_${crypto.randomUUID()}`;
  if (layer.mask) layer.mask.id = `mask_${crypto.randomUUID()}`;
  if (layer.type === 'smart-object') layer.smartFilters = (layer.smartFilters ?? []).map(filter => ({ ...filter, id: `filter_${crypto.randomUUID()}` }));
  if (layer.type === 'group') layer.children = source.type === 'group' ? source.children.map(cloneLayer) : [];
  return layer;
}

export class DuplicateLayerCommand extends BaseCommand {
  readonly duplicate: Layer;
  private selectedBefore: string | null = null;
  constructor(documentId: string, readonly layerId: string, source: Layer, private documents: IDocumentManager) {
    super('复制图层', documentId);
    this.duplicate = cloneLayer(source); this.duplicate.name = `${source.name} 副本`;
  }
  execute(): void {
    const doc = this.documents.getEditDocument(this.documentId);
    if (!doc) throw new Error('图层文档不存在。');
    const location = assertLayerEditable(doc, this.layerId, 'ancestors');
    this.selectedBefore = doc.selectedLayerId;
    const siblings = [...location.siblings]; siblings.splice(location.index + 1, 0, structuredClone(this.duplicate));
    this.documents.updateDocument({ ...doc, layers: replaceSiblings(doc.layers, location.parent, siblings), selectedLayerId: this.duplicate.id }, this.name);
  }
  undo(): void {
    const doc = this.documents.getEditDocument(this.documentId);
    if (!doc || !locateLayer(doc.layers, this.duplicate.id)) return;
    this.documents.updateDocument({ ...doc, layers: removeLayerFromTree(doc.layers, this.duplicate.id), selectedLayerId: this.selectedBefore }, `撤销 ${this.name}`);
  }
}
