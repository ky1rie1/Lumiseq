import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { GroupLayer, Layer } from '../../types/edit';
import { createGroupLayer, flattenLayerTree, removeLayerFromTree, updateLayerInTree } from '../../document/EditDocument';
import { assertLayerEditable, locateLayer, replaceSiblings, transformFromMatrix } from '../../edit/LayerTree';
import { IDENTITY, inverseMatrix, layerMatrix, multiplyMatrix } from '../../engine/editTransforms';

export class CreateGroupCommand extends BaseCommand {
  private readonly createdGroup: GroupLayer;
  private before: Layer[] = [];
  private selectedBefore: string | null = null;
  get groupId(): string { return this.createdGroup.id; }
  constructor(documentId: string, public readonly name = '图层组 1', public readonly memberLayerIds: string[] = [], private documentManager: IDocumentManager) {
    super(`Create Group "${name}"`, documentId); this.createdGroup = createGroupLayer({ name });
  }
  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error('Edit document not found.');
    const ids = [...new Set(this.memberLayerIds)];
    const locations = ids.map(id => assertLayerEditable(doc, id));
    if (locations.some(location => location.ancestors.some(parent => ids.includes(parent.id)))) throw new Error('Cannot group a layer and its ancestor together.');
    const parent = locations[0]?.parent ?? null;
    const parentWorld = locations[0]?.parentWorld ?? IDENTITY;
    const inverse = inverseMatrix(parentWorld);
    const children = locations.map(location => {
      if ((location.parent?.id ?? null) === (parent?.id ?? null)) return structuredClone(location.layer);
      const local = multiplyMatrix(inverse, multiplyMatrix(location.parentWorld, layerMatrix(location.layer.transform)));
      return { ...structuredClone(location.layer), transform: transformFromMatrix(location.layer, local) };
    });
    this.before = structuredClone(doc.layers); this.selectedBefore = doc.selectedLayerId;
    let layers = ids.reduce((tree, id) => removeLayerFromTree(tree, id), doc.layers);
    const currentParent = parent ? locateLayer(layers, parent.id)?.layer : null;
    const siblings = currentParent?.type === 'group' ? currentParent.children : layers;
    const group = { ...structuredClone(this.createdGroup), children };
    const index = locations.length ? Math.min(locations[0].index, siblings.length) : siblings.length;
    const next = [...siblings]; next.splice(index, 0, group);
    layers = replaceSiblings(layers, currentParent?.type === 'group' ? currentParent : null, next);
    this.documentManager.updateDocument({ ...doc, layers, selectedLayerId: group.id }, this.name);
  }
  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (doc) this.documentManager.updateDocument({ ...doc, layers: structuredClone(this.before), selectedLayerId: this.selectedBefore }, `Undo ${this.name}`);
  }
}

export class MoveToGroupCommand extends BaseCommand {
  private before: Layer[] = [];
  constructor(documentId: string, readonly layerId: string, readonly targetGroupId: string | null, private documentManager: IDocumentManager) { super('Move Layer to Group', documentId); }
  execute(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (!doc) throw new Error('Edit document not found.');
    const source = assertLayerEditable(doc, this.layerId);
    const target = this.targetGroupId ? assertLayerEditable(doc, this.targetGroupId) : null;
    if (target && target.layer.type !== 'group') throw new Error('Target must be a group.');
    if (this.targetGroupId && flattenLayerTree([source.layer]).some(layer => layer.id === this.targetGroupId)) throw new Error('Cannot move a group into itself or its descendants.');
    const world = multiplyMatrix(source.parentWorld, layerMatrix(source.layer.transform));
    const targetWorld = target ? multiplyMatrix(target.parentWorld, layerMatrix(target.layer.transform)) : IDENTITY;
    const local = multiplyMatrix(inverseMatrix(targetWorld), world);
    const moved = { ...source.layer, transform: transformFromMatrix(source.layer, local) };
    this.before = structuredClone(doc.layers);
    let layers = removeLayerFromTree(doc.layers, this.layerId);
    if (target) {
      const group = locateLayer(layers, target.layer.id)!.layer as GroupLayer;
      layers = updateLayerInTree(layers, { ...group, children: [...group.children, moved] });
    } else layers = [...layers, moved];
    this.documentManager.updateDocument({ ...doc, layers }, this.name);
  }
  undo(): void {
    const doc = this.documentManager.getEditDocument(this.documentId);
    if (doc) this.documentManager.updateDocument({ ...doc, layers: structuredClone(this.before) }, `Undo ${this.name}`);
  }
}
