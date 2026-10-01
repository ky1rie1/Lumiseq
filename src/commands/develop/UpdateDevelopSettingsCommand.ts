// src/commands/develop/UpdateDevelopSettingsCommand.ts
//! Reversible command for granular and section updates of DevelopSettings

import { BaseCommand } from '../../history/Command';
import { IDocumentManager } from '../../types/document';
import { ICommand } from '../../types/history';
import { DevelopSettings } from '../../types/develop';

export class UpdateDevelopSettingsCommand extends BaseCommand {
  private prevSettings: Partial<DevelopSettings> = {};

  constructor(
    documentId: string,
    public newSettings: Partial<DevelopSettings>,
    description: string,
    private documentManager: IDocumentManager
  ) {
    super(description, documentId);
  }

  execute(): void {
    const doc = this.documentManager.getDevelopDocument(this.documentId);
    if (!doc) {
      throw new Error(`UpdateDevelopSettingsCommand: Document "${this.documentId}" not found.`);
    }

    // Capture previous values of only modified keys
    this.prevSettings = {};
    for (const key of Object.keys(this.newSettings) as (keyof DevelopSettings)[]) {
      (this.prevSettings as any)[key] = doc.settings[key];
    }

    const updatedDoc = {
      ...doc,
      settings: {
        ...doc.settings,
        ...this.newSettings,
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
        ...this.prevSettings,
      },
    };

    this.documentManager.updateDocument(updatedDoc, `Undo ${this.name}`);
  }

  mergeWith(previousCommand: ICommand): boolean {
    if (
      previousCommand instanceof UpdateDevelopSettingsCommand &&
      previousCommand.documentId === this.documentId &&
      previousCommand.name === this.name
    ) {
      // Preserve every affected key and the state before the first update.
      this.newSettings = { ...previousCommand.newSettings, ...this.newSettings };
      this.prevSettings = { ...this.prevSettings, ...previousCommand.prevSettings };
      return true;
    }
    return false;
  }
}
