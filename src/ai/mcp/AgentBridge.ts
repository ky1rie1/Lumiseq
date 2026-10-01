// src/ai/mcp/AgentBridge.ts
//! AI Creative Studio - External Agent Bridge & Server Lifecycle Manager (Phase 5)
//! Manages Local MCP Server, Token Authentication, Permissions, and External Agent Connectivity.

import { ExternalAgentConfig, PermissionLevel } from '../types';
import { StudioMCPServer, defaultStudioMCPServer } from './StudioMCPServer';
import { APP_VERSION } from '../../core/brand';
import { ExternalAgentStorageConfig, generateMCPToken, isValidMCPToken, loadMCPConfig, saveMCPConfig } from './MCPConfig';

export interface ExternalAgentServerStatus {
  running: boolean;
  port: number;
  bindAddress: string;
  transport: 'stdio' | 'streamable-http';
  endpoint: string;
  permissionMode: PermissionLevel;
  connectedClients: number;
  lastRequestTime?: number;
}

export interface ExternalAgentActionRecord {
  id: string;
  toolName: string;
  args: Record<string, any>;
  timestamp: number;
  status: 'success' | 'failed';
}

export class AgentBridge {
  private config: ExternalAgentConfig;
  private status: ExternalAgentServerStatus;
  private recentActions: ExternalAgentActionRecord[] = [];

  constructor(
    private mcpServer: StudioMCPServer = defaultStudioMCPServer
  ) {
    this.config = this.loadConfig();
    this.status = {
      running: false,
      port: this.config.port,
      bindAddress: this.config.bindAddress || '127.0.0.1',
      transport: this.config.transport || 'streamable-http',
      endpoint: `http://${this.config.bindAddress || '127.0.0.1'}:${this.config.port}/mcp`,
      permissionMode: this.config.permissionMode || 'ask',
      connectedClients: 0,
    };
    this.mcpServer.setPermissionLevel(this.config.permissionMode);
  }

  private loadConfig(): ExternalAgentConfig {
    const saved = loadMCPConfig();
    return {
      enabled: saved.httpEnabled,
      port: saved.fixedPort,
      bindAddress: '127.0.0.1', // Strictly 127.0.0.1 by default
      authToken: saved.authToken,
      permissionMode: saved.permissionMode,
      transport: 'streamable-http',
    };
  }

  private saveConfig(): void {
    const saved = loadMCPConfig();
    saveMCPConfig({ ...saved, httpEnabled: this.config.enabled, fixedPort: this.config.port, authToken: this.config.authToken, permissionMode: this.config.permissionMode });
  }

  generateRandomToken(): string {
    return generateMCPToken();
  }

  /** Apply the authoritative v2 settings without writing a competing legacy configuration. */
  applyConfiguration(config: ExternalAgentStorageConfig, activePort = config.fixedPort): void {
    this.config = { ...this.config, enabled: config.httpEnabled, port: activePort, authToken: config.authToken, permissionMode: config.permissionMode };
    this.mcpServer.setPermissionLevel(config.permissionMode);
  }

  regenerateToken(): string {
    this.config.authToken = this.generateRandomToken();
    this.saveConfig();
    return this.config.authToken;
  }

  getConfig(): ExternalAgentConfig {
    return { ...this.config };
  }

  getStatus(): ExternalAgentServerStatus {
    return {
      ...this.status,
      permissionMode: this.config.permissionMode,
      port: this.config.port,
      endpoint: `http://${this.config.bindAddress}:${this.config.port}/mcp`,
    };
  }

  setPermissionMode(mode: PermissionLevel): void {
    this.config.permissionMode = mode;
    this.mcpServer.setPermissionLevel(mode);
    this.saveConfig();
  }

  getRecentActions(): ExternalAgentActionRecord[] {
    return [...this.recentActions];
  }

  recordAction(toolName: string, args: any, status: 'success' | 'failed'): void {
    this.recentActions.unshift({
      id: `mcp_act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      toolName,
      args,
      timestamp: Date.now(),
      status,
    });
    if (this.recentActions.length > 50) {
      this.recentActions.pop();
    }
    this.status.lastRequestTime = Date.now();
  }

  verifyToken(authHeader?: string | null): boolean {
    if (!isValidMCPToken(this.config.authToken)) return false;
    if (!authHeader) return false;
    const clean = authHeader.replace(/^Bearer\s+/i, '').trim();
    return clean === this.config.authToken;
  }

  /**
   * Start server state (used by tests / headless bridge; native HTTP is managed by MCPServerManager)
   */
  async startServer(port: number = 18280): Promise<void> {
    this.status.running = true;
    this.status.port = port;
    this.status.endpoint = `http://127.0.0.1:${port}/mcp`;
    this.config.port = port;
    this.config.enabled = true;
    this.saveConfig();
  }

  /**
   * Connect to native Tauri MCP backend event channel
   */
  private listenerSetup: Promise<void> | null = null;
  private listenerGeneration = 0;
  private unlisten: (() => void) | null = null;

  initTauriListener(): Promise<void> {
    if (this.listenerSetup) return this.listenerSetup;
    const generation = this.listenerGeneration;
    this.listenerSetup = this.setupTauriListener(generation).catch(error => {
      if (generation === this.listenerGeneration) this.listenerSetup = null;
      throw error;
    });
    return this.listenerSetup;
  }

  disposeTauriListener(): void {
    this.listenerGeneration++;
    this.unlisten?.();
    this.unlisten = null;
    this.listenerSetup = null;
    this.status.running = false;
  }

  private async setupTauriListener(generation: number): Promise<void> {
    // Sync saved permissions before registering a callback that can accept native requests.
    this.applyConfiguration(loadMCPConfig(), this.config.port);
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { invoke } = await import('@tauri-apps/api/core');

        if (generation !== this.listenerGeneration) return;
        const unlisten = await listen<{ id: string; body: string }>('mcp_request', async (event) => {
          if (generation !== this.listenerGeneration) return;
          const reqId = event.payload.id;
          try {
            const rpc = JSON.parse(event.payload.body);
            const res = await this.handleJsonRpc(rpc);
            await invoke('mcp_respond', { id: reqId, response: JSON.stringify(res) });
          } catch (err: any) {
            await invoke('mcp_respond', {
              id: reqId,
              response: JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32603, message: err?.message || 'Internal error' },
              }),
            });
          }
        });

        if (generation !== this.listenerGeneration) { unlisten(); return; }
        this.unlisten = unlisten;
        this.status.running = true;
        this.status.port = this.config.port || 18280;
        this.status.endpoint = `http://127.0.0.1:${this.status.port}/mcp`;
      } catch (err) {
        throw err;
      }
    }
  }

  /**
   * Stop server state
   */
  async stopServer(): Promise<void> {
    this.status.running = false;
    this.config.enabled = false;
    this.saveConfig();
  }

  /**
   * Internal JSON-RPC 2.0 dispatch
   */
  async handleJsonRpc(rpc: any): Promise<any> {
    const id = rpc.id ?? null;

    if (rpc.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
          },
          serverInfo: {
            name: 'ai-creative-studio',
            version: APP_VERSION,
          },
        },
      };
    }

    if (rpc.method === 'tools/list') {
      const res = await this.mcpServer.dispatch({ method: 'tools/list', params: {} });
      return {
        jsonrpc: '2.0',
        id,
        result: res || { tools: [] },
      };
    }

    if (rpc.method === 'tools/call') {
      const res = await this.mcpServer.dispatch({
        method: 'tools/call',
        params: rpc.params,
      });

      this.recordAction(
        rpc.params?.name || 'unknown',
        rpc.params?.arguments || {},
        res?.isError ? 'failed' : 'success'
      );

      return {
        jsonrpc: '2.0',
        id,
        result: res,
      };
    }

    if (rpc.method === 'resources/list' || rpc.method === 'resources/read') {
      return { jsonrpc: '2.0', id, result: await this.mcpServer.dispatch({ method: rpc.method, params: rpc.params || {} }) };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method '${rpc.method}' not implemented`,
      },
    };
  }

  /**
   * Generate Claude Desktop configuration snippet (claude_desktop_config.json)
   */
  getClaudeDesktopConfig(): string {
    const snippet = {
      mcpServers: {
        'ai-creative-studio': {
          command: 'node',
          args: ['./bin/studio-mcp.js'],
          env: {
            STUDIO_MCP_ENDPOINT: `http://127.0.0.1:${this.config.port}/mcp`,
            STUDIO_AUTH_TOKEN: this.config.authToken,
          },
        },
      },
    };
    return JSON.stringify(snippet, null, 2);
  }

  /**
   * Generate Cursor IDE MCP configuration snippet
   */
  getCursorConfig(): string {
    const snippet = {
      name: 'ai-creative-studio',
      type: 'streamable-http',
      url: `http://127.0.0.1:${this.config.port}/mcp`,
      headers: {
        Authorization: `Bearer ${this.config.authToken}`,
      },
    };
    return JSON.stringify(snippet, null, 2);
  }
}

export const defaultAgentBridge = new AgentBridge(defaultStudioMCPServer);
