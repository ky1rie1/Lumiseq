// src/ai/providers/GeminiProvider.ts
import { BaseProvider } from './BaseProvider';
import {
  AgentMessage,
  CanonicalToolSchema,
  ConnectionTestResult,
  ProviderCapabilities
} from '../types';
import { GeminiSchemaAdapter } from '../tools/schemaAdapters/GeminiSchemaAdapter';
import { Redactor } from '../security/Redactor';
import { serializeImageRequest, negotiatedImageLimits, normalizeImageMessages, separateToolImages } from './imageTransport';

export class GeminiProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    text: true,
    vision: true,
    toolCalling: true,
    streaming: true,
    imageGeneration: false,
    structuredOutput: true,
  };

  get imageLimits() { return negotiatedImageLimits(this.config, {maxImages:16,maxImageBytes:8*1024*1024,maxTotalBytes:12*1024*1024}); }

  async chat(
    messages: AgentMessage[],
    tools: CanonicalToolSchema[],
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<AgentMessage> {
    messages = separateToolImages(normalizeImageMessages(messages, this.imageLimits));
    const apiKey = await this.getApiKey();
    const isStreaming = !!onDelta && this.capabilities.streaming;
    const action = isStreaming ? 'streamGenerateContent?alt=sse' : 'generateContent';

    // Support base URL customization or default to Google API
    const base = (this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const endpoint = `${base}/models/${this.config.model}:${action}`;

    const geminiTools = tools.length > 0 ? GeminiSchemaAdapter.adaptAll(tools) : undefined;

    // Convert messages to Gemini contents format
    const systemMsg = messages.find((m) => m.role === 'system')?.content;
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: msg.toolCallId,
                name: msg.name || 'unknown_tool',
                response: {
                  content: msg.content || '',
                },
              },
            },
          ],
        });
      } else if (msg.role === 'assistant') {
        const parts: any[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                id: tc.id,
                name: tc.name,
                args: tc.arguments,
              },
              ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {}),
            });
          }
        }
        contents.push({
          role: 'model',
          parts: parts.length > 0 ? parts : [{ text: '' }],
        });
      } else {
        // user
        contents.push({
          role: 'user',
          parts: [
            { text: msg.content || '' },
            ...(msg.images ?? []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } })),
          ],
        });
      }
    }

    const payload: Record<string, any> = {
      contents,
    };

    if (systemMsg) {
      payload.systemInstruction = {
        parts: [{ text: systemMsg }],
      };
    }

    if (geminiTools && geminiTools.length > 0) {
      payload.tools = [
        {
          functionDeclarations: geminiTools,
        },
      ];
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['x-goog-api-key'] = apiKey;
    }

    const response = await this.secureFetch(
      endpoint,
      {
        method: 'POST',
        headers,
        body: serializeImageRequest(payload, 20_000_000),
      },
      this.config.timeoutMs || 45000,
      signal
    );

    if (!response.ok) {
      const errorText = await response.text();
      const sanitized = Redactor.redact(errorText);
      throw new Error(`Gemini Provider error (${response.status}): ${sanitized}`);
    }

    if (!isStreaming) {
      const data = await response.json();
      return this.parseGeminiResponse(data);
    }

    // Stream SSE chunks
    const reader = response.body?.getReader();
    if (!reader) {
      const data = await response.json();
      return this.parseGeminiResponse(data);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';
    const toolCalls: Array<{ id: string; name: string; arguments: any; thoughtSignature?: string }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const parts = parsed.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.text) {
              accumulatedContent += part.text;
              onDelta?.(part.text);
            }
            if (part.functionCall) {
              toolCalls.push({
                id: part.functionCall.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: part.functionCall.name,
                arguments: part.functionCall.args || {},
                ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
              });
            }
          }
        } catch {
          // ignore malformed SSE line
        }
      }
    }

    return {
      role: 'assistant',
      content: accumulatedContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private parseGeminiResponse(data: any): AgentMessage {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let textContent = '';
    const toolCalls: Array<{ id: string; name: string; arguments: any; thoughtSignature?: string }> = [];

    for (const part of parts) {
      if (part.text) {
        textContent += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        });
      }
    }

    return {
      role: 'assistant',
      content: textContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = performance.now();
    try {
      // 1. Text response validation
      await this.chat(
        [
          { role: 'user', content: 'Reply with OK.' }
        ],
        []
      );

      // 2. Structured tool calling validation
      let toolVerified = false;
      if (this.capabilities.toolCalling) {
        try {
          const testSchema: CanonicalToolSchema = {
            name: 'test_tool',
            description: 'Integration test tool',
            workspace: 'any',
            category: 'system',
            riskLevel: 'safe',
            parameters: {
              type: 'object',
              properties: {
                status: { type: 'string', description: 'status string' },
              },
              required: ['status'],
            },
          };

          const toolMsg = await this.chat(
            [
              { role: 'user', content: 'Call test_tool with status "ok".' }
            ],
            [testSchema]
          );

          toolVerified = Array.isArray(toolMsg.toolCalls) && toolMsg.toolCalls.some((tc) => tc.name === 'test_tool');
        } catch {
          toolVerified = false;
        }
      }

      const latencyMs = Math.round(performance.now() - startTime);

      return {
        success: true,
        latencyMs,
        model: this.config.model,
        visionSupport: this.capabilities.vision,
        toolSupport: toolVerified,
        streamingSupport: this.capabilities.streaming,
        verifiedCapabilities: {
          text: true,
          streaming: this.capabilities.streaming,
          toolCalling: toolVerified,
          vision: this.capabilities.vision,
        },
      };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        success: false,
        latencyMs,
        model: this.config.model,
        visionSupport: this.capabilities.vision,
        toolSupport: false,
        error: Redactor.redact(err?.message || String(err)),
      };
    }
  }
}
