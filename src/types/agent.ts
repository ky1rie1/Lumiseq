// src/types/agent.ts
import { ICommandBus } from './history';
import { IDocumentManager } from './document';
import { IAssetManager } from './asset';

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

export interface AgentExecutionContext {
  commandBus: ICommandBus;
  documentManager: IDocumentManager;
  assetManager: IAssetManager;
  activeDocumentId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ITool<TParams = any, TResult = any> {
  readonly name: string;
  readonly category: 'develop' | 'edit' | 'catalog' | 'system';
  readonly description: string;
  readonly parameters: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
    required: string[];
  };
  readonly riskLevel: 'safe' | 'normal' | 'dangerous';

  /**
   * Rule 9: Tool NEVER modifies state directly.
   * It creates and dispatches ICommand through context.commandBus.
   */
  execute(params: TParams, context: AgentExecutionContext): Promise<TResult>;
}

export interface AgentActionRecord {
  id: string;
  timestamp: number;
  toolName: string;
  summary: string;
  success: boolean;
  error?: string;
  canUndo: boolean;
}
