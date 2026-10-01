// src/ai/providers/ProviderRegistry.ts
import { ProviderConfig } from '../types';
import { IAIProvider } from './IAIProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { ClaudeProvider } from './ClaudeProvider';
import { GeminiProvider } from './GeminiProvider';
import { LocalProvider } from './LocalProvider';
import { GenericImageEditProvider } from './GenericImageEditProvider';
import { LocalAgentProvider, nativeLocalAgentRunner } from './LocalAgentProvider';
import { SecureVault, defaultSecureVault } from '../security/SecureVault';
import { validateProviderSettings } from './providerConfigValidation';

export interface ProviderReadiness {
  status: 'checking' | 'unconfigured' | 'configured' | 'available' | 'unavailable' | 'disabled' | 'error';
  canSend: boolean;
  label: string;
  detail: string;
}

const DEFAULT_CONFIGS: ProviderConfig[] = [
  {
    id: 'codex-desktop', name: 'Codex · 本机客户端', type: 'agent-cli', localAgent: 'codex',
    baseUrl: '', model: 'default', enabled: true, isDefault: false, timeoutMs: 120000,
  },
  {
    id: 'claude-desktop', name: 'Claude Code · 本机客户端', type: 'agent-cli', localAgent: 'claude',
    baseUrl: '', model: 'default', enabled: true, isDefault: false, timeoutMs: 120000,
  },
  {
    id: 'antigravity-desktop', name: 'Antigravity · 本机客户端', type: 'agent-cli', localAgent: 'antigravity',
    baseUrl: '', model: 'default', enabled: true, isDefault: false, timeoutMs: 120000,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    visionModel: 'gpt-4o',
    enabled: true,
    isDefault: true,
    timeoutMs: 45000,
    maxRetries: 2,
    imageEditConfig: { style: 'openai-edits', imageEditModel: 'gpt-image-2', maxDimension: 1024 },
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5',
    visionModel: 'claude-sonnet-5',
    enabled: true,
    isDefault: false,
    timeoutMs: 45000,
    maxRetries: 2,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.8-flash',
    visionModel: 'gemini-3.8-flash',
    enabled: true,
    isDefault: false,
    timeoutMs: 45000,
    maxRetries: 2,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    enabled: true,
    isDefault: false,
    timeoutMs: 45000,
    maxRetries: 2,
  },
  {
    id: 'qwen',
    name: '通义千问 · 百炼',
    type: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    enabled: true,
    isDefault: false,
    timeoutMs: 45000,
    maxRetries: 2,
  },
  {
    id: 'local-ollama',
    name: 'Ollama (Local)',
    type: 'local',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    visionModel: 'llava',
    enabled: false,
    isDefault: false,
    timeoutMs: 60000,
    maxRetries: 1,
  },
];

export class ProviderRegistry {
  private configs: Map<string, ProviderConfig> = new Map();
  private instances: Map<string, IAIProvider> = new Map();
  private activeProviderId: string = 'openai';
  private listeners = new Set<() => void>();

  constructor(private vault: SecureVault = defaultSecureVault) {
    this.loadConfigs();
  }

  private loadConfigs(): void {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('ai_studio_providers');
      if (saved) {
        try {
          const parsed: ProviderConfig[] = JSON.parse(saved);
          if (!Array.isArray(parsed)) throw new Error('Invalid provider configuration');
          parsed.forEach((cfg) => this.configs.set(cfg.id, cfg));
          // New built-in services remain discoverable after app updates. Never overwrite user edits.
          DEFAULT_CONFIGS.forEach((cfg) => {
            if (!this.configs.has(cfg.id)) this.configs.set(cfg.id, { ...cfg });
          });
        } catch {
          DEFAULT_CONFIGS.forEach((cfg) => this.configs.set(cfg.id, { ...cfg }));
        }
      } else {
        DEFAULT_CONFIGS.forEach((cfg) => this.configs.set(cfg.id, { ...cfg }));
      }

      const savedActive = localStorage.getItem('ai_studio_active_provider');
      if (savedActive && this.configs.has(savedActive)) {
        this.activeProviderId = savedActive;
      } else {
        const def = Array.from(this.configs.values()).find((c) => c.isDefault) || this.configs.values().next().value;
        if (def) {
          this.activeProviderId = def.id;
        }
      }
    } else {
      DEFAULT_CONFIGS.forEach((cfg) => this.configs.set(cfg.id, { ...cfg }));
      this.activeProviderId = 'openai';
    }
  }

  private persistConfigs(configs = this.configs, activeProviderId = this.activeProviderId): void {
    if (typeof localStorage !== 'undefined') {
      const arr = Array.from(configs.values());
      localStorage.setItem('ai_studio_providers', JSON.stringify(arr));
      localStorage.setItem('ai_studio_active_provider', activeProviderId);
    }
  }

  getAllConfigs(): ProviderConfig[] {
    return Array.from(this.configs.values());
  }

  /** Subscribe to configuration and active-provider changes. Returns an unsubscribe callback. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyChange(): void {
    this.listeners.forEach((listener) => listener());
  }

  getConfig(id: string): ProviderConfig | undefined {
    return this.configs.get(id);
  }

  getActiveConfig(): ProviderConfig {
    const cfg = this.configs.get(this.activeProviderId);
    if (!cfg) {
      const first = this.configs.values().next().value;
      if (first) return first;
      return DEFAULT_CONFIGS[0];
    }
    return cfg;
  }

  setActiveProvider(id: string): void {
    if (!this.configs.has(id)) {
      throw new Error(`Provider id '${id}' not found`);
    }
    this.persistConfigs(this.configs, id);
    this.activeProviderId = id;
    this.notifyChange();
  }

  saveConfig(config: ProviderConfig): void {
    const next = new Map(this.configs);
    next.set(config.id, config);
    this.persistConfigs(next);
    this.configs = next;
    this.instances.delete(config.id); // Invalidate cached instance
    this.notifyChange();
  }

  deleteConfig(id: string): void {
    if (this.configs.size <= 1) {
      throw new Error('Cannot delete the only remaining provider');
    }
    const next = new Map(this.configs);
    next.delete(id);
    const nextActive = this.activeProviderId === id ? next.keys().next().value! : this.activeProviderId;
    this.persistConfigs(next, nextActive);
    this.configs = next;
    this.activeProviderId = nextActive;
    this.instances.delete(id);
    this.notifyChange();
  }

  getProvider(id?: string): IAIProvider {
    const targetId = id || this.activeProviderId;
    let instance = this.instances.get(targetId);
    if (instance) return instance;

    const config = this.configs.get(targetId);
    if (!config) {
      throw new Error(`Provider config for '${targetId}' not found`);
    }

    instance = this.createProviderInstance(config);
    this.instances.set(targetId, instance);
    return instance;
  }

  getProviderForModel(id: string, model: string): IAIProvider {
    const config = this.configs.get(id);
    if (!config) throw new Error(`Provider config for '${id}' not found`);
    return this.createProviderInstance({ ...config, model });
  }

  getImageEditProvider(id: string): GenericImageEditProvider {
    const config = this.configs.get(id);
    if (!config) throw new Error(`Provider config for '${id}' not found`);
    return new GenericImageEditProvider(config, async () => (await this.vault.getProviderSecret(id)) || '');
  }

  private createProviderInstance(config: ProviderConfig): IAIProvider {
    switch (config.type) {
      case 'openai':
      case 'openai-compatible':
        return new OpenAIProvider(config, this.vault);
      case 'anthropic':
        return new ClaudeProvider(config, this.vault);
      case 'gemini':
        return new GeminiProvider(config, this.vault);
      case 'local':
        return new LocalProvider(config, this.vault);
      case 'agent-cli':
        return new LocalAgentProvider(config);
      default:
        throw new Error(`Unsupported provider protocol: ${config.type}`);
    }
  }

  /**
   * Set API key in DPAPI vault for the specified provider.
   */
  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.vault.setProviderSecret(providerId, apiKey);
    this.notifyChange();
  }

  /** Checks configuration and CLI availability, never authentication or a model request. */
  async getReadiness(id = this.activeProviderId): Promise<ProviderReadiness> {
    const config = this.configs.get(id);
    const disconnected = { canSend: false, label: '未连接 AI' };
    if (!config) return { ...disconnected, status: 'unconfigured', detail: '请选择模型服务或本机 Agent。' };
    if (!config.enabled) return { ...disconnected, status: 'disabled', detail: '当前 AI 服务已停用。' };
    try {
      const invalid = validateProviderSettings(config);
      if (invalid) return { ...disconnected, status: 'unconfigured', detail: invalid };
      if (config.type === 'agent-cli') {
        const probe = await nativeLocalAgentRunner.probe(config.localAgent!);
        if (!probe.available) return { ...disconnected, status: 'unavailable', detail: probe.detail || '本机 Agent 不可用。' };
        return { status: 'available', canSend: true, label: `${config.name} · 客户端默认模型`, detail: '已检测到本机 Agent；模型与登录状态由客户端管理。' };
      }
      if (config.type !== 'local' && !(await this.hasApiKey(config.id))) {
        return { ...disconnected, status: 'unconfigured', detail: '尚未配置 API 密钥。' };
      }
      return { status: 'configured', canSend: true, label: `${config.name} · ${config.model}`, detail: '已配置；服务连通性尚未验证。' };
    } catch {
      return { ...disconnected, status: 'error', detail: '无法检查 AI 连接配置，请重试。' };
    }
  }

  /**
   * Check if provider has an API key stored.
   */
  async hasApiKey(providerId: string): Promise<boolean> {
    return this.vault.hasProviderSecret(providerId);
  }
}

export const defaultProviderRegistry = new ProviderRegistry();
