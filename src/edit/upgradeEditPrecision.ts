import type { IDocumentManager } from '../types/document';
import type { EditDocument } from '../types/edit';
import { BaseCommand } from '../history/Command';
import { flattenLayerTree } from '../document/EditDocument';

export class UpgradeEditPrecisionCommand extends BaseCommand {
  readonly upgradedDocument: EditDocument;
  constructor(documentId: string, private documents: IDocumentManager) {
    super('创建高精度工程副本', documentId);
    const original = documents.getEditDocument(documentId);
    if (!original || original.renderingVersion === 2) throw new Error('请选择旧版图像工程。');
    if (flattenLayerTree(original.layers).some(layer => layer.type === 'develop-smart-object' && !layer.sourceAssetId)) throw new Error('旧 RAW 图层缺少原始资源，请重新从 RAW 转入。');
    const id = crypto.randomUUID();
    this.upgradedDocument = { ...structuredClone(original), id, name: original.name + ' · 32F', renderingVersion: 2, bitDepth: 32, workingProfile: 'linear-srgb',
      selection: original.selection ? { ...structuredClone(original.selection), documentId: id } : null, isDirty: true, updatedAt: Date.now() };
  }
  execute(): void { this.documents.openDocument(structuredClone(this.upgradedDocument)); }
  undo(): void { this.documents.closeDocument(this.upgradedDocument.id); this.documents.setActiveDocument(this.documentId); }
}
