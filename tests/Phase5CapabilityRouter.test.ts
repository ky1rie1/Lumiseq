// tests/Phase5CapabilityRouter.test.ts
//! Test Suite for Phase 5 CapabilityRouter, AI Stack, and Privacy/Cost Guard

import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityRouter } from '../src/ai/capabilities/CapabilityRouter';
import { defaultProviderRegistry } from '../src/ai/providers/ProviderRegistry';

describe('Phase 5 — CapabilityRouter & AI Stack Composition', () => {
  let router: CapabilityRouter;

  beforeEach(() => {
    router = new CapabilityRouter(defaultProviderRegistry);
    router.setPrivacyMode('allow');
  });

  it('1. resolves Agent and Vision capabilities independently', () => {
    const agent = router.resolveAgent();
    expect(agent).toBeDefined();
    expect(typeof agent.chat).toBe('function');

    const vision = router.resolveVision();
    expect(vision).toBeDefined();
    expect(typeof vision?.analyzeImage).toBe('function');
    expect(typeof vision?.locateObject).toBe('function');
  });

  it('2. blocks Vision when PrivacyMode is set to "never"', () => {
    router.setPrivacyMode('never');
    expect(router.getPrivacyMode()).toBe('never');

    expect(() => {
      router.resolveVision();
    }).toThrow(/PRIVACY_RESTRICTION/);

    expect(() => {
      router.resolveImageEdit();
    }).toThrow(/PRIVACY_RESTRICTION/);

    // But Agent text reasoning continues to work
    const agent = router.resolveAgent();
    expect(agent).toBeDefined();
  });

  it('3. requires the real local model and fails explicitly when browser inference is unavailable', async () => {
    router.saveStackConfig({
      agentProviderId: 'openai',
      visionProviderId: 'gemini',
      segmentationProviderId: 'fallback-heuristic',
      imageEditProviderId: 'fallback-classical',
    });

    const seg = router.resolveSegmentation();
    expect(seg).toBeDefined();
    expect(seg.isLocalFallback).toBe(false);

    const dummyData = new Uint8ClampedArray(40 * 40 * 4);
    await expect(seg.segmentSubject({ data: dummyData, width: 40, height: 40 } as any)).rejects.toThrow(/unavailable/i);
    const sky = await seg.segmentSky({ data: dummyData, width: 40, height: 40 } as any);
    expect(sky.provider).toBe('heuristic-local');
    expect(sky.confidence).toBe(0);
  });

  it('4. falls back to Classical Content-Aware Fill when no external Image Edit API is bound', () => {
    router.saveStackConfig({
      agentProviderId: 'openai',
      visionProviderId: 'gemini',
      segmentationProviderId: 'fallback-heuristic',
      imageEditProviderId: 'fallback-classical',
    });

    const edit = router.resolveImageEdit();
    expect(edit).toBeDefined();
    expect(edit.isLocalFallback).toBe(true);
  });

  it('5. emits upload notifications when transmitting image data', async () => {
    let notifiedEvent: any = null;
    const unsub = router.subscribeUploadNotice((ev) => {
      notifiedEvent = ev;
    });

    router.notifyRemoteUpload('gemini', 'Google Gemini', 'vision', 'Uploading 1024x768 preview');
    expect(notifiedEvent).toBeDefined();
    expect(notifiedEvent.providerId).toBe('gemini');
    expect(notifiedEvent.capability).toBe('vision');
    expect(notifiedEvent.detail).toContain('1024x768');

    unsub();
  });
});
