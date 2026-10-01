import { afterEach, expect, it, vi } from 'vitest';
import { defaultMCPServerManager as manager } from '../src/ai/mcp/MCPServerManager';
import { defaultProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import { defaultCapabilityRouter as router } from '../src/ai/capabilities/CapabilityRouter';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('saves an external tool configuration without opening the HTTP listener', () => {
  const writes: string[] = [];
  vi.stubGlobal('localStorage', { setItem: (_key: string, value: string) => writes.push(value) });
  const start = vi.spyOn(manager, 'startHttp');
  manager.saveSettings({ portMode: 'fixed', fixedPort: 19380, permissionMode: 'readonly' });
  expect(start).not.toHaveBeenCalled();
  expect(manager.getSettings()).toMatchObject({ fixedPort: 19380, permissionMode: 'readonly' });
  expect(JSON.parse(writes[0])).toMatchObject({ httpEnabled: false, fixedPort: 19380 });
});
it('does not apply new external permissions when persistence fails', () => {
  const before = manager.getSettings();
  vi.stubGlobal('localStorage', { setItem() { throw new Error('quota'); } });
  expect(() => manager.saveSettings({ ...before, permissionMode: 'full' })).toThrow('quota');
  expect(manager.getSettings()).toEqual(before);
});
it('does not publish a provider draft to memory when storage rejects it', () => {
  const before = { ...defaultProviderRegistry.getActiveConfig() };
  vi.stubGlobal('localStorage', { setItem() { throw new Error('quota'); } });
  expect(() => defaultProviderRegistry.saveConfig({ ...before, name: 'Not saved' })).toThrow('quota');
  expect(defaultProviderRegistry.getConfig(before.id)?.name).toBe(before.name);
});
it('does not change active service or upload policy when local storage rejects a save', () => {
  const beforeId = defaultProviderRegistry.getActiveConfig().id;
  const beforePrivacy = router.getPrivacyMode();
  const beforeStack = router.getStackConfig();
  const beforeCost = router.getCostGuard();
  const target = defaultProviderRegistry.getAllConfigs().find(config => config.id !== beforeId)!;
  vi.stubGlobal('localStorage', { setItem() { throw new Error('quota'); } });
  expect(() => defaultProviderRegistry.setActiveProvider(target.id)).toThrow('quota');
  expect(() => router.setPrivacyMode(beforePrivacy === 'never' ? 'allow' : 'never')).toThrow('quota');
  expect(() => router.saveStackConfig({ ...beforeStack, agentProviderId: target.id })).toThrow('quota');
  expect(() => router.setCostGuard({ ...beforeCost, askBeforeImageGeneration: !beforeCost.askBeforeImageGeneration })).toThrow('quota');
  expect(defaultProviderRegistry.getActiveConfig().id).toBe(beforeId);
  expect(router.getPrivacyMode()).toBe(beforePrivacy);
  expect(router.getStackConfig()).toEqual(beforeStack);
  expect(router.getCostGuard()).toEqual(beforeCost);
});
it('keeps the provider list and active selection when deletion cannot persist', () => {
  const before = defaultProviderRegistry.getAllConfigs();
  const active = defaultProviderRegistry.getActiveConfig().id;
  vi.stubGlobal('localStorage', { setItem() { throw new Error('quota'); } });
  expect(() => defaultProviderRegistry.deleteConfig(active)).toThrow('quota');
  expect(defaultProviderRegistry.getAllConfigs()).toEqual(before);
  expect(defaultProviderRegistry.getActiveConfig().id).toBe(active);
});
