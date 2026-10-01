// src/commands/develop/SetSaturationCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class SetSaturationCommand extends BaseCommand {
  private prevSaturation: number = 0;

  constructor(
    documentId: string,
    public newSaturation: number,
    private documentManager: IDocumentManager
  ) {
    super(`Set Saturation (${newSaturation > 0 ? '+' : ''}${newSaturation})`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`Develop document "${this.documentId}" not found.`);
    }

    this.prevSaturation = doc.settings.saturation;
    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        saturation: this.newSaturation,
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
        saturation: this.prevSaturation,
      },
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (previousCommand instanceof SetSaturationCommand && previousCommand.documentId === this.documentId) {
      this.prevSaturation = previousCommand.prevSaturation;
      return true;
    }
    return false;
  }
}
