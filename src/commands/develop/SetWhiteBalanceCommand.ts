// src/commands/develop/SetWhiteBalanceCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { WhiteBalanceSettings } from '../../types/develop';

export class SetWhiteBalanceCommand extends BaseCommand {
  private prevWB: WhiteBalanceSettings = { mode: 'custom', temperature: 5500, tint: 0 };

  constructor(
    documentId: string,
    public newWB: WhiteBalanceSettings,
    private documentManager: IDocumentManager
  ) {
    const summary = newWB.mode === 'custom'
      ? `Set White Balance (${newWB.temperature ?? 5500}K, Tint ${newWB.tint ?? 0})`
      : `Set White Balance (${newWB.mode})`;
    super(summary, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`SetWhiteBalanceCommand: Develop document "${this.documentId}" not found.`);
    }

    this.prevWB = structuredClone(doc.settings.whiteBalance);
    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        whiteBalance: structuredClone(this.newWB),
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
        whiteBalance: structuredClone(this.prevWB),
      },
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }
}
