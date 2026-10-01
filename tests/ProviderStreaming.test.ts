import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/ai/providers/OpenAIProvider';
import { ClaudeProvider } from '../src/ai/providers/ClaudeProvider';
import type { ProviderConfig } from '../src/ai/types';
import type { SecureVault } from '../src/ai/security/SecureVault';

const vault = { getProviderSecret: async () => 'test-only-key' } as SecureVault;
const config: ProviderConfig = {
  id: 'test', name: 'Test', type: 'openai', baseUrl: 'https://example.test/v1',
  model: 'test-model', enabled: true, isDefault: true, maxRetries: 0,
};

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('provider streaming', () => {
  it('keeps OpenAI compatible SSE events split across network chunks', async () => {
    const event = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n';
    vi.stubGlobal('fetch', async () => streamResponse([event.slice(0, 23), event.slice(23)]));
    const deltas: string[] = [];

    const reply = await new OpenAIProvider(config, vault).chat(
      [{ role: 'user', content: 'hi' }], [], (delta) => deltas.push(delta),
    );

    expect(reply.content).toBe('你好');
    expect(deltas).toEqual(['你好']);
  });

  it('keeps Claude SSE events split across network chunks', async () => {
    const event = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n';
    vi.stubGlobal('fetch', async () => streamResponse([event.slice(0, 47), event.slice(47)]));
    const deltas: string[] = [];

    const reply = await new ClaudeProvider({ ...config, type: 'anthropic' }, vault).chat(
      [{ role: 'user', content: 'hi' }], [], (delta) => deltas.push(delta),
    );

    expect(reply.content).toBe('你好');
    expect(deltas).toEqual(['你好']);
  });
});
