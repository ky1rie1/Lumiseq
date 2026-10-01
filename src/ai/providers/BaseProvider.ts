// src/ai/providers/BaseProvider.ts
import { IAIProvider } from './IAIProvider';
import {
  ProviderConfig,
  ProviderCapabilities,
  AgentMessage,
  CanonicalToolSchema,
  ConnectionTestResult
} from '../types';
import { SecureVault, defaultSecureVault } from '../security/SecureVault';
import { Redactor } from '../security/Redactor';

export abstract class BaseProvider implements IAIProvider {
  constructor(
    public readonly config: ProviderConfig,
    protected vault: SecureVault = defaultSecureVault
  ) {}

  abstract readonly capabilities: ProviderCapabilities;

  abstract chat(
    messages: AgentMessage[],
    tools: CanonicalToolSchema[],
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<AgentMessage>;

  abstract testConnection(): Promise<ConnectionTestResult>;

  /**
   * Securely fetch API key from DPAPI vault.
   */
  protected async getApiKey(): Promise<string> {
    const key = await this.vault.getProviderSecret(this.config.id);
    return key || '';
  }

  /**
   * Wrapper for fetch requests with timeout, retries, and automatic error redaction.
   */
  protected async secureFetch(
    url: string,
    options: RequestInit,
    timeoutMs: number = this.config.timeoutMs || 45000,
    signal?: AbortSignal
  ): Promise<Response> {
    const maxRetries = this.config.maxRetries || 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

      // Merge signals
      const onAbort = () => timeoutController.abort();
      if (signal) {
        signal.addEventListener('abort', onAbort);
      }

      try {
        const response = await fetch(url, {
          ...options,
          signal: timeoutController.signal,
        });

        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }

        // Retry on 429 (rate limit) or 503 (service unavailable)
        if ((response.status === 429 || response.status === 503) && attempt <= maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        return response;
      } catch (err: any) {
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }

        if (err.name === 'AbortError') {
          if (signal?.aborted) {
            throw new Error('Request was cancelled by user');
          }
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }

        if (attempt <= maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        const sanitizedMsg = Redactor.redact(err?.message || String(err));
        throw new Error(sanitizedMsg);
      }
    }

    throw new Error('Max retries exceeded');
  }
}
