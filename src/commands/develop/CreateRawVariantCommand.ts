import { BaseCommand } from '../../history/Command';
import { createDevelopDocument } from '../../document/DevelopDocument';
import type { DevelopDocument } from '../../types/develop';
import type { IDocumentManager } from '../../types/document';

/** Each variant owns its own decode; undo never restores released native pixels. */
export class CreateRawVariantCommand extends BaseCommand {
  constructor(private readonly template: DevelopDocument, private readonly originalId: string,
    private readonly documents: IDocumentManager, name='Create RAW Variant', private initialGuard?:()=>void) {
    super(name, template.id);
  }

  execute(): void {
    this.initialGuard?.();
    if (this.documents.getDocument(this.documentId)) throw new Error('RAW variant is already open.');
    const document = createDevelopDocument(structuredClone(this.template));
    document.isDirty = true;
    this.documents.openDocument(document);
    this.initialGuard = undefined;
  }

  undo(): void {
    this.documents.closeDocument(this.documentId);
    if (this.documents.getDocument(this.originalId)) this.documents.setActiveDocument(this.originalId);
  }
}
