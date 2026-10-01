// src/commands/develop/SetContrastCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class SetContrastCommand extends BaseCommand {
  private prevContrast: number = 0;

  constructor(
    documentId: string,
    public newContrast: number,
    private documentManager: IDocumentManager
  ) {
    super(`Set Contrast (${newContrast > 0 ? '+' : ''}${newContrast})`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`SetContrastCommand: Develop document "${this.documentId}" not found.`);
    }

    this.prevContrast = doc.settings.contrast;
    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        contrast: this.newContrast,
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
        contrast: this.prevContrast,
      },
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (previousCommand instanceof SetContrastCommand && previousCommand.documentId === this.documentId) {
      this.prevContrast = previousCommand.prevContrast;
      return true;
    }
    return false;
  }
}
