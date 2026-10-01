// src/ai/providers/LocalProvider.ts
import { OpenAIProvider } from './OpenAIProvider';
import {
  AgentMessage,
  CanonicalToolSchema,
  ConnectionTestResult,
  ProviderCapabilities
} from '../types';

export class LocalProvider extends OpenAIProvider {
  override readonly capabilities: ProviderCapabilities = {
    text: true,
    vision: true,
    toolCalling: true,
    streaming: true,
    imageGeneration: false,
    structuredOutput: false,
  };

  /**
   * Local models (Ollama, LM Studio, etc.) often don't strictly require an API key.
   * Return empty string or dummy key if none configured in DPAPI.
   */
  protected override async getApiKey(): Promise<string> {
    const key = await super.getApiKey();
    return key || 'local-no-key-required';
  }

  /**
   * Extended chat method with fallback parser for local models that don't emit native tool_calls
   * but write JSON blocks in content.
   */
  override async chat(
    messages: AgentMessage[],
    tools: CanonicalToolSchema[],
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<AgentMessage> {
    const result = await super.chat(messages, tools, onDelta, signal);

    // If native tool calls were returned, return as is
    if (result.toolCalls && result.toolCalls.length > 0) {
      return result;
    }

    // Fallback: Check if the model embedded a JSON tool call in plain text
    if (result.content && tools.length > 0) {
      const fallbackCall = this.tryExtractFallbackToolCall(result.content, tools);
      if (fallbackCall) {
        return {
          ...result,
          toolCalls: [fallbackCall],
        };
      }
    }

    return result;
  }

  private tryExtractFallbackToolCall(
    content: string,
    tools: CanonicalToolSchema[]
  ): { id: string; name: string; arguments: any } | null {
    // Try to find ```json ... ``` or ``` ... ``` or bare { "tool": ... }
    const validToolNames = new Set(tools.map((t) => t.name));
    const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    let match;

    while ((match = jsonBlockRegex.exec(content)) !== null) {
      const rawJson = match[1].trim();
      try {
        const parsed = JSON.parse(rawJson);
        const toolName = parsed.tool || parsed.name || parsed.function;
        if (toolName && validToolNames.has(toolName)) {
          return {
            id: `call_local_${Date.now()}`,
            name: toolName,
            arguments: parsed.arguments || parsed.args || parsed.parameters || {},
          };
        }
      } catch {
        // Not a JSON block
      }
    }

    return null;
  }

  override async testConnection(): Promise<ConnectionTestResult> {
    const res = await super.testConnection();
    return {
      ...res,
      model: this.config.model || 'local-default',
    };
  }
}
