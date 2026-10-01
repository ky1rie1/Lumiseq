import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityRouter } from '../src/ai/capabilities/CapabilityRouter';
import { ProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import type { ProviderConfig } from '../src/ai/types';
import type { SecureVault } from '../src/ai/security/SecureVault';

const configured = (type: ProviderConfig['type'], id = type): ProviderConfig => ({
  id, name: id, type,
  baseUrl: type === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta'
    : type === 'anthropic' ? 'https://api.anthropic.com' : 'https://example.test/v1',
  model: 'chat-model', visionModel: 'vision-model', enabled: true, isDefault: false,
  maxRetries: 0,
});

afterEach(() => vi.unstubAllGlobals());

describe('remote capability payloads', () => {
  it('uses the actual vault secret for remote image editing', async () => {
    const vault = { getProviderSecret: async () => 'actual-test-secret', hasProviderSecret: async () => true } as SecureVault;
    const registry = new ProviderRegistry(vault);
    registry.saveConfig({ ...configured('openai-compatible', 'image-edit'),
      imageEditConfig: { style: 'openai-edits', imageEditModel: 'image-model' } });
    const router = new CapabilityRouter(registry);
    router.setPrivacyMode('allow');
    router.setCostGuard({ ...router.getCostGuard(), askBeforeImageGeneration: false });
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(init);
      return new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] }), { status: 200 });
    });

    const image = new Blob([new Uint8Array([1])], { type: 'image/png' });
    const result = await router.resolveImageEdit('image-edit').inpaint(image, image);

    expect(result.size).toBe(3);
    expect((requests[0].headers as Record<string, string>).Authorization).toBe('Bearer actual-test-secret');
    expect((requests[0].body as FormData).get('model')).toBe('image-model');
  });

  it.each([
    ['openai', (body: any) => body.messages[0].content[1].image_url.url],
    ['anthropic', (body: any) => body.messages[0].content[0].source.data],
    ['gemini', (body: any) => body.contents[0].parts[1].inlineData.data],
  ] as const)('%s sends complete image bytes to the selected vision model', async (type, imageField) => {
    const vault = { getProviderSecret: async () => 'test-only-key' } as SecureVault;
    const registry = new ProviderRegistry(vault);
    registry.saveConfig(configured(type));
    const router = new CapabilityRouter(registry);
    router.setPrivacyMode('allow');
    const requests: Array<{ url: string; body: any }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      const response = type === 'openai' ? { choices: [{ message: { content: 'seen' } }] }
        : type === 'anthropic' ? { content: [{ type: 'text', text: 'seen' }] }
          : { candidates: [{ content: { parts: [{ text: 'seen' }] } }] };
      return new Response(JSON.stringify(response), { status: 200 });
    });

    const image = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    const answer = await router.resolveVision(type)!.analyzeImage(image, 'Describe');

    expect(answer).toBe('seen');
    if (type === 'gemini') expect(requests[0].url).toContain('/models/vision-model:generateContent');
    else expect(requests[0].body.model).toBe('vision-model');
    expect(imageField(requests[0].body)).toBe(type === 'openai' ? 'data:image/png;base64,AQIDBA==' : 'AQIDBA==');
  });

  it('keeps a complete data URL when locating an object', async () => {
    const registry = new ProviderRegistry({ getProviderSecret: async () => 'test-only-key' } as SecureVault);
    const router = new CapabilityRouter(registry);
    router.setPrivacyMode('allow');
    const bodies: any[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Upper left' } }] }), { status: 200 });
    });
    const dataUrl = `data:image/png;base64,${'AQID'.repeat(40)}`;

    const answer = await router.resolveVision('openai')!.locateObject(dataUrl, 'tree');

    expect(answer.description).toBe('Upper left');
    expect(bodies[0].messages[0].content[1].image_url.url).toBe(dataUrl);
  });
});
