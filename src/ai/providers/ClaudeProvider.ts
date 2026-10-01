// src/ai/providers/ClaudeProvider.ts
import { BaseProvider } from './BaseProvider';
import {
  AgentMessage,
  CanonicalToolSchema,
  ConnectionTestResult,
  ProviderCapabilities
} from '../types';
import { ClaudeSchemaAdapter } from '../tools/schemaAdapters/ClaudeSchemaAdapter';
import { Redactor } from '../security/Redactor';
import { readSSEData } from './readSSEData';
import { serializeImageRequest, negotiatedImageLimits, normalizeImageMessages } from './imageTransport';

export class ClaudeProvider extends BaseProvider {
  readonly capabilities: ProviderCapabilities = {
    text: true,
    vision: true,
    toolCalling: true,
    streaming: true,
    imageGeneration: false,
    structuredOutput: true,
  };

  get imageLimits() { return negotiatedImageLimits(this.config, { maxImages:16, maxImageBytes:3*1024*1024, maxTotalBytes:20*1024*1024 }); }

  async chat(
    messages: AgentMessage[],
    tools: CanonicalToolSchema[],
    onDelta?: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<AgentMessage> {
    messages = normalizeImageMessages(messages, this.imageLimits);
    const apiKey = await this.getApiKey();
    const cleanBase = this.config.baseUrl.replace(/\/+$/, '');
    const endpoint = cleanBase.endsWith('/v1')
      ? `${cleanBase}/messages`
      : `${cleanBase}/v1/messages`;
    const claudeTools = tools.length > 0 ? ClaudeSchemaAdapter.adaptAll(tools) : undefined;

    // Filter system message
    const systemMsg = messages.find((m) => m.role === 'system')?.content;
    const conversationMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.toolCallId,
                content: m.images?.length ? [{type:'text',text:m.content || ''}, ...m.images.map(image => ({type:'image',source:{type:'base64',media_type:image.mimeType,data:image.data}}))] : m.content || '',
              },
            ],
          };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          const contents: any[] = [];
          if (m.content) {
            contents.push({ type: 'text', text: m.content });
          }
          for (const tc of m.toolCalls) {
            contents.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          return {
            role: 'assistant',
            content: contents,
          };
        }
        if (m.role === 'user' && m.images?.length) {
          return {
            role: 'user',
            content: [
              ...m.images.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } })),
              { type: 'text', text: m.content || '' },
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
      max_tokens: 4096,
      messages: conversationMsgs,
      stream: isStreaming,
    };

    if (systemMsg) {
      payload.system = systemMsg;
    }
    if (claudeTools && claudeTools.length > 0) {
      payload.tools = claudeTools;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    };

    const response = await this.secureFetch(
      endpoint,
      {
        method: 'POST',
        headers,
        body: serializeImageRequest(payload, 32_000_000),
      },
      this.config.timeoutMs || 45000,
      signal
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude Provider error (${response.status}): ${Redactor.redact(errorText)}`);
    }

    if (!isStreaming) {
      const data = await response.json();
      let textContent = '';
      const toolCalls: any[] = [];

      for (const block of data.content || []) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input || {},
          });
        }
      }

      return {
        role: 'assistant',
        content: textContent || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    }

    // Stream SSE chunks
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable for streaming');

    let fullContent = '';
    const toolCalls: any[] = [];
    let currentTool: { id: string; name: string; inputJson: string } | null = null;

    for await (const data of readSSEData(reader)) {
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            currentTool = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: '',
            };
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta') {
              fullContent += event.delta.text;
              onDelta(event.delta.text);
            } else if (event.delta?.type === 'input_json_delta' && currentTool) {
              currentTool.inputJson += event.delta.partial_json;
            }
          } else if (event.type === 'content_block_stop' && currentTool) {
            let parsed = {};
            try {
              parsed = currentTool.inputJson ? JSON.parse(currentTool.inputJson) : {};
            } catch {}
            toolCalls.push({
              id: currentTool.id,
              name: currentTool.name,
              arguments: parsed,
            });
            currentTool = null;
          }
        } catch {}
    }

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
      const cleanBase = this.config.baseUrl.replace(/\/+$/, '');
      const endpoint = cleanBase.endsWith('/v1')
        ? `${cleanBase}/messages`
        : `${cleanBase}/v1/messages`;

      // 1. Text Response Validation
      const response = await this.secureFetch(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            ...(apiKey ? { 'x-api-key': apiKey } : {}),
          },
          body: JSON.stringify({
            model: this.config.model,
            max_tokens: 15,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
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
                'anthropic-version': '2023-06-01',
                ...(apiKey ? { 'x-api-key': apiKey } : {}),
              },
              body: JSON.stringify({
                model: this.config.model,
                max_tokens: 60,
                messages: [{ role: 'user', content: 'Use the test_tool to confirm status is "ok".' }],
                tools: [
                  {
                    name: 'test_tool',
                    description: 'Integration test tool',
                    input_schema: {
                      type: 'object',
                      properties: { status: { type: 'string' } },
                      required: ['status'],
                    },
                  },
                ],
              }),
            },
            15000
          );

          if (toolTestResp.ok) {
            const data = await toolTestResp.json();
            const content = data.content || [];
            toolVerified = content.some((block: any) => block.type === 'tool_use' && block.name === 'test_tool');
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
