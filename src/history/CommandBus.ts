// src/history/CommandBus.ts
import {
  HistoryEntry,
  HistoryEventListener,
  HistoryEvent,
  ICommand,
  ICommandBus,
  TransactionToken,
  CommandExecutionContext
} from '../types/history';
import { IDocumentManager, StudioDocument } from '../types/document';
import { defaultDocumentManager, restoreDocumentSnapshot } from '../document/DocumentManager';
import { BaseCommand } from './Command';

interface ActiveTransaction {
  token: TransactionToken;
  initialDocSnapshot: StudioDocument;
  previewCommands: ICommand[];
  agentRunId?: string;
}

/**
 * Composite command created when a transaction commits.
 * Groups 1 to N continuous operations (like 20 slider moves) into a single undoable step.
 */
class TransactionCompositeCommand extends BaseCommand {
  private finalDocSnapshot: StudioDocument;

  constructor(
    name: string,
    documentId: string,
    private documentManager: IDocumentManager,
    private initialDocSnapshot: StudioDocument
  ) {
    super(name, documentId);
    const current = documentManager.getDocument(documentId);
    if (!current) {
      throw new Error(`Cannot create TransactionCompositeCommand: document "${documentId}" missing.`);
    }
    this.finalDocSnapshot = structuredClone(current);
  }

  execute(): void {
    // Replay final state
    restoreDocumentSnapshot(this.documentManager, this.finalDocSnapshot, `Redo: ${this.name}`);
  }

  undo(): void {
    // Restore initial state before transaction started
    restoreDocumentSnapshot(this.documentManager, this.initialDocSnapshot, `Undo: ${this.name}`);
  }
}

export class CommandBus implements ICommandBus {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private activeTransaction: ActiveTransaction | null = null;
  private activeAgentRunId: string | null = null;
  private historyLimit = 100;
  private pendingExecutions = 0;
  private listeners: Set<HistoryEventListener> = new Set();

  constructor(private documentManager: IDocumentManager = defaultDocumentManager) {}

  setHistoryLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 20 || limit > 200) {
      throw new RangeError('History limit must be an integer between 20 and 200.');
    }
    this.historyLimit = limit;
    if (this.trimHistory()) this.emit({ type: 'cleared' });
  }

  beginAgentRun(runId: string, _name: string): void {
    this.activeAgentRunId = runId;
  }

  /** Tools receive this facade; concurrent UI actions keep using the ordinary bus. */
  forAgentRun(runId: string): ICommandBus {
    return new Proxy<ICommandBus>(this, {
      get: (target, property) => {
        if (property === 'execute') return (command: ICommand) => this.execute(command, { agentRunId: runId });
        if (property === 'beginTransaction') return (name: string, documentId: string) => this.beginTransaction(name, documentId, { agentRunId: runId });
        if (['preview', 'commitTransaction', 'abortTransaction'].includes(String(property))) {
          return (...args: unknown[]) => {
            this.validateExecutionContext({ agentRunId: runId });
            if (this.activeTransaction && this.activeTransaction.agentRunId !== runId) {
              throw new Error('不能修改其他操作的事务。');
            }
            return Reflect.apply(Reflect.get(target, property, target), target, args);
          };
        }
        if (property === 'undo' || property === 'redo') {
          return () => {
            this.validateExecutionContext({ agentRunId: runId });
            if (this.activeTransaction || this.pendingExecutions) {
              throw new Error('当前操作尚未结束，请完成操作后再撤销或重做。');
            }
            return property === 'undo' ? this.undo() : this.redo();
          };
        }
        if (['beginAgentRun', 'commitAgentRun', 'rollbackAgentRun', 'undoLastAgentRun', 'clear', 'clearHistory', 'setHistoryLimit'].includes(String(property))) {
          return () => {
            this.validateExecutionContext({ agentRunId: runId });
            throw new Error('AI 工具不能控制全局历史记录。');
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  private validateExecutionContext(context?: CommandExecutionContext): void {
    if (context?.agentRunId && context.agentRunId !== this.activeAgentRunId) {
      throw new Error('AI 任务已结束，不能继续修改文档。');
    }
  }

  getAgentRunUndoBlockReason(runId: string): string | null {
    const first = this.undoStack.findIndex(entry => entry.agentRunId === runId);
    if (first === -1) return '此任务没有可撤销的编辑记录。';
    if (this.activeTransaction || this.pendingExecutions) return '当前操作尚未结束，请完成操作后再撤销任务。';
    if (this.undoStack.slice(first).some(entry => entry.agentRunId !== runId)) {
      return '该任务之后还有后续编辑，请先撤销后续操作；当前修改已保留。';
    }
    return null;
  }

  commitAgentRun(): void {
    if (this.activeTransaction?.agentRunId === this.activeAgentRunId && this.activeAgentRunId) {
      this.commitTransaction();
    }
    this.activeAgentRunId = null;
    if (this.trimHistory()) this.emit({ type: 'cleared' });
  }

  /**
   * Undoes all commands created under the given agent run ID.
   */
  rollbackAgentRun(runId: string): boolean {
    let rolledBackCount = 0;
    if (this.activeTransaction?.agentRunId === runId) {
      rolledBackCount = this.activeTransaction.previewCommands.length ? 1 : 0;
      this.abortTransaction();
    }
    // A selective undo cannot safely apply old before-states over later edits.
    const blocked = this.getAgentRunUndoBlockReason(runId);
    while (!blocked && this.undoStack.length > 0) {
      const top = this.undoStack[this.undoStack.length - 1];
      if (top.agentRunId === runId) {
        this.undo();
        rolledBackCount++;
      } else break;
    }

    // Failure and cancellation end the active run without a separate commit.
    // Keep its identity during every undo, then release it even for an empty run.
    if (this.activeAgentRunId === runId) {
      this.activeAgentRunId = null;
      if (this.trimHistory()) this.emit({ type: 'cleared' });
    }
    // Aborting a preview is not a successful whole-run undo if older task edits remain.
    return rolledBackCount > 0 && !this.undoStack.some(entry => entry.agentRunId === runId);
  }

  /**
   * Convenience method to undo the most recent Agent Run.
   */
  undoLastAgentRun(): boolean {
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const runId = this.undoStack[i].agentRunId;
      if (runId) {
        return this.rollbackAgentRun(runId);
      }
    }
    return false;
  }

  execute(command: ICommand, context?: CommandExecutionContext): Promise<void> | void {
    this.validateExecutionContext(context);
    // If a transaction is active, executing a command without preview throws or auto-commits
    if (this.activeTransaction) {
      console.warn('CommandBus.execute called while transaction active. Committing active transaction first.');
      this.commitTransaction();
    }

    const agentRunId = context?.agentRunId;
    this.pendingExecutions++;
    let res: void | Promise<void>;
    try {
      res = command.execute();
    } catch (error) {
      this.pendingExecutions--;
      if (this.trimHistory()) this.emit({ type: 'cleared' });
      throw error;
    }

    const record = () => {
      // Try Command Coalescing (Rule 2)
      const topEntry = this.undoStack[this.undoStack.length - 1];
      if (topEntry && topEntry.agentRunId === agentRunId && command.mergeWith && command.mergeWith(topEntry.command)) {
        // mergeWith copies the original before-state into the newly executed command.
        // The new command owns the final after-state, so it must replace the old entry.
        topEntry.command = command;
        topEntry.name = command.name;
        topEntry.timestamp = Date.now();
        this.redoStack = [];
        this.trimHistory();
        this.emit({ type: 'executed', entry: topEntry });
        return;
      }

      const entry: HistoryEntry = {
        id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: command.name,
        documentId: command.documentId,
        timestamp: Date.now(),
        command,
        agentRunId,
      };

      this.undoStack.push(entry);
      this.redoStack = []; // Clear redo stack on new action
      this.trimHistory();
      this.emit({ type: 'executed', entry });
    };

    if (res instanceof Promise) {
      return res.then(() => { this.pendingExecutions--; record(); }, error => {
        this.pendingExecutions--;
        if (this.trimHistory()) this.emit({ type: 'cleared' });
        throw error;
      });
    } else {
      this.pendingExecutions--;
      record();
    }
  }


  beginTransaction(name: string, documentId: string, context?: CommandExecutionContext): TransactionToken {
    this.validateExecutionContext(context);
    if (this.activeTransaction) {
      this.commitTransaction();
    }

    const doc = this.documentManager.getDocument(documentId);
    if (!doc) {
      throw new Error(`Cannot begin transaction on non-existent document "${documentId}".`);
    }

    const token: TransactionToken = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      documentId,
      startTime: Date.now(),
    };

    this.activeTransaction = {
      token,
      initialDocSnapshot: structuredClone(doc),
      previewCommands: [],
      agentRunId: context?.agentRunId,
    };

    return token;
  }

  preview(command: ICommand, token?: TransactionToken): void {
    if (token && this.activeTransaction?.token !== token) {
      throw new Error('Cannot preview a transaction that is no longer active.');
    }
    if (!this.activeTransaction) {
      throw new Error(`Cannot call preview() without an active transaction. Call beginTransaction() first.`);
    }

    if (command.documentId !== this.activeTransaction.token.documentId) {
      throw new Error(`Preview command documentId "${command.documentId}" does not match active transaction documentId "${this.activeTransaction.token.documentId}".`);
    }

    // Execute preview immediately for high-fps UI updates
    command.execute();
    this.activeTransaction.previewCommands.push(command);
  }

  commitTransaction(expectedToken?: TransactionToken): void {
    if (expectedToken && this.activeTransaction?.token !== expectedToken) return;
    if (!this.activeTransaction) return;

    const { token, initialDocSnapshot, previewCommands, agentRunId } = this.activeTransaction;
    this.activeTransaction = null;

    if (previewCommands.length === 0) {
      // No operations took place, nothing to record
      if (this.trimHistory()) this.emit({ type: 'cleared' });
      return;
    }

    // Coalesce all preview operations into ONE single HistoryEntry
    const composite = new TransactionCompositeCommand(
      token.name,
      token.documentId,
      this.documentManager,
      initialDocSnapshot
    );

    const entry: HistoryEntry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: token.name,
      documentId: token.documentId,
      timestamp: Date.now(),
      command: composite,
      agentRunId,
    };

    this.undoStack.push(entry);
    this.redoStack = [];
    this.trimHistory();
    this.emit({ type: 'executed', entry });
  }

  abortTransaction(expectedToken?: TransactionToken): void {
    if (expectedToken && this.activeTransaction?.token !== expectedToken) return;
    if (!this.activeTransaction) return;

    const { initialDocSnapshot } = this.activeTransaction;
    this.activeTransaction = null;

    // Restore to initial state
    restoreDocumentSnapshot(this.documentManager, initialDocSnapshot, 'Transaction aborted');
    if (this.trimHistory()) this.emit({ type: 'cleared' });
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;

    entry.command.undo();
    this.redoStack.push(entry);
    this.emit({ type: 'undone', entry });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;

    if (entry.command.redo) {
      entry.command.redo();
    } else {
      entry.command.execute();
    }

    this.undoStack.push(entry);
    this.emit({ type: 'redone', entry });
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getHistory(): HistoryEntry[] {
    return [...this.undoStack];
  }

  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emit({ type: 'cleared' });
  }

  clear(): void {
    this.clearHistory();
  }

  subscribe(listener: HistoryEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private trimHistory(): boolean {
    // Active operations need their full before-state for rollback. Trim at commit.
    if (this.activeTransaction || this.activeAgentRunId || this.pendingExecutions) return false;
    const timeline = [...this.undoStack, ...this.redoStack.slice().reverse()];
    let removed = 0;
    while (timeline.length - removed > this.historyLimit) {
      let end = removed + 1;
      // Include every entry of a run, including entries currently in redo.
      for (let i = removed; i < end; i++) {
        const runId = timeline[i].agentRunId;
        if (runId) {
          for (let j = end; j < timeline.length; j++) {
            if (timeline[j].agentRunId === runId) end = j + 1;
          }
        }
      }
      // One indivisible newest run may exceed the cap. Keep its complete undo.
      if (end === timeline.length) break;
      removed = end;
    }
    if (!removed) return false;
    const evicted = new Set(timeline.slice(0, removed));
    this.undoStack = this.undoStack.filter(entry => !evicted.has(entry));
    this.redoStack = this.redoStack.filter(entry => !evicted.has(entry));
    return true;
  }

  private emit(event: HistoryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in HistoryEventListener:', err);
      }
    }
  }
}

export const defaultCommandBus = new CommandBus(defaultDocumentManager);
