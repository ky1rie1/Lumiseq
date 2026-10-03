// Inspect only the expected loopback WebView of a locally launched package.
const port = Number(process.argv[2]);
const expectedCommit = process.argv[3];
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) {
  throw new Error('Usage: node scripts/validate-desktop-build.mjs <debug-port> <expected-commit>');
}
const deadline = Date.now() + 60_000;
let target;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    target = (await response.json()).find(item => item.type === 'page' && new URL(item.url).hostname === 'tauri.localhost');
    if (target) break;
  } catch { /* The launched package may still be initializing WebView2. */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!target) throw new Error('The packaged application did not expose its embedded page.');
const url = new URL(target.webSocketDebuggerUrl);
if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || Number(url.port) !== port) {
  throw new Error('Unexpected debugger endpoint.');
}
const socket = new WebSocket(url);
const pending = new Map();
let nextId = 0;
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data), request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id); clearTimeout(request.timer);
  if (message.error) request.reject(new Error('Local WebView inspection failed.'));
  else request.resolve(message.result);
});
function evaluate(expression) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('WebView inspection timed out.')); }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebView connection timed out.')), 5000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebView connection failed.')); }, { once: true });
  });
  let state;
  while (Date.now() < deadline) {
    const result = await evaluate(`JSON.stringify({ ready: document.readyState === 'complete', workspace: !!document.querySelector('#root main'), status: document.body.innerText.includes('Ready') })`);
    if (result.exceptionDetails) throw new Error('Rendered-page check raised an exception.');
    state = JSON.parse(result.result.value);
    if (Object.values(state).every(value => value === true)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!state || !Object.values(state).every(value => value === true)) throw new Error('The embedded workspace did not become ready.');
  const result = await evaluate(`window.__TAURI_INTERNALS__.invoke('get_build_identity')`);
  if (result.exceptionDetails) throw new Error('Native build identity is unavailable.');
  const identity = result.result.value;
  if (identity.commit !== expectedCommit || identity.dirty !== false || !['development', 'stable'].includes(identity.channel)) {
    throw new Error('The package does not match the expected clean source commit.');
  }
  console.log(JSON.stringify({ passed: true, embedded: true, state, identity }));
} finally { socket.close(); }
