import { afterEach, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../src/ai/providers/GeminiProvider';
import type { ProviderConfig } from '../src/ai/types';
import type { SecureVault } from '../src/ai/security/SecureVault';

afterEach(() => vi.unstubAllGlobals());

it('returns Gemini tool results as user parts and preserves the model thought signature', async () => {
  const requests: any[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: requests.length === 1
      ? [{ functionCall: { id: 'call-1', name: 'inspect', args: { x: 1 } }, thoughtSignature: 'signature-1' }]
      : [{ text: '完成' }] } }] }), { status: 200 });
  });
  const config: ProviderConfig = {
    id: 'gemini', name: 'Gemini', type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.8-flash', enabled: true, isDefault: true,
  };
  const vault = { getProviderSecret: async () => 'test-only-key' } as SecureVault;
  const provider = new GeminiProvider(config, vault);
  const user = { role: 'user' as const, content: 'Inspect' };

  const toolRequest = await provider.chat([user], []);
  expect(toolRequest.toolCalls).toEqual([{
    id: 'call-1', name: 'inspect', arguments: { x: 1 }, thoughtSignature: 'signature-1',
  }]);

  const reply = await provider.chat([user, toolRequest, {
    role: 'tool', name: 'inspect', toolCallId: 'call-1', content: '{"x":1}',
  }], []);
  expect(reply.content).toBe('完成');
  expect(requests[1].contents[1]).toEqual({ role: 'model', parts: [{
    functionCall: { id: 'call-1', name: 'inspect', args: { x: 1 } }, thoughtSignature: 'signature-1',
  }] });
  expect(requests[1].contents[2]).toEqual({ role: 'user', parts: [{
    functionResponse: { id: 'call-1', name: 'inspect', response: { content: '{"x":1}' } },
  }] });
});
