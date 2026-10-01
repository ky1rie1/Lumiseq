// src/ai/providers/IAIProvider.ts
import {
  ProviderConfig,
  ProviderCapabilities,
  AgentMessage,
  CanonicalToolSchema,
  ConnectionTestResult
} from '../types';

export interface IAIProvider {
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;
  readonly imageLimits?: import('../types').ImageInputLimits;
  /** Optional read-only connector preparation; does not authenticate or make model requests. */
  prepareCapabilities?(signal?: AbortSignal): Promise<void>;

  /**
   * Executes a chat completion step, returning the assistant's message
   * (which may contain text and/or one or more tool calls).
   */
  chat(
    messages: AgentMessage[],
    tools: CanonicalToolSchema[],
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<AgentMessage>;

  /**
   * Probes the provider endpoint with a minimal request to test latency,
   * authentication, and model tool/vision capabilities.
   */
  testConnection(): Promise<ConnectionTestResult>;
}
