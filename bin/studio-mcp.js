#!/usr/bin/env node
/**
 * Yingxu Studio - stdio MCP adapter.
 * Forwards requests to the desktop app's authenticated localhost MCP endpoint.
 */

import http from 'node:http';
import readline from 'node:readline';

const ENDPOINT = process.env.STUDIO_MCP_ENDPOINT || 'http://127.0.0.1:18280/mcp';
const AUTH_TOKEN = process.env.STUDIO_AUTH_TOKEN;
if (!AUTH_TOKEN || AUTH_TOKEN === 'mcp_live_studio_token' || /\s/.test(AUTH_TOKEN)) {
  process.stderr.write('STUDIO_AUTH_TOKEN must contain the private token from Studio external agent settings.\n');
  process.exit(1);
}
let endpointUrl;
try {
  endpointUrl = new URL(ENDPOINT);
  if (endpointUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpointUrl.hostname) || endpointUrl.username || endpointUrl.password) {
    throw new Error('Endpoint must use HTTP on loopback');
  }
} catch {
  process.stderr.write('STUDIO_MCP_ENDPOINT must be an HTTP loopback endpoint from Studio external agent settings.\n');
  process.exit(1);
}

// Canonical tool definitions for stdio discovery
const CANONICAL_TOOLS = [
  { name: 'studio_get_capabilities', description: 'Get registered capabilities of AI Creative Studio', inputSchema: { type: 'object', properties: {} } },
  { name: 'studio_get_workspace', description: 'Get current workspace state and open document list', inputSchema: { type: 'object', properties: {} } },
  { name: 'studio_get_active_document', description: 'Get metadata and layers of the currently open document', inputSchema: { type: 'object', properties: {} } },
  { name: 'studio_get_document_context', description: 'Get comprehensive document metadata and develop/edit parameters', inputSchema: { type: 'object', properties: {} } },
  { name: 'studio_get_develop_parameter_specs', description: 'Get exact bounds for selected RAW adjustments', inputSchema: { type: 'object', properties: { parameterIds: { type: 'array', items: { type: 'string' } } } } },
  { name: 'studio_get_preview', description: 'Capture downsampled visual snapshot (512px / 1024px) of current canvas', inputSchema: { type: 'object', properties: { maxDimension: { type: 'number' } } } },
  { name: 'studio_get_selection', description: 'Get active selection mask region and bounding rectangle', inputSchema: { type: 'object', properties: {} } },
  { name: 'studio_undo', description: 'Undo the last executed command', inputSchema: { type: 'object', properties: {} } },
  { name: 'studio_redo', description: 'Redo the previously undone command', inputSchema: { type: 'object', properties: {} } },
  { name: 'studio_set_exposure', description: 'Adjust RAW exposure EV parameter (-5.0 to +5.0)', inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } },
  { name: 'studio_set_temperature', description: 'Adjust RAW white balance color temperature in Kelvin (2000-12000)', inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } },
  { name: 'studio_develop_set_parameter', description: 'Set a RAW develop parameter using the shared command API', inputSchema: { type: 'object', properties: { parameterId: { type: 'string' }, value: { type: 'number' }, channel: { type: 'string' } }, required: ['parameterId', 'value'] } },
  { name: 'studio_edit_create_paint_layer', description: 'Create a new raster paint layer on the canvas', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
  { name: 'studio_edit_create_adjustment_layer', description: 'Create a non-destructive parametric adjustment layer', inputSchema: { type: 'object', properties: { adjustmentType: { type: 'string' } }, required: ['adjustmentType'] } },
  { name: 'studio_edit_set_adjustment_settings', description: 'Update parametric adjustment layer properties', inputSchema: { type: 'object', properties: { layerId: { type: 'string' }, settings: { type: 'object' } }, required: ['layerId', 'settings'] } },
  { name: 'studio_edit_brush_stroke', description: 'Apply brush stroke with Rule 2 single-undo coalescing', inputSchema: { type: 'object', properties: { layerId: { type: 'string' }, points: { type: 'array' } }, required: ['layerId', 'points'] } },
  { name: 'studio_edit_transform', description: 'Transform layer position, scale, and rotation', inputSchema: { type: 'object', properties: { layerId: { type: 'string' }, transform: { type: 'object' } }, required: ['layerId'] } },
  { name: 'studio_edit_create_group', description: 'Create hierarchical layer group', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (err) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${err.message}` },
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
    return;
  }

  // Forward to running AI Creative Studio desktop application via HTTP if running
  tryForwardHttp(request, (err, response) => {
    if (!err && response) {
      process.stdout.write(JSON.stringify(response) + '\n');
      return;
    }

    // Local stdio fallback when HTTP is off or app is starting
    if (request.method === 'initialize') {
      const initResp = {
        jsonrpc: '2.0',
        id: request.id ?? null,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'lumiseq', version: '0.7.0' },
        },
      };
      process.stdout.write(JSON.stringify(initResp) + '\n');
      return;
    }

    if (request.method === 'tools/list') {
      const listResp = {
        jsonrpc: '2.0',
        id: request.id ?? null,
        result: { tools: CANONICAL_TOOLS },
      };
      process.stdout.write(JSON.stringify(listResp) + '\n');
      return;
    }

    if (request.method === 'resources/list') {
      const resResp = {
        jsonrpc: '2.0',
        id: request.id ?? null,
        result: {
          resources: [
            { uri: 'studio://document/active', name: 'Active Document Context', mimeType: 'application/json' },
            { uri: 'studio://preview/active', name: 'Active Document Preview Image', mimeType: 'image/jpeg' },
          ],
        },
      };
      process.stdout.write(JSON.stringify(resResp) + '\n');
      return;
    }

    // For tools/call when HTTP server is disabled
    const errResp = {
      jsonrpc: '2.0',
      id: request.id ?? null,
      error: {
        code: -32001,
        message: `Yingxu Studio's local MCP server is stopped. Enable it in Settings -> External Agents before using the stdio adapter. (${err?.message || 'Connection refused'})`,
      },
    };
    process.stdout.write(JSON.stringify(errResp) + '\n');
  });
});

function tryForwardHttp(request, onComplete) {
  let completed = false;
  const callback = (error, response) => {
    if (completed) return;
    completed = true;
    onComplete(error, response);
  };
  const url = endpointUrl;

  const payload = JSON.stringify(request);

  const req = http.request(
    {
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      // The native bridge waits up to 30s for tool execution and user confirmation.
      timeout: 35000,
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            callback(null, parsed);
          } catch (e) {
            callback(e);
          }
        } else {
          callback(new Error(`Server returned HTTP ${res.statusCode}: ${data}`));
        }
      });
    }
  );

  req.on('error', (err) => {
    callback(err);
  });

  req.on('timeout', () => {
    req.destroy();
    callback(new Error('Request timeout'));
  });

  req.write(payload);
  req.end();
}
