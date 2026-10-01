// src/commands/develop/SetTintCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class SetTintCommand extends BaseCommand {
  private prevTint: number = 0;
  private prevMode: 'as-shot' | 'auto' | 'custom' = 'custom';

  constructor(
    documentId: string,
    public newTint: number,
    private documentManager: IDocumentManager
  ) {
    super(`Set Tint (${newTint > 0 ? '+' : ''}${newTint})`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`Develop document "${this.documentId}" not found.`);
    }

    this.prevTint = doc.settings.whiteBalance.tint ?? 0;
    this.prevMode = doc.settings.whiteBalance.mode;

    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        whiteBalance: {
          ...doc.settings.whiteBalance,
          mode: 'custom' as const,
          tint: this.newTint,
        },
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
        whiteBalance: {
          ...doc.settings.whiteBalance,
          mode: this.prevMode,
          tint: this.prevTint,
        },
      },
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (previousCommand instanceof SetTintCommand && previousCommand.documentId === this.documentId) {
      this.prevTint = previousCommand.prevTint;
      this.prevMode = previousCommand.prevMode;
      return true;
    }
    return false;
  }
}
