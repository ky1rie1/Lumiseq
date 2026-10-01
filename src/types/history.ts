// src/types/history.ts

export interface ICommand {
  readonly id: string;
  readonly name: string;
  readonly documentId: string;
  readonly timestamp: number;

  /** Execute the command action on Document Engine */
  execute(): void | Promise<void>;

  /** Undo the command action on Document Engine */
  undo(): void | Promise<void>;

  /** Redo the command action on Document Engine (defaults to calling execute()) */
  redo?(): void | Promise<void>;

  /**
   * Rule 2: Command Coalescing
   * Try to merge this command with a preceding command of the same kind.
   * Return true if merged successfully, meaning this command replaces or absorbs into the previous one.
   */
  mergeWith?(previousCommand: ICommand): boolean;
}

/** Explicit ownership supplied by an AI-scoped command bus, never ambient UI state. */
export interface CommandExecutionContext {
  agentRunId?: string;
}

export interface HistoryEntry {
  id: string;
  name: string;
  documentId: string;
  timestamp: number;
  command: ICommand;
  agentRunId?: string;
}

export interface TransactionToken {
  id: string;
  name: string;
  documentId: string;
  startTime: number;
}

export type HistoryEventListener = (event: HistoryEvent) => void;

export type HistoryEvent =
  | { type: 'executed'; entry: HistoryEntry }
  | { type: 'undone'; entry: HistoryEntry }
  | { type: 'redone'; entry: HistoryEntry }
  | { type: 'cleared' };

export interface ICommandBus {
  /** Retain 20–200 history entries, preserving complete active operations and AI runs. */
  setHistoryLimit(limit: number): void;

  /** Normal command execution, pushed to undo stack (and merged if possible) */
  execute(command: ICommand, context?: CommandExecutionContext): Promise<void> | void;

  /**
   * Rule 2: Begin transaction for continuous UI operations like slider drag / transform.
   */
  beginTransaction(name: string, documentId: string, context?: CommandExecutionContext): TransactionToken;

  /**
   * Rule 2: Preview intermediate state during active transaction.
   * Updates Document Engine for instant rendering without creating multiple undo records.
   * A supplied token must be the active transaction returned by beginTransaction.
   */
  preview(command: ICommand, token?: TransactionToken): void;

  /**
   * Rule 2: Commit transaction. The net effect between initial state and final state
   * is committed as a single HistoryEntry on the undo stack.
   * A stale supplied token is ignored, leaving another owner's transaction active.
   */
  commitTransaction(token?: TransactionToken): void;

  /** Abort active transaction, reverting document to transaction start; ignore stale supplied tokens. */
  abortTransaction(token?: TransactionToken): void;

  /** Begin an AI Agent Run transaction to group multiple tool actions */
  beginAgentRun(runId: string, name: string): void;

  /** Commit the active AI Agent Run */
  commitAgentRun(): void;

  /** Rollback/Undo all commands executed within a specific AI Agent Run */
  rollbackAgentRun(runId: string): boolean;

  /** Undo the most recent AI Agent Run */
  undoLastAgentRun(): boolean;

  /** Undo top command on history stack */
  undo(): boolean;

  /** Redo top command on redo stack */
  redo(): boolean;

  canUndo(): boolean;
  canRedo(): boolean;
  getHistory(): HistoryEntry[];
  clear(): void;
  clearHistory(): void;
  subscribe(listener: HistoryEventListener): () => void;
}
