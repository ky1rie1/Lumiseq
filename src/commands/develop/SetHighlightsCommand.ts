// src/commands/develop/SetHighlightsCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class SetHighlightsCommand extends BaseCommand {
  private prevHighlights: number = 0;

  constructor(
    documentId: string,
    public newHighlights: number,
    private documentManager: IDocumentManager
  ) {
    super(`Set Highlights (${newHighlights > 0 ? '+' : ''}${newHighlights})`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`SetHighlightsCommand: Develop document "${this.documentId}" not found.`);
    }

    this.prevHighlights = doc.settings.highlights;
    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        highlights: this.newHighlights,
      },
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) return;

    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        highlights: this.prevHighlights,
      },
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (previousCommand instanceof SetHighlightsCommand && previousCommand.documentId === this.documentId) {
      this.prevHighlights = previousCommand.prevHighlights;
      return true;
    }
    return false;
  }
}
