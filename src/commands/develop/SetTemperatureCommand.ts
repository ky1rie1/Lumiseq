// src/commands/develop/SetTemperatureCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class SetTemperatureCommand extends BaseCommand {
  private prevTemperature: number = 5500;
  private prevMode: 'as-shot' | 'auto' | 'custom' = 'custom';

  constructor(
    documentId: string,
    public newTemperature: number,
    private documentManager: IDocumentManager
  ) {
    super(`Set Temperature (${newTemperature}K)`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`Develop document "${this.documentId}" not found.`);
    }

    this.prevTemperature = doc.settings.whiteBalance.temperature ?? 5500;
    this.prevMode = doc.settings.whiteBalance.mode;

    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        whiteBalance: {
          ...doc.settings.whiteBalance,
          mode: 'custom' as const,
          temperature: this.newTemperature,
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
          temperature: this.prevTemperature,
        },
      },
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (previousCommand instanceof SetTemperatureCommand && previousCommand.documentId === this.documentId) {
      this.prevTemperature = previousCommand.prevTemperature;
      this.prevMode = previousCommand.prevMode;
      return true;
    }
    return false;
  }
}
