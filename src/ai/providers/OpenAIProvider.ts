// src/ai/providers/OpenAIProvider.ts
import { BaseProvider } from './BaseProvider';
import {
  AgentMessage,
  CanonicalToolSchema,
  ConnectionTestResult,
  ProviderCapabilities
} from '../types';
import { OpenAISchemaAdapter } from '../tools/schemaAdapters/OpenAISchemaAdapter';
import { Redactor } from '../security/Redactor';
import { readSSEData } from './readSSEData';
import { serializeImageRequest, negotiatedImageLimits, normalizeImageMessages, separateToolImages } from './imageTransport';

export class OpenAIProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    text: true,
    vision: true,
    toolCalling: true,
    streaming: true,
    imageGeneration: false,
    structuredOutput: true,
  };

  get imageLimits() { return negotiatedImageLimits(this.config); }

  async chat(
    messages: AgentMessage[],
    tools: CanonicalToolSchema[],
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<AgentMessage> {
    messages = separateToolImages(normalizeImageMessages(messages, this.imageLimits));
    const apiKey = await this.getApiKey();
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const openAITools = tools.length > 0 ? OpenAISchemaAdapter.adaptAll(tools) : undefined;

    // Convert internal messages to OpenAI chat format
    const formattedMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId,
          name: m.name,
          content: m.content || '',
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      if (m.role === 'user' && m.images?.length) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: m.content || '' },
            ...m.images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } })),
          ],
        };
      }
      return {
        role: m.role,
        content: m.content || '',
      };
    });

    const isStreaming = !!onDelta && this.capabilities.streaming;

    const payload: Record<string, any> = {
      model: this.config.model,
      messages: formattedMessages,
      stream: isStreaming,
    };

    if (openAITools && openAITools.length > 0) {
      payload.tools = openAITools;
      payload.tool_choice = 'auto';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let response = await this.secureFetch(
      endpoint,
      {
        method: 'POST',
        headers,
        body: serializeImageRequest(payload),
      },
      this.config.timeoutMs || 45000,
      signal
    );

    // Automatic backoff on 429 Rate Limit
    if (response.status === 429 && !signal?.aborted) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '3', 10);
      const waitMs = Math.min(Math.max(retryAfter * 1000, 3000), 10000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (!signal?.aborted) {
        response = await this.secureFetch(
          endpoint,
          {
            method: 'POST',
            headers,
            body: serializeImageRequest(payload),
          },
          this.config.timeoutMs || 45000,
          signal
        );
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      const sanitized = Redactor.redact(errorText);
      throw new Error(`OpenAI Provider error (${response.status}): ${sanitized}`);
    }

    if (!isStreaming) {
      const data = await response.json();
      const choice = data.choices?.[0];
      const message = choice?.message;

      const toolCalls = message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
      }));

      return {
        role: 'assistant',
        content: message?.content || undefined,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      };
    }

    // Stream SSE chunks
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable for streaming');
    }

    let fullContent = '';
    const pendingToolCalls: Map<number, { id: string; name: string; argsText: string }> = new Map();

    for await (const data of readSSEData(reader)) {
        if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              fullContent += delta.content;
              onDelta(delta.content);
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const existing = pendingToolCalls.get(idx) || { id: '', name: '', argsText: '' };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name += tc.function.name;
                if (tc.function?.arguments) existing.argsText += tc.function.arguments;
                pendingToolCalls.set(idx, existing);
              }
            }
          } catch {
            // Ignore malformed provider events.
          }
    }

    const toolCalls = Array.from(pendingToolCalls.values()).map((tc) => {
      let parsedArgs = {};
      try {
        parsedArgs = tc.argsText ? JSON.parse(tc.argsText) : {};
      } catch {
        parsedArgs = {};
      }
      return {
        id: tc.id,
        name: tc.name,
        arguments: parsedArgs,
      };
    });

    return {
      role: 'assistant',
      content: fullContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    try {
      const apiKey = await this.getApiKey();
      const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

      // 1. Text Response Validation
      const response = await this.secureFetch(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
            max_tokens: 10,
          }),
        },
        15000
      );

      const latencyMs = Date.now() - startTime;
      if (!response.ok) {
        const txt = await response.text();
        return {
          success: false,
          latencyMs,
          model: this.config.model,
          visionSupport: this.capabilities.vision,
          toolSupport: false,
          error: Redactor.redact(`HTTP ${response.status}: ${txt}`),
        };
      }

      // 2. Structured Tool Calling Validation
      let toolVerified = false;
      if (this.capabilities.toolCalling) {
        try {
          const toolTestResp = await this.secureFetch(
            endpoint,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: this.config.model,
                messages: [{ role: 'user', content: 'Call the test_tool with status "ok".' }],
                tools: [
                  {
                    type: 'function',
                    function: {
                      name: 'test_tool',
                      description: 'Integration test tool',
                      parameters: {
                        type: 'object',
                        properties: { status: { type: 'string' } },
                        required: ['status'],
                      },
                    },
                  },
                ],
                tool_choice: 'auto',
                max_tokens: 60,
              }),
            },
            15000
          );

          if (toolTestResp.ok) {
            const data = await toolTestResp.json();
            const toolCalls = data.choices?.[0]?.message?.tool_calls;
            toolVerified = Array.isArray(toolCalls) && toolCalls.some((tc: any) => tc.function?.name === 'test_tool');
          }
        } catch {
          toolVerified = false;
        }
      }

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
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        model: this.config.model,
        visionSupport: this.capabilities.vision,
        toolSupport: false,
        error: Redactor.redact(err.message || String(err)),
      };
    }
  }
}
