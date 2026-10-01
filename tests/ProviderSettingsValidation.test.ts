import { describe, expect, it } from 'vitest';
import { validateProviderSettings } from '../src/ui/ai/providerSettingsValidation';
import type { ProviderConfig } from '../src/ai/types';

const config: ProviderConfig = {
  id: 'custom', name: 'Custom', type: 'openai-compatible',
  baseUrl: 'https://example.test/v1', model: 'model-id',
  enabled: true, isDefault: false,
};

describe('provider settings validation', () => {
  it('requires a model and a service name before saving', () => {
    expect(validateProviderSettings({ ...config, model: ' ' })).toMatch(/模型/);
    expect(validateProviderSettings({ ...config, name: ' ' })).toMatch(/名称/);
  });

  it('requires HTTPS for remote services while allowing local Ollama', () => {
    expect(validateProviderSettings({ ...config, baseUrl: 'http://example.test/v1' })).toMatch(/HTTPS/);
    expect(validateProviderSettings({ ...config, baseUrl: 'http://localhost:11434/v1' })).toBeNull();
    expect(validateProviderSettings({ ...config, baseUrl: 'http://127.0.0.1:11434/v1' })).toBeNull();
  });

  it('rejects unsupported protocol types and full endpoint URLs', () => {
    expect(validateProviderSettings({ ...config, type: 'custom-rest' })).toMatch(/协议/);
    expect(validateProviderSettings({ ...config, baseUrl: 'https://example.test/v1/chat/completions' })).toMatch(/基础地址/);
  });
});
