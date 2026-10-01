// src/ai/mcp/MCPServerManager.ts
//! Unified Model Context Protocol (MCP) Server Lifecycle Manager (Phase 6.1)
//! Manages stdio and Streamable HTTP transports.
//! HTTP Server is OFF by default. No TCP ports are opened unless explicitly enabled.
//! Enforces: UI -> MCPServerManager -> Native Rust HTTP Server / AgentBridge -> Canonical Tools -> CommandBus.

import { PermissionLevel } from '../types';
import { defaultAgentBridge, AgentBridge } from './AgentBridge';
import { ExternalAgentStorageConfig, loadMCPConfig, saveMCPConfig } from './MCPConfig';
export type { ExternalAgentStorageConfig } from './MCPConfig';

export type MCPServerLifecycleState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface MCPServerManagerStatus {
  state: MCPServerLifecycleState;
  httpEnabled: boolean;
  portMode: 'auto' | 'fixed';
  port: number;
  bindAddress: string;
  endpoint: string;
  permissionMode: PermissionLevel;
  connectedClients: number;
  lastError?: string;
}

export class MCPServerManager {
  private static instance: MCPServerManager;
  private state: MCPServerLifecycleState = 'stopped';
  private config: ExternalAgentStorageConfig;
  private activePort: number = 18280;
  private activeBindAddress: string = '127.0.0.1';
  private lastError?: string;
  private listeners: Set<() => void> = new Set();

  private constructor(private agentBridge: AgentBridge = defaultAgentBridge) {
    this.config = this.loadConfig();
    this.activePort = this.config.fixedPort || 18280;
    this.agentBridge.applyConfiguration(this.config, this.activePort);
  }

  static getInstance(): MCPServerManager {
    if (!MCPServerManager.instance) {
      MCPServerManager.instance = new MCPServerManager();
    }
    return MCPServerManager.instance;
  }

  private loadConfig(): ExternalAgentStorageConfig {
    return loadMCPConfig();
  }

  private saveConfig(): void {
    saveMCPConfig(this.config);
    this.agentBridge.applyConfiguration(this.config, this.activePort);
  }

  /**
   * Called during application bootstrap in App.tsx.
   * Only starts HTTP server if explicitly enabled in persisted settings.
   */
  async initOnAppStart(): Promise<void> {
    this.agentBridge.applyConfiguration(this.config, this.activePort);
    if (this.config.httpEnabled) {
      console.log('[MCPServerManager] Starting MCP HTTP server based on user configuration...');
      await this.startHttp({
        portMode: this.config.portMode,
        fixedPort: this.config.fixedPort,
      });
    } else {
      console.log('[MCPServerManager] MCP HTTP Server is OFF by default. stdio is available without TCP ports.');
      this.state = 'stopped';
      this.notify();
    }
  }

  getStatus(): MCPServerManagerStatus {
    return {
      state: this.state,
      httpEnabled: this.config.httpEnabled,
      portMode: this.config.portMode,
      port: this.activePort,
      bindAddress: this.activeBindAddress,
      endpoint: `http://${this.activeBindAddress}:${this.activePort}/mcp`,
      permissionMode: this.config.permissionMode,
      connectedClients: 0,
      lastError: this.lastError,
    };
  }

  isRunning(): boolean {
    return this.state === 'running';
  }

  getEndpoint(): string | null {
    if (this.state !== 'running') return null;
    return `http://${this.activeBindAddress}:${this.activePort}/mcp`;
  }

  getPermissionMode(): PermissionLevel {
    return this.config.permissionMode;
  }

  getSettings(): Pick<ExternalAgentStorageConfig, 'portMode' | 'fixedPort' | 'permissionMode'> {
    const { portMode, fixedPort, permissionMode } = this.config;
    return { portMode, fixedPort, permissionMode };
  }

  /** Persist preferences independently of the explicit listener start/stop action. */
  saveSettings(settings: ReturnType<MCPServerManager['getSettings']>): void {
    if (!['auto', 'fixed'].includes(settings.portMode) || !['ask', 'readonly', 'auto', 'full'].includes(settings.permissionMode)) throw new Error('外部工具设置无效。');
    if (!Number.isInteger(settings.fixedPort) || settings.fixedPort < 1024 || settings.fixedPort > 65535) throw new Error('请输入 1024–65535 之间的整数端口。');
    if (this.state !== 'stopped' && this.state !== 'error' && (settings.portMode !== this.config.portMode || settings.fixedPort !== this.config.fixedPort)) throw new Error('修改端口前，请先关闭 HTTP 服务。');
    const next = { ...this.config, ...settings };
    saveMCPConfig(next);
    this.config = next;
    if (this.state === 'stopped' || this.state === 'error') this.activePort = settings.portMode === 'fixed' ? settings.fixedPort : 18280;
    this.agentBridge.applyConfiguration(this.config, this.activePort);
    this.notify();
  }

  setPermissionMode(mode: PermissionLevel): void {
    this.saveSettings({ ...this.getSettings(), permissionMode: mode });
  }

  getAuthToken(): string {
    return this.config.authToken;
  }

  regenerateToken(): string {
    const newToken = this.agentBridge.generateRandomToken();
    this.config.authToken = newToken;
    this.saveConfig();

    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('set_mcp_auth_token', { token: newToken }).catch((err) => {
          console.warn('[MCPServerManager] Failed to update token in native backend:', err);
        });
      });
    }

    this.notify();
    return newToken;
  }

  /**
   * Start Streamable HTTP Server.
   * Binds strictly to 127.0.0.1. Never binds to 0.0.0.0.
   */
  async startHttp(options?: {
    portMode?: 'auto' | 'fixed';
    fixedPort?: number;
  }): Promise<{ success: boolean; port?: number; error?: string }> {
    if (this.state === 'running') {
      return { success: true, port: this.activePort };
    }

    this.state = 'starting';
    this.lastError = undefined;
    this.notify();

    const portMode = options?.portMode || this.config.portMode || 'auto';
    const port = portMode === 'fixed' ? (options?.fixedPort || this.config.fixedPort || 18280) : 18280;

    this.config.portMode = portMode;
    if (options?.fixedPort) {
      this.config.fixedPort = options.fixedPort;
    }

    try {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');

        this.agentBridge.applyConfiguration(this.config, this.activePort);
        await this.agentBridge.initTauriListener();
        // Set token first
        await invoke('set_mcp_auth_token', { token: this.config.authToken });

        // Invoke native Rust HTTP listener
        const statusDto: any = await invoke('start_mcp_http_server', {
          port,
          portMode,
          bindAddress: '127.0.0.1',
        });

        this.activePort = statusDto.port;
        this.activeBindAddress = statusDto.bind_address;
        this.state = 'running';
        this.config.httpEnabled = true;
        this.saveConfig();
        this.notify();
        return { success: true, port: this.activePort };
      } else {
        // Headless / Test environment: simulate successful start without opening port
        this.activePort = port;
        this.activeBindAddress = '127.0.0.1';
        this.state = 'running';
        this.config.httpEnabled = true;
        this.saveConfig();
        this.notify();
        return { success: true, port: this.activePort };
      }
    } catch (err: any) {
      this.state = 'error';
      this.lastError = err?.message || String(err);
      this.notify();
      return { success: false, error: this.lastError };
    }
  }

  /**
   * Stop Streamable HTTP Server and immediately release socket.
   */
  async stopHttp(): Promise<void> {
    if (this.state === 'stopped') return;

    this.state = 'stopping';
    this.notify();

    try {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('stop_mcp_http_server');
      }
    } catch (err) {
      console.warn('[MCPServerManager] Error stopping native HTTP server:', err);
    } finally {
      this.state = 'stopped';
      this.config.httpEnabled = false;
      this.lastError = undefined;
      this.saveConfig();
      this.notify();
    }
  }

  async restartHttp(): Promise<void> {
    await this.stopHttp();
    await this.startHttp({ portMode: this.config.portMode, fixedPort: this.config.fixedPort });
  }

  /**
   * Generate Claude Desktop / Cursor stdio configuration snippet
   */
  getClaudeDesktopConfig(): string {
    const snippet = {
      mcpServers: {
        'ai-creative-studio': {
          command: 'node',
          args: ['./bin/studio-mcp.js'],
          env: {
            STUDIO_MCP_ENDPOINT: `http://${this.activeBindAddress}:${this.activePort}/mcp`,
            STUDIO_AUTH_TOKEN: this.config.authToken,
          },
        },
      },
    };
    return JSON.stringify(snippet, null, 2);
  }

  /**
   * Generate Cursor IDE Streamable HTTP configuration snippet
   */
  getCursorConfig(): string {
    const snippet = {
      name: 'ai-creative-studio',
      type: 'streamable-http',
      url: `http://${this.activeBindAddress}:${this.activePort}/mcp`,
      headers: {
        Authorization: `Bearer ${this.config.authToken}`,
      },
    };
    return JSON.stringify(snippet, null, 2);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[MCPServerManager] Listener error:', err);
      }
    }
  }
}

export const defaultMCPServerManager = MCPServerManager.getInstance();
