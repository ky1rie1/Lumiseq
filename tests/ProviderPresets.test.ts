import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import type { ProviderConfig } from '../src/ai/types';
import type { SecureVault } from '../src/ai/security/SecureVault';

const createStorage = (entries: Record<string, string> = {}) => {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

const vault = { getProviderSecret: async () => 'test-only-key' } as SecureVault;

afterEach(() => vi.unstubAllGlobals());

describe('provider presets', () => {
  it('adds supported providers to an existing installation without changing the selected model', () => {
    const saved: ProviderConfig = {
      id: 'openai', name: 'My OpenAI', type: 'openai',
      baseUrl: 'https://example.test/v1', model: 'my-model',
      enabled: true, isDefault: true,
    };
    vi.stubGlobal('localStorage', createStorage({
      ai_studio_providers: JSON.stringify([saved]),
      ai_studio_active_provider: 'openai',
    }));

    const registry = new ProviderRegistry(vault);
    expect(registry.getActiveConfig()).toMatchObject({ name: 'My OpenAI', model: 'my-model' });
    expect(registry.getConfig('deepseek')).toMatchObject({
      baseUrl: 'https://api.deepseek.com', type: 'openai-compatible',
    });
    expect(registry.getConfig('qwen')).toMatchObject({
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', type: 'openai-compatible',
    });
  });

  it.each([
    ['deepseek', 'https://api.deepseek.com/chat/completions'],
    ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
  ])('%s sends a compatible request to its official chat endpoint', async (id, expectedUrl) => {
    vi.stubGlobal('localStorage', createStorage());
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await new ProviderRegistry(vault).getProvider(id).chat(
      [{ role: 'user', content: 'hi' }], [],
    );

    expect(result.content).toBe('ok');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(expectedUrl);
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-only-key');
  });

  it('rejects a custom REST provider instead of silently using the OpenAI protocol', () => {
    vi.stubGlobal('localStorage', createStorage());
    const registry = new ProviderRegistry(vault);
    registry.saveConfig({
      id: 'unknown-rest', name: 'Unknown REST', type: 'custom-rest',
      baseUrl: 'https://example.test', model: 'model', enabled: true, isDefault: false,
    });

    expect(() => registry.getProvider('unknown-rest')).toThrow(/unsupported|不支持/i);
  });

  it('notifies listeners when the active provider or its model changes', () => {
    vi.stubGlobal('localStorage', createStorage());
    const registry = new ProviderRegistry(vault);
    const activeModels: string[] = [];
    const unsubscribe = registry.subscribe(() => activeModels.push(registry.getActiveConfig().model));

    registry.setActiveProvider('qwen');
    registry.saveConfig({ ...registry.getActiveConfig(), model: 'qwen-custom' });
    unsubscribe();
    registry.setActiveProvider('openai');

    expect(activeModels).toEqual(['qwen-plus', 'qwen-custom']);
  });
});
