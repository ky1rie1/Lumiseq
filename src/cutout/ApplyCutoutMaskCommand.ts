import { assertLayerEditable } from '../edit/LayerTree';
import { BaseCommand } from '../history/Command';
import type { Layer, LayerMask } from '../types/edit';
import type { IDocumentManager } from '../types/document';
import { layerWorld } from './cutoutSource';

export function findLayer(layers: Layer[], id: string): Layer | undefined {
  for (const layer of layers) {
    if (layer.id === id) return layer;
    if (layer.type === 'group') { const child = findLayer(layer.children, id); if (child) return child; }
  }
  return undefined;
}

export class ApplyCutoutMaskCommand extends BaseCommand {
  private previous?: LayerMask;
  private initialized = false;
  private readonly next: LayerMask;
  constructor(documentId: string, private readonly layerId: string, assetId: string, private readonly manager: IDocumentManager) {
    super('应用抠图蒙版', documentId);
    this.next = { id: `cutout_${this.id}`, assetId, enabled: true, linked: true, density: 1, feather: 0 };
  }
  execute(): void {
    const doc = this.manager.getEditDocument(this.documentId);
    if (doc) assertLayerEditable(doc, this.layerId);
    this.set(this.next, true);
  }
  undo(): void { this.set(this.previous); }
  redo(): void { this.set(this.next); }
  private set(mask: LayerMask | undefined, remember = false): void {
    const doc = this.manager.getEditDocument(this.documentId);
    const layer = doc && findLayer(doc.layers, this.layerId);
    if (!doc || !layer) throw new Error('抠图目标图层已关闭或删除。');
    if (remember && !this.initialized) {
      this.previous = layer.mask;
      this.next.referenceTransform = layerWorld(doc.layers, this.layerId);
      this.next.referenceWidth = layer.transform.width; this.next.referenceHeight = layer.transform.height;
      this.initialized = true;
    }
    const replace = (layers: Layer[]): Layer[] => layers.map(l => l.id === this.layerId ? { ...l, mask } : l.type === 'group' ? { ...l, children: replace(l.children) } : l);
    this.manager.updateDocument({ ...doc, layers: replace(doc.layers) }, mask === this.next ? this.name : `撤销 ${this.name}`);
  }
}
