// tests/Phase5GenericImageEdit.test.ts
//! Test Suite for GenericImageEditProvider and Ephemeral Payload Processing

import { describe, it, expect } from 'vitest';
import { GenericImageEditProvider } from '../src/ai/providers/GenericImageEditProvider';
import { ProviderConfig } from '../src/ai/types';

describe('Phase 5 — GenericImageEditProvider & Payload Hygiene', () => {
  it('1. falls back to Classical Fill when no remote API key is configured', async () => {
    const config: ProviderConfig = {
      id: 'test-custom-router',
      name: 'Custom Router',
      type: 'openai-compatible',
      baseUrl: 'https://router.example.com/v1',
      model: 'dall-e-3',
      enabled: true,
      isDefault: false,
      imageEditConfig: {
        style: 'openai-edits',
        maxDimension: 1024,
      },
    };

    const provider = new GenericImageEditProvider(config, async () => '');
    const contextBlob = new Blob([new Uint8Array(100)], { type: 'image/png' });
    const maskBlob = new Blob([new Uint8Array(100)], { type: 'image/png' });

    const resultBlob = await provider.inpaint(contextBlob, maskBlob, { prompt: 'Clean test' });
    expect(resultBlob).toBeDefined();
    expect(resultBlob.type).toBe('image/png');
  });

  it('2. operates generativeFill as an abstraction over inpaint', async () => {
    const config: ProviderConfig = {
      id: 'test-generic-rest',
      name: 'Generic REST Inpaint',
      type: 'custom-rest',
      baseUrl: 'https://api.custom.com',
      model: 'flux-inpaint',
      enabled: true,
      isDefault: false,
      imageEditConfig: {
        style: 'generic-rest',
        maxDimension: 512,
      },
    };

    const provider = new GenericImageEditProvider(config, async () => '');
    const contextBlob = new Blob([new Uint8Array(100)], { type: 'image/png' });
    const maskBlob = new Blob([new Uint8Array(100)], { type: 'image/png' });

    const resultBlob = await provider.generativeFill(contextBlob, maskBlob, 'Blue sky with puffy clouds');
    expect(resultBlob).toBeDefined();
    expect(resultBlob.size).toBeGreaterThan(0);
  });
});
