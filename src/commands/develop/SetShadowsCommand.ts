// src/commands/develop/SetShadowsCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class SetShadowsCommand extends BaseCommand {
  private prevShadows: number = 0;

  constructor(
    documentId: string,
    public newShadows: number,
    private documentManager: IDocumentManager
  ) {
    super(`Set Shadows (${newShadows > 0 ? '+' : ''}${newShadows})`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`SetShadowsCommand: Develop document "${this.documentId}" not found.`);
    }

    this.prevShadows = doc.settings.shadows;
    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        shadows: this.newShadows,
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
        shadows: this.prevShadows,
      },
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (previousCommand instanceof SetShadowsCommand && previousCommand.documentId === this.documentId) {
      this.prevShadows = previousCommand.prevShadows;
      return true;
    }
    return false;
  }
}
