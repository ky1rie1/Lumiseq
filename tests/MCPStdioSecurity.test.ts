import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';

async function runAdapter(token: string | undefined, endpoint?: string) {
  const env = { ...process.env, STUDIO_AUTH_TOKEN: token, STUDIO_MCP_ENDPOINT: endpoint };
  if (token === undefined) delete env.STUDIO_AUTH_TOKEN;
  const child = spawn(process.execPath, ['bin/studio-mcp.js'], { env });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 19, method: 'tools/call', params: { name: 'studio_get_workspace' } }) + '\n');
  const [code] = await once(child, 'exit');
  return { code, stdout, stderr };
}

it.each([undefined, '', 'mcp_live_studio_token'])('stdio refuses missing or public token %j before connecting', async token => {
  const result = await runAdapter(token);
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/STUDIO_AUTH_TOKEN/);
});

it('stdio sends requests only to the configured loopback endpoint using its private token', async () => {
  const requests: { authorization: string | undefined; url: string | undefined }[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ authorization: req.headers.authorization, url: req.url });
    req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: 19, result: { endpoint: 'active' } })); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = (server.address() as { port: number }).port;
    const result = await runAdapter('private-adapter-token', `http://127.0.0.1:${port}/mcp`);
    expect(result.code).toBe(0); expect(JSON.parse(result.stdout).result).toEqual({ endpoint: 'active' });
    expect(requests).toEqual([{ authorization: 'Bearer private-adapter-token', url: '/mcp' }]);
  } finally { server.close(); }
});

it('stdio rejects a remote endpoint without exposing its token', async () => {
  const result = await runAdapter('private-adapter-token', 'http://example.com/mcp');
  expect(result.code).not.toBe(0); expect(result.stdout).toBe('');
  expect(result.stderr).not.toContain('private-adapter-token');
});

it('stdio waits for the native confirmation response instead of returning a premature tool error', async () => {
  const server = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: 19, result: { approved: true } })); }, 2200);
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = (server.address() as { port: number }).port;
    const result = await runAdapter('private-adapter-token', `http://127.0.0.1:${port}/mcp`);
    expect(result.stdout.trim().split('\n').map(line => JSON.parse(line))).toEqual([{ jsonrpc: '2.0', id: 19, result: { approved: true } }]);
  } finally { server.close(); }
});
