// src/commands/develop/ResetDevelopSettingsCommand.ts
import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { DevelopSettings } from '../../types/develop';
import { createDefaultDevelopSettings } from '../../document/DevelopDocument';

export class ResetDevelopSettingsCommand extends BaseCommand {
  private prevSettings: DevelopSettings | null = null;

  constructor(
    documentId: string,
    private documentManager: IDocumentManager
  ) {
    super('Reset Develop Parameters', documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`Develop document "${this.documentId}" not found.`);
    }

    this.prevSettings = structuredClone(doc.settings);
    const defaults = createDefaultDevelopSettings(doc.isRaw);
    defaults.renderingVersion = doc.settings.renderingVersion ?? 1;
    if (doc.isRaw && doc.settings.whiteBalance.cameraMultipliers) {
      defaults.whiteBalance.cameraMultipliers = doc.settings.whiteBalance.cameraMultipliers;
    }

    const updatedDoc = {
      ...doc,
      settings: defaults,
    };

    this.documentManager.updateDocument(updatedDoc, this.name);
  }

  undo(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc || !this.prevSettings) return;

    const updatedDoc = {
      ...doc,
      settings: structuredClone(this.prevSettings),
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }
}
