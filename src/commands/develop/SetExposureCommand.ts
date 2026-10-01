// src/commands/develop/SetExposureCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';

export class SetExposureCommand extends BaseCommand {
  private prevExposure: number = 0;

  constructor(
    documentId: string,
    public newExposure: number,
    private documentManager: IDocumentManager
  ) {
    super(`Set Exposure (${newExposure > 0 ? '+' : ''}${newExposure.toFixed(2)} EV)`, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`SetExposureCommand: Develop document "${this.documentId}" not found.`);
    }

    this.prevExposure = doc.settings.exposure;
    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        exposure: this.newExposure,
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
        exposure: this.prevExposure,
      },
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (previousCommand instanceof SetExposureCommand && previousCommand.documentId === this.documentId) {
      // Keep previous command's original prevExposure, update its target exposure to this one
      this.prevExposure = previousCommand.prevExposure;
      return true;
    }
    return false;
  }
}
