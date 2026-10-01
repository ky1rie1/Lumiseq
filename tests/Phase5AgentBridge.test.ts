// tests/Phase5AgentBridge.test.ts
//! Test Suite for Phase 5 AgentBridge (HTTP Server Lifecycle, Token Auth, JSON-RPC 2.0 Dispatch)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentBridge } from '../src/ai/mcp/AgentBridge';
import { StudioMCPServer } from '../src/ai/mcp/StudioMCPServer';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultCommandBus } from '../src/history/CommandBus';
import { DevelopDocument } from '../src/types/develop';

describe('Phase 5 — AgentBridge & Local HTTP Dispatch', () => {
  let bridge: AgentBridge;
  let server: StudioMCPServer;

  beforeEach(() => {
    defaultCommandBus.clear();
    defaultDocumentManager.closeAll();
    server = new StudioMCPServer();
    server.setPermissionLevel('full');
    bridge = new AgentBridge(server);
    bridge.setPermissionMode('full');
  });

  afterEach(async () => {
    await bridge.stopServer();
  });

  it('1. manages auth token generation and verification', () => {
    const token = bridge.getConfig().authToken;
    expect(token).toMatch(/^mcp_live_/);

    expect(bridge.verifyToken(`Bearer ${token}`)).toBe(true);
    expect(bridge.verifyToken('Bearer invalid_token')).toBe(false);
    expect(bridge.verifyToken('')).toBe(false);

    const newToken = bridge.regenerateToken();
    expect(newToken).not.toBe(token);
    expect(bridge.verifyToken(`Bearer ${newToken}`)).toBe(true);
  });

  it('2. starts and stops local HTTP server on 127.0.0.1:18280', async () => {
    const testPort = 18285; // Use dedicated test port
    await bridge.startServer(testPort);
    const status = bridge.getStatus();

    expect(status.running).toBe(true);
    expect(status.port).toBe(testPort);
    expect(status.bindAddress).toBe('127.0.0.1');
    expect(status.endpoint).toBe(`http://127.0.0.1:${testPort}/mcp`);

    await bridge.stopServer();
    expect(bridge.getStatus().running).toBe(false);
  });

  it('3. handles JSON-RPC 2.0 initialize and tools/list requests', async () => {
    // initialize
    const initRes = await bridge.handleJsonRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    expect(initRes.id).toBe(1);
    expect(initRes.result.serverInfo.name).toBe('ai-creative-studio');

    // tools/list
    const listRes = await bridge.handleJsonRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    expect(listRes.id).toBe(2);
    expect(listRes.result.tools).toBeDefined();
    expect(listRes.result.tools.length).toBeGreaterThan(15);
  });

  it('4. executes tools/call via JSON-RPC, updates Document, and logs action', async () => {
    const devDoc: DevelopDocument = {
      id: 'doc_bridge_test',
      kind: 'develop',
      isRaw: true,
      sourceAssetId: 'asset_bridge_raw',
      fileName: 'bridge_photo.nef',
      fileSize: 30000000,
      width: 6000,
      height: 4000,
      settings: { exposure: 0.0 } as any,
      isDirty: false,
      historyIndex: 0,
      updatedAt: Date.now(),
    };
    defaultDocumentManager.openDocument(devDoc);

    const callRes = await bridge.handleJsonRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'studio_set_exposure',
        arguments: { value: 0.8 },
      },
    });

    expect(callRes.id).toBe(3);
    expect(callRes.result.isError).toBeFalsy();

    const updated = defaultDocumentManager.getDevelopDocument('doc_bridge_test')!;
    expect(updated.settings.exposure).toBe(0.8);

    // Action logging
    const actions = bridge.getRecentActions();
    expect(actions.length).toBe(1);
    expect(actions[0].toolName).toBe('studio_set_exposure');
    expect(actions[0].status).toBe('success');
  });

  it('5. exports Claude Desktop and Cursor client configurations', () => {
    const claudeJson = bridge.getClaudeDesktopConfig();
    expect(claudeJson).toContain('ai-creative-studio');
    expect(claudeJson).toContain('STUDIO_MCP_ENDPOINT');
    expect(claudeJson).toContain('STUDIO_AUTH_TOKEN');

    const cursorJson = bridge.getCursorConfig();
    expect(cursorJson).toContain('streamable-http');
    expect(cursorJson).toContain('Bearer');
  });
});
