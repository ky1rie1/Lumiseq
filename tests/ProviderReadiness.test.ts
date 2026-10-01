import { afterEach, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import { nativeLocalAgentRunner } from '../src/ai/providers/LocalAgentProvider';
import type { SecureVault } from '../src/ai/security/SecureVault';

function registry(hasKey = false) {
  return new ProviderRegistry({ hasProviderSecret: async () => hasKey, setProviderSecret: async () => {} } as unknown as SecureVault);
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not advertise a built-in preset as a connected model without a key', async () => {
  const state = await registry().getReadiness();
  expect(state).toMatchObject({ status: 'unconfigured', canSend: false, label: '未连接 AI' });
  expect(state.label).not.toContain('gpt-4o');
});

it('describes an API with a key as configured without asserting a successful connection', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { requests.push(url); throw new Error('Unexpected network request'); });
  const state = await registry(true).getReadiness();
  expect(state).toMatchObject({ status: 'configured', canSend: true, label: 'OpenAI · gpt-4o' });
  expect(requests).toEqual([]);
});

it.each([
  [{ enabled: false }, 'disabled'],
  [{ model: ' ' }, 'unconfigured'],
  [{ baseUrl: 'not-a-url' }, 'unconfigured'],
  [{ type: 'custom-rest' as const }, 'unconfigured'],
])('prevents submission with incomplete or disabled configuration %j', async (patch, status) => {
  const providers = registry(true);
  providers.saveConfig({ ...providers.getActiveConfig(), ...patch });
  expect(await providers.getReadiness()).toMatchObject({ status, canSend: false });
});

it('does not fall back to a preset when a requested provider no longer exists', async () => {
  expect(await registry(true).getReadiness('deleted-provider')).toMatchObject({ canSend: false, status: 'unconfigured' });
});

it('makes vault failures visible without treating credentials as absent or ready', async () => {
  const providers = new ProviderRegistry({ hasProviderSecret: async () => { throw new Error('Vault unavailable'); } } as unknown as SecureVault);
  expect(await providers.getReadiness()).toMatchObject({ status: 'error', canSend: false });
});

it('contains malformed saved provider configurations in a non-ready error state', async () => {
  const providers = registry(true);
  providers.saveConfig({ ...providers.getActiveConfig(), model: undefined } as unknown as import('../src/ai/types').ProviderConfig);
  expect(await providers.getReadiness()).toMatchObject({ status: 'error', canSend: false });
});

it('refreshes subscribers after a stored key is added or removed', async () => {
  let stored = false;
  const providers = new ProviderRegistry({ hasProviderSecret: async () => stored,
    setProviderSecret: async (_id: string, key: string) => { stored = !!key; } } as unknown as SecureVault);
  const observations: Array<Promise<boolean>> = [];
  providers.subscribe(() => observations.push(providers.getReadiness().then(state => state.canSend)));
  await providers.setApiKey('openai', 'test-only');
  await providers.setApiKey('openai', '');
  expect(await Promise.all(observations)).toEqual([true, false]);
});

it('allows an enabled local service without an API key', async () => {
  const providers = registry();
  providers.saveConfig({ ...providers.getConfig('local-ollama')!, enabled: true });
  expect(await providers.getReadiness('local-ollama')).toMatchObject({ status: 'configured', canSend: true });
});

it.each([true, false])('uses the installed Agent probe for availability %s without inventing a model', async available => {
  const agents: string[] = [];
  vi.spyOn(nativeLocalAgentRunner, 'probe').mockImplementation(async agent => {
    agents.push(agent); return { available, detail: available ? 'CLI installed' : 'CLI missing' };
  });
  const state = await registry().getReadiness('codex-desktop');
  expect(state.canSend).toBe(available);
  expect(state.status).toBe(available ? 'available' : 'unavailable');
  expect(state.label).not.toContain('gpt-4o');
  if (available) expect(state.label).toContain('客户端默认模型');
  expect(agents).toEqual(['codex']);
});

it('does not claim a custom model that the CLI runner does not receive', async () => {
  vi.spyOn(nativeLocalAgentRunner, 'probe').mockResolvedValue({ available: true, detail: 'CLI installed' });
  const providers = registry();
  providers.saveConfig({ ...providers.getConfig('codex-desktop')!, model: 'not-forwarded-to-cli' });
  const state = await providers.getReadiness('codex-desktop');
  expect(state.label).toContain('客户端默认模型');
  expect(state.label).not.toContain('not-forwarded-to-cli');
});
