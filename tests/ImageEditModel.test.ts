import { afterEach, expect, it, vi } from 'vitest';
import { GenericImageEditProvider } from '../src/ai/providers/GenericImageEditProvider';
import { ProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import type { ProviderConfig } from '../src/ai/types';

afterEach(() => vi.unstubAllGlobals());

it('uses a separate image edit model and omits GPT-incompatible response_format', async () => {
  const requests: FormData[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    requests.push(init.body as FormData);
    return new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] }), { status: 200 });
  });
  const config: ProviderConfig = {
    id: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o', enabled: true, isDefault: true,
    imageEditConfig: { style: 'openai-edits', imageEditModel: 'gpt-image-2' },
  };
  const image = new Blob([new Uint8Array([1])], { type: 'image/png' });

  await new GenericImageEditProvider(config, async () => 'test-only-key').inpaint(image, image);

  expect(requests[0].get('model')).toBe('gpt-image-2');
  expect(requests[0].has('response_format')).toBe(false);
});

it('ships the OpenAI preset with an image edit model distinct from its chat model', () => {
  const config = new ProviderRegistry().getConfig('openai')!;
  expect(config.imageEditConfig?.imageEditModel).toBe('gpt-image-2');
  expect(config.imageEditConfig?.imageEditModel).not.toBe(config.model);
});
