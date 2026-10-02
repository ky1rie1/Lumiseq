// Read-only rendered-page acceptance, restricted to an ephemeral hosted runner.
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Home-page acceptance requires a disposable GitHub-hosted runner.');
}
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback probe port.');
const deadline = Date.now() + 60_000;
let target;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    const targets = await response.json();
    target = targets.find(item => item.type === 'page' && new URL(item.url).hostname === 'tauri.localhost');
    if (target) break;
  } catch { /* WebView may still be starting. */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!target) throw new Error('Published application did not expose its rendered WebView.');
const socketUrl = new URL(target.webSocketDebuggerUrl);
if (socketUrl.protocol !== 'ws:' || socketUrl.hostname !== '127.0.0.1' || Number(socketUrl.port) !== port) throw new Error('Probe endpoint is not the expected local WebView.');
const socket = new WebSocket(socketUrl);
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id);
  clearTimeout(item.timer);
  if (message.error) item.reject(new Error('WebView inspection failed.'));
  else item.resolve(message.result);
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WebView connection timed out.')), 5000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebView connection failed.')); }, { once: true });
});
let id = 0;
try {
  let passed = false;
  while (Date.now() < deadline) {
    const result = await new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Rendered-page inspection timed out.')); }, 5000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: {
        expression: `JSON.stringify({ ready: document.readyState === 'complete', root: !!document.querySelector('#root main'), home: document.body.innerText.includes('\u6700\u8fd1\u9879\u76ee'), create: document.body.innerText.includes('\u65b0\u5efa\u753b\u5e03'), status: document.body.innerText.includes('Ready') })`,
        returnByValue: true,
      } }));
    });
    if (result.exceptionDetails) throw new Error('Rendered-page check raised an exception.');
    const state = JSON.parse(result.result.value);
    if (['ready', 'root', 'home', 'create', 'status'].every(key => state[key] === true)) { passed = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!passed) throw new Error('Published application did not render a ready home page.');
  console.log('Rendered home page passed: loaded document, workspace, recent projects, new canvas and Ready status.');
} finally { socket.close(); }
