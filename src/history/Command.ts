// src/history/Command.ts
import { ICommand } from '../types/history';

export abstract class BaseCommand implements ICommand {
  readonly id: string;
  readonly timestamp: number;

  constructor(
    readonly name: string,
    readonly documentId: string
  ) {
    this.id = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.timestamp = Date.now();
  }

  abstract execute(): void;
  abstract undo(): void;

  redo(): void {
    this.execute();
  }

  mergeWith?(_previousCommand: ICommand): boolean;
}
