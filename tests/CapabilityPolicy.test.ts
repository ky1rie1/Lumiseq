import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityRouter } from '../src/ai/capabilities/CapabilityRouter';
import { ProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import type { SecureVault } from '../src/ai/security/SecureVault';

const vault = { getProviderSecret: async () => 'test-only-key', hasProviderSecret: async () => true } as SecureVault;
const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

afterEach(() => vi.unstubAllGlobals());

describe('capability policy', () => {
  it('keeps local image fill available when remote image upload is disabled', async () => {
    const router = new CapabilityRouter(new ProviderRegistry(vault));
    router.setPrivacyMode('never');

    const capability = router.resolveImageEdit('fallback-classical');
    expect(capability.isLocalFallback).toBe(true);
    expect((await capability.inpaint(image, image)).type).toBe('image/png');
  });

  it('asks before a remote vision upload and stops when declined', async () => {
    const router = new CapabilityRouter(new ProviderRegistry(vault));
    router.setPrivacyMode('ask');
    const confirm = vi.fn(async () => false);
    router.setRemoteConfirmationHandler(confirm);
    const sent = vi.fn();
    vi.stubGlobal('fetch', sent);

    await expect(router.resolveVision('openai')!.analyzeImage(image, 'Describe')).rejects.toThrow(/PRIVACY_RESTRICTION/);
    expect(confirm).toHaveBeenCalledOnce();
    expect(sent).not.toHaveBeenCalled();
  });

  it('asks before a billable remote image edit and persists the cost choice', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    const registry = new ProviderRegistry(vault);
    const first = new CapabilityRouter(registry);
    first.setCostGuard({ ...first.getCostGuard(), askBeforeImageGeneration: false });
    const restored = new CapabilityRouter(registry);
    expect(restored.getCostGuard().askBeforeImageGeneration).toBe(false);
    restored.setCostGuard({ ...restored.getCostGuard(), askBeforeImageGeneration: true });
    const router = new CapabilityRouter(registry);
    router.setPrivacyMode('allow');
    expect(router.getCostGuard().askBeforeImageGeneration).toBe(true);
    const confirm = vi.fn(async () => false);
    router.setRemoteConfirmationHandler(confirm);
    const sent = vi.fn();
    vi.stubGlobal('fetch', sent);

    await expect(router.resolveImageEdit('openai').inpaint(image, image)).rejects.toThrow(/COST_GUARD_BLOCKED/);
    expect(confirm).toHaveBeenCalledOnce();
    expect(sent).not.toHaveBeenCalled();
  });

  it('uses the local fill without claiming an upload when no image edit key exists', async () => {
    const noKeyVault = { getProviderSecret: async () => null, hasProviderSecret: async () => false } as SecureVault;
    const router = new CapabilityRouter(new ProviderRegistry(noKeyVault));
    router.setPrivacyMode('ask');
    const confirm = vi.fn(async () => false);
    router.setRemoteConfirmationHandler(confirm);
    const notices: string[] = [];
    router.subscribeUploadNotice((notice) => notices.push(notice.capability));
    const sent = vi.fn();
    vi.stubGlobal('fetch', sent);

    const result = await router.resolveImageEdit('openai').inpaint(image, image);

    expect(result.type).toBe('image/png');
    expect(confirm).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
    expect(sent).not.toHaveBeenCalled();
  });

  it('labels an unimplemented external segmentation route as local and makes no upload claim', async () => {
    const registry = new ProviderRegistry(vault);
    registry.saveConfig({ id: 'seg', name: 'Seg service', type: 'openai-compatible',
      baseUrl: 'https://example.test/v1', model: 'seg-model', enabled: true, isDefault: false,
      capabilities: { text: false, vision: false, toolCalling: false, streaming: false,
        imageGeneration: false, segmentation: true, structuredOutput: false } });
    const router = new CapabilityRouter(registry);
    const notices: string[] = [];
    router.subscribeUploadNotice((notice) => notices.push(notice.capability));

    const capability = router.resolveSegmentation('seg');
    await expect(capability.segmentSubject({ data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 } as ImageData)).rejects.toThrow(/unavailable/i);
    const result = await capability.segmentSky({ data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 } as ImageData);

    expect(capability.isLocalFallback).toBe(false);
    expect(result.provider).toBe('heuristic-local');
    expect(result.mask).toHaveLength(16);
    expect(notices).toEqual([]);
  });
});
