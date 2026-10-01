import { afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ callback: null as null | ((event: any) => Promise<void>), token: '', replies: [] as any[], order: [] as string[] }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (_event: string, callback: any) => { native.callback = callback; native.order.push('listen'); return () => { native.callback = null; }; } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (command: string, args: any) => {
  native.order.push(command);
  if (command === 'set_mcp_auth_token') native.token = args.token;
  if (command === 'mcp_respond') native.replies.push(JSON.parse(args.response));
  if (command === 'start_mcp_http_server') {
    if (!native.token || !native.callback) throw new Error('Native server started without token/listener');
    await native.callback({ payload: { id: 'first-native-call', body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'studio_set_exposure', arguments: { value: 2 } } }) } });
    return { port: 18291, bind_address: '127.0.0.1' };
  }
} }));
import { AgentBridge } from '../src/ai/mcp/AgentBridge';
import { StudioMCPServer } from '../src/ai/mcp/StudioMCPServer';
import { MCPServerManager } from '../src/ai/mcp/MCPServerManager';
import { PermissionGuard } from '../src/ai/permissions/PermissionGuard';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultCommandBus } from '../src/history/CommandBus';
import { createDefaultDevelopSettings } from '../src/document/DevelopDocument';

afterEach(() => { native.callback = null; native.token = ''; native.replies.length = 0; native.order.length = 0; defaultDocumentManager.closeAll(); defaultCommandBus.clear(); vi.unstubAllGlobals(); });

it('startup rejects a native mutation under saved readonly before listener start and retains v2 token', async () => {
  const saved = new Map([
    ['ai_studio_external_agents_v2', JSON.stringify({ httpEnabled: true, portMode: 'auto', fixedPort: 18280, permissionMode: 'readonly', authToken: 'private-startup-token' })],
    ['ai_studio_external_agents', JSON.stringify({ enabled: true, permissionMode: 'full', port: 18280, authToken: 'mcp_live_studio_token' })],
  ]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } });
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  defaultDocumentManager.openDocument({ id: 'startup-raw', kind: 'develop', isRaw: true, sourceAssetId: 'startup-asset', fileName: 'startup.dng', fileSize: 1, width: 8, height: 8, settings: createDefaultDevelopSettings(), isDirty: false, historyIndex: 0, updatedAt: Date.now() });
  const guard = new PermissionGuard(); guard.setLevel('auto');
  const server = new StudioMCPServer(undefined, guard);
  const bridge = new AgentBridge(server);
  const manager = new (MCPServerManager as any)(bridge) as MCPServerManager;
  await manager.initOnAppStart();
  expect(native.token).toBe('private-startup-token');
  expect(native.order.indexOf('listen')).toBeLessThan(native.order.indexOf('start_mcp_http_server'));
  expect(native.order.indexOf('set_mcp_auth_token')).toBeLessThan(native.order.indexOf('start_mcp_http_server'));
  expect(native.replies[0].result.isError).toBe(true);
  expect(defaultDocumentManager.getDevelopDocument('startup-raw')!.settings.exposure).toBe(0);
  expect(defaultCommandBus.canUndo()).toBe(false);
  expect(JSON.parse(manager.getClaudeDesktopConfig()).mcpServers['ai-creative-studio'].env).toEqual({ STUDIO_MCP_ENDPOINT: 'http://127.0.0.1:18291/mcp', STUDIO_AUTH_TOKEN: 'private-startup-token' });
  expect(guard.getLevel()).toBe('auto');
  bridge.disposeTauriListener();
});
