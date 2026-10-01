import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../src/ai/permissions/PermissionGuard';
import { StudioMCPServer } from '../src/ai/mcp/StudioMCPServer';
import { AgentBridge } from '../src/ai/mcp/AgentBridge';
import { MCPServerManager } from '../src/ai/mcp/MCPServerManager';
import { ToolRegistry } from '../src/ai/tools/ToolRegistry';
import { CanonicalTool } from '../src/ai/tools/CanonicalTool';
import { CanonicalToolSchema, ToolRiskLevel } from '../src/ai/types';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultCommandBus } from '../src/history/CommandBus';

class CountTool extends CanonicalTool {
  executions = 0;
  readonly schema: CanonicalToolSchema;
  constructor(riskLevel: ToolRiskLevel) {
    super();
    this.schema = { name: `security_${riskLevel}`, description: 'Permission fixture', workspace: 'any', category: 'system', riskLevel, parameters: { type: 'object', properties: {}, required: [] } };
  }
  async execute() { this.executions++; return { success: true, data: { executions: this.executions } }; }
}

function memoryStorage(config?: Record<string, unknown>, legacy?: Record<string, unknown>) {
  const values = new Map<string, string>();
  if (config) values.set('ai_studio_external_agents_v2', JSON.stringify(config));
  if (legacy) values.set('ai_studio_external_agents', JSON.stringify(legacy));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const settings = { httpEnabled: false, portMode: 'fixed', fixedPort: 19380, permissionMode: 'readonly', authToken: 'private-user-token' };
const request = (name: string) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: `studio_${name}`, arguments: {} } });
function fixture() {
  const guard = new PermissionGuard();
  const registry = new ToolRegistry();
  const normal = new CountTool('normal'), dangerous = new CountTool('dangerous'), safe = new CountTool('safe');
  [normal, dangerous, safe].forEach(tool => registry.register(tool));
  const server = new StudioMCPServer(registry, guard);
  const bridge = new AgentBridge(server);
  return { guard, server, bridge, normal, dangerous, safe };
}

beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); defaultDocumentManager.closeAll(); defaultCommandBus.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('independent internal and external permission policy', () => {
  it('server ask uses its own level and shared prompt callback', async () => {
    const guard = new PermissionGuard(); let prompts = 0;
    guard.setLevel('auto'); guard.setConfirmationHandler(async () => { prompts++; return false; });
    const registry = new ToolRegistry(), normal = new CountTool('normal'); registry.register(normal);
    const server = new StudioMCPServer(registry, guard, undefined, undefined, undefined, { permissionLevel: 'ask' });
    const handler = (server.getServer() as any)._requestHandlers.get('tools/call');
    const result = await handler(request(normal.schema.name));
    expect(prompts).toBe(1); expect(result.isError).toBe(true); expect(normal.executions).toBe(0);
  });
  it('server full cannot bypass dangerous confirmation', async () => {
    const guard = new PermissionGuard(); let prompts = 0;
    guard.setConfirmationHandler(async () => { prompts++; return false; });
    const registry = new ToolRegistry(), dangerous = new CountTool('dangerous'); registry.register(dangerous);
    const server = new StudioMCPServer(registry, guard, undefined, undefined, undefined, { permissionLevel: 'full' });
    const result = await (server.getServer() as any)._requestHandlers.get('tools/call')(request(dangerous.schema.name));
    expect(prompts).toBe(1); expect(result.isError).toBe(true); expect(dangerous.executions).toBe(0);
  });
  it('internal readonly denies normal mutations without prompting', async () => {
    const guard = new PermissionGuard(); const tool = new CountTool('normal'); let prompts = 0;
    guard.setLevel('readonly'); guard.setConfirmationHandler(async () => { prompts++; return true; });
    expect(await guard.checkPermission(tool, {})).toBe(false);
    expect(prompts).toBe(0);
  });
  it('external ask prompts for a normal mutation even while internal mode is auto', async () => {
    const { guard, bridge, normal } = fixture(); let prompts = 0;
    guard.setLevel('auto'); guard.setConfirmationHandler(async () => { prompts++; return false; });
    bridge.setPermissionMode('ask');
    const result = await bridge.handleJsonRpc(request(normal.schema.name));
    expect(prompts).toBe(1); expect(result.result.isError).toBe(true); expect(normal.executions).toBe(0);
    expect(guard.getLevel()).toBe('auto');
  });
  it.each(['auto', 'full'] as const)('external %s still asks before dangerous actions', async mode => {
    const { guard, bridge, dangerous } = fixture(); let prompts = 0;
    guard.setConfirmationHandler(async () => { prompts++; return false; }); bridge.setPermissionMode(mode);
    const result = await bridge.handleJsonRpc(request(dangerous.schema.name));
    expect(prompts).toBe(1); expect(result.result.isError).toBe(true); expect(dangerous.executions).toBe(0);
  });
  it('persisted readonly applies to the injected server before its first request', async () => {
    vi.stubGlobal('localStorage', memoryStorage(settings));
    const { bridge, normal, safe } = fixture();
    const mutation = await bridge.handleJsonRpc(request(normal.schema.name));
    const inspection = await bridge.handleJsonRpc(request(safe.schema.name));
    expect(mutation.result?.isError).toBe(true); expect(normal.executions).toBe(0);
    expect(inspection.result?.isError).toBeFalsy(); expect(safe.executions).toBe(1);
  });
});

describe('MCP configuration and client authentication', () => {
  it('first startup creates a private token and persists it for both lifecycle owners', () => {
    const bridge = new AgentBridge();
    const manager = new (MCPServerManager as any)(bridge) as MCPServerManager;
    const token = manager.getAuthToken();
    expect(token).not.toBe('mcp_live_studio_token'); expect(token.length).toBeGreaterThanOrEqual(40);
    expect(bridge.getConfig().authToken).toBe(token);
    expect(JSON.parse(localStorage.getItem('ai_studio_external_agents_v2')!).authToken).toBe(token);
    expect(manager.getStatus().httpEnabled).toBe(false);
  });
  it.each(['', 'mcp_live_studio_token'])('migrates unsafe saved token %j using secure randomness', token => {
    vi.stubGlobal('localStorage', memoryStorage({ ...settings, authToken: token }));
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('insecure random'); });
    const bridge = new AgentBridge();
    expect(bridge.getConfig().authToken).not.toBe(token);
    expect(bridge.verifyToken(`Bearer ${token}`)).toBe(false);
    expect(bridge.regenerateToken().length).toBeGreaterThanOrEqual(40);
  });
  it('validates corrupt v2 settings and constrains endpoint to loopback', () => {
    vi.stubGlobal('localStorage', memoryStorage({ httpEnabled: 'true', portMode: 'bad', fixedPort: -1, permissionMode: 'invalid', authToken: null, bindAddress: '0.0.0.0' }));
    const bridge = new AgentBridge(); const manager = new (MCPServerManager as any)(bridge) as MCPServerManager;
    expect(manager.getStatus()).toMatchObject({ httpEnabled: false, portMode: 'auto', port: 18280, bindAddress: '127.0.0.1', permissionMode: 'ask' });
    expect(bridge.verifyToken(null)).toBe(false);
  });
  it('migrates legacy settings once without enabling HTTP or retaining the public token', () => {
    vi.stubGlobal('localStorage', memoryStorage(undefined, { enabled: true, port: 19400, permissionMode: 'readonly', authToken: 'mcp_live_studio_token' }));
    const bridge = new AgentBridge(); const manager = new (MCPServerManager as any)(bridge) as MCPServerManager;
    expect(manager.getStatus()).toMatchObject({ httpEnabled: false, permissionMode: 'readonly', port: 19400 });
    expect(manager.getAuthToken()).not.toBe('mcp_live_studio_token');
    expect(bridge.getConfig().authToken).toBe(manager.getAuthToken());
  });
  it('exports the actual active endpoint and the same rotated token for stdio and HTTP', async () => {
    const bridge = new AgentBridge(); const manager = new (MCPServerManager as any)(bridge) as MCPServerManager;
    await manager.startHttp({ portMode: 'fixed', fixedPort: 19401 });
    const token = manager.regenerateToken();
    const stdio = JSON.parse(manager.getClaudeDesktopConfig()).mcpServers['ai-creative-studio'];
    expect(stdio.env.STUDIO_MCP_ENDPOINT).toBe('http://127.0.0.1:19401/mcp');
    expect(JSON.parse(bridge.getCursorConfig()).url).toBe('http://127.0.0.1:19401/mcp');
    expect(bridge.verifyToken(`Bearer ${token}`)).toBe(true);
  });
});
