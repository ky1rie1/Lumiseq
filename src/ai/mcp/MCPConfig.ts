import { PermissionLevel } from '../types';

export const MCP_CONFIG_KEY = 'ai_studio_external_agents_v2';
const LEGACY_CONFIG_KEY = 'ai_studio_external_agents';

export interface ExternalAgentStorageConfig {
  httpEnabled: boolean;
  portMode: 'auto' | 'fixed';
  fixedPort: number;
  permissionMode: PermissionLevel;
  authToken: string;
}

export function generateMCPToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `mcp_live_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function isValidMCPToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && token !== 'mcp_live_studio_token' && !/\s/.test(token);
}

function readConfig(key: string): Record<string, unknown> | undefined {
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return;
  const saved = localStorage.getItem(key);
  if (!saved) return;
  try {
    const value: unknown = JSON.parse(saved);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Invalid saved JSON is replaced with safe defaults. */ }
}

export function loadMCPConfig(): ExternalAgentStorageConfig {
  const current = readConfig(MCP_CONFIG_KEY);
  const saved = current ?? readConfig(LEGACY_CONFIG_KEY) ?? {};
  const port = current ? saved.fixedPort : saved.port;
  const config: ExternalAgentStorageConfig = {
    httpEnabled: Boolean(current && saved.httpEnabled === true),
    portMode: saved.portMode === 'fixed' ? 'fixed' : 'auto',
    fixedPort: typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 18280,
    permissionMode: ['ask', 'readonly', 'auto', 'full'].includes(saved.permissionMode as string) ? saved.permissionMode as PermissionLevel : 'ask',
    authToken: isValidMCPToken(saved.authToken) ? saved.authToken : generateMCPToken(),
  };
  saveMCPConfig(config);
  return config;
}

export function saveMCPConfig(config: ExternalAgentStorageConfig): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(MCP_CONFIG_KEY, JSON.stringify(config));
}
