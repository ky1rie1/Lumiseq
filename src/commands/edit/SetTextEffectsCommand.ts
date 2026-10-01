import { assertLayerEditable } from '../../edit/LayerTree';
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { Layer, TextEffects } from '../../types/edit';
import { validateTextEffects } from '../../text/TextEffects';
export class SetTextEffectsCommand extends BaseCommand {
  private before: TextEffects | undefined;
  private readonly effects: TextEffects;
  constructor(documentId: string, private layerId: string, effects: TextEffects, private documents: IDocumentManager) {
    super('Text effects', documentId);
    validateTextEffects(effects);
    this.effects = structuredClone(effects);
  }
  private apply(effects: TextEffects, capture: boolean): void {
    const doc = this.documents.getEditDocument(this.documentId);
    if (!doc) throw new Error('Text effects document is unavailable.');
    let found = false;
    const visit = (layers: Layer[]): Layer[] => layers.map(layer => {
      if (layer.id === this.layerId) {
        if (layer.type !== 'text') throw new Error('Text effects require a text layer.');
        found = true;
        if (capture) this.before = structuredClone({ ...(layer.stroke ? { stroke: layer.stroke } : {}), ...(layer.shadow ? { shadow: layer.shadow } : {}) });
        const next = { ...layer };
        delete next.stroke; delete next.shadow;
        return { ...next, ...structuredClone(effects) };
      }
      return layer.type === 'group' ? { ...layer, children: visit(layer.children) } : layer;
    });
    const layers = visit(doc.layers);
    if (!found) throw new Error('Text layer is unavailable.');
    this.documents.updateDocument({ ...doc, layers }, this.name);
  }
  execute(): void {
    const doc = this.documents.getEditDocument(this.documentId);
    if (doc) assertLayerEditable(doc, this.layerId);
    this.apply(this.effects, this.before === undefined);
  }
  undo(): void { if (this.before) this.apply(this.before, false); }
}
