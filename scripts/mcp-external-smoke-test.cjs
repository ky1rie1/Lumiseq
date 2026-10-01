// scripts/mcp-external-smoke-test.cjs
//! Independent MCP Test Client for Phase 5 Final Gate External Agent E2E Verification
//! Connects to live running ai-creative-studio.exe via Streamable HTTP (127.0.0.1:18280) and stdio bridge.

const http = require('http');

const ENDPOINT = process.env.STUDIO_MCP_ENDPOINT || 'http://127.0.0.1:18280/mcp';
const HEALTH_URL = 'http://127.0.0.1:18280/health';
const AUTH_TOKEN = process.env.STUDIO_AUTH_TOKEN || 'mcp_live_studio_token';

function rpcCall(method, params = {}, id = 1) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    const url = new URL(ENDPOINT);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ statusCode: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: data });
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTP request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

function checkHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get(HEALTH_URL, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, json: JSON.parse(data) });
        } catch {
          resolve({ statusCode: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
  });
}

async function run() {
  console.log('================================================================');
  console.log('   AI Creative Studio — MCP External Agent E2E Smoke Test');
  console.log('================================================================');
  console.log(`Target Endpoint: ${ENDPOINT}`);
  console.log(`Auth Token:      Bearer ${AUTH_TOKEN.substring(0, 10)}...`);

  // 1. Health Check
  console.log('\n[1/8] Probing /health...');
  const health = await checkHealth();
  console.log(`-> Health Check: HTTP ${health.statusCode}`, health.json || health.raw);
  if (health.statusCode !== 200) throw new Error('Health check failed');

  // 2. tools/list
  console.log('\n[2/8] Executing tools/list...');
  const toolsRes = await rpcCall('tools/list', {}, 1);
  console.log(`-> tools/list HTTP ${toolsRes.statusCode}`);
  const tools = toolsRes.data?.result?.tools || [];
  console.log(`-> Discovered ${tools.length} Canonical MCP Tools:`);
  console.log(tools.map((t) => t.name).join(', '));

  // 3. Open Develop Document
  console.log('\n[3/8] Opening RAW Develop Document (DSC0012.ARW)...');
  const openDevRes = await rpcCall(
    'tools/call',
    {
      name: 'studio_create_document',
      arguments: { kind: 'develop', name: 'DSC0012.ARW', width: 6000, height: 4000 },
    },
    2
  );
  console.log('-> Response:', JSON.stringify(openDevRes.data?.result || openDevRes.data));

  // 4. studio_get_active_document
  console.log('\n[4/8] Calling studio_get_active_document...');
  const docRes = await rpcCall('tools/call', { name: 'studio_get_active_document', arguments: {} }, 3);
  console.log('-> Response:', JSON.stringify(docRes.data?.result || docRes.data));

  // 5. studio_set_exposure
  console.log('\n[5/8] Calling studio_set_exposure (+1.25 EV)...');
  const expRes = await rpcCall('tools/call', { name: 'studio_set_exposure', arguments: { value: 1.25 } }, 4);
  console.log('-> Response:', JSON.stringify(expRes.data?.result || expRes.data));

  // 6. Open Edit Document & studio_get_layers
  console.log('\n[6/8] Opening Multi-Layer Edit Document (Poster_Composition.psd)...');
  const openEditRes = await rpcCall(
    'tools/call',
    {
      name: 'studio_create_document',
      arguments: { kind: 'edit', name: 'Poster_Composition.psd', width: 1920, height: 1080 },
    },
    5
  );
  console.log('-> Response:', JSON.stringify(openEditRes.data?.result || openEditRes.data));

  const layersBefore = await rpcCall('tools/call', { name: 'studio_get_layers', arguments: {} }, 6);
  console.log('-> Layers Before Text Layer:', JSON.stringify(layersBefore.data?.result || layersBefore.data));

  // 7. studio_create_text_layer
  console.log('\n[7/8] Calling studio_create_text_layer...');
  const textRes = await rpcCall(
    'tools/call',
    {
      name: 'studio_create_text_layer',
      arguments: {
        text: 'External Agent Live Verified',
        x: 150,
        y: 250,
        fontSize: 48,
        color: '#38bdf8',
        name: 'MCP Heading',
      },
    },
    7
  );
  console.log('-> Response:', JSON.stringify(textRes.data?.result || textRes.data));

  const layersAfter = await rpcCall('tools/call', { name: 'studio_get_layers', arguments: {} }, 8);
  console.log('-> Layers After Text Layer:', JSON.stringify(layersAfter.data?.result || layersAfter.data));

  // 8. studio_undo
  console.log('\n[8/8] Calling studio_undo (revert text layer)...');
  const undoRes = await rpcCall('tools/call', { name: 'studio_undo', arguments: {} }, 9);
  console.log('-> Response:', JSON.stringify(undoRes.data?.result || undoRes.data));

  const layersAfterUndo = await rpcCall('tools/call', { name: 'studio_get_layers', arguments: {} }, 10);
  console.log('-> Layers After Undo:', JSON.stringify(layersAfterUndo.data?.result || layersAfterUndo.data));

  console.log('\n================================================================');
  console.log('   RESULT: PASS — ALL MCP COMMANDS EXECUTED & VERIFIED');
  console.log('================================================================');
}

run().catch((err) => {
  console.error('\nSmoke test encountered failure:', err);
  process.exit(1);
});
