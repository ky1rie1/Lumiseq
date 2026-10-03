import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LUMISEQ_PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.LUMISEQ_RAW_REPORT_DIR) throw new Error('Set LUMISEQ_RAW_REPORT_DIR to the external native tonal acceptance directory');
const root = resolve(process.env.LUMISEQ_RAW_REPORT_DIR);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const inputs = new Map([
    ['working-preview.lf32', 'application/octet-stream'],
    ['working-preview.png', 'image/png'],
    ['native-tone-reference.json', 'application/json'],
  ]);
  await page.route('**/validation-private/*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!inputs.has(name)) return route.abort();
    await route.fulfill({ contentType: inputs.get(name), body: await readFile(join(root, name)) });
  });
  await page.goto(process.env.LUMISEQ_VITE_URL || 'http://127.0.0.1:5173');
  const report = await page.evaluate(async () => {
    const { defaultAssetManager: assets } = await import('/src/assets/AssetManager.ts');
    const { defaultImageEngine: engine } = await import('/src/engine/WebGLImageEngine.ts');
    const { decodeRawLinearPixels } = await import('/src/platform/rawLinearPixels.ts');
    const { createDefaultDevelopSettings } = await import('/src/document/DevelopDocument.ts');
    const { linearToSrgb } = await import('/src/engine/developColorMath.ts');
    const blob = await (await fetch('/validation-private/working-preview.png')).blob();
    const linear = decodeRawLinearPixels(await (await fetch('/validation-private/working-preview.lf32')).arrayBuffer());
    const reference = await (await fetch('/validation-private/native-tone-reference.json')).json();
    const asset = await assets.registerBlob(blob, 'image', 'Private working preview');
    await engine.loadAsset(asset.id, blob);engine.setRawLinearSource(asset.id, linear);
    const cases = [];
    try {
      for (const fixture of reference.cases) {
        const settings = createDefaultDevelopSettings(true);settings[fixture.parameter] = fixture.value;
        const canvas = document.createElement('canvas');canvas.width = linear.width;canvas.height = linear.height;
        try {
          await engine.renderDevelop(asset.id, settings, canvas, undefined,
            { spatialSourceSize: { width: reference.sourceWidth, height: reference.sourceHeight } });
          const gl = canvas.getContext('webgl2');
          const rgba = new Uint8Array(linear.width * linear.height * 4);
          gl.readPixels(0, 0, linear.width, linear.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          let maxCodeError = 0;
          for (let i = 0; i < reference.indices.length; i++) {
            const index = reference.indices[i], x = index % linear.width, y = Math.floor(index / linear.width);
            for (let c = 0; c < 3; c++) {
              const expected = Math.round(Math.max(0, Math.min(1, linearToSrgb(fixture.output[i][c]))) * 255);
              maxCodeError = Math.max(maxCodeError, Math.abs(rgba[((linear.height - 1 - y) * linear.width + x) * 4 + c] - expected));
            }
          }
          const display = document.createElement('canvas');display.width = 960;display.height = Math.round(960 * linear.height / linear.width);
          display.getContext('2d').drawImage(canvas, 0, 0, display.width, display.height);
          cases.push({ parameter: fixture.parameter, value: fixture.value, maxCodeError,
            passed: maxCodeError <= 1, preview: display.toDataURL('image/png').split(',')[1] });
        } finally {
          engine.releaseDevelopContext(canvas);canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
        }
      }
    } finally { engine.releaseAsset(asset.id);assets.releaseAsset(asset.id); }
    return { width: reference.sourceWidth, height: reference.sourceHeight, cases };
  });
  for (const row of report.cases) {
    await writeFile(join(root, `${row.parameter}-${row.value}.png`), Buffer.from(row.preview, 'base64'));
    delete row.preview;
  }
  report.errors = errors;
  report.passed = report.cases.every(row => row.passed) && !errors.length;
  await writeFile(join(root, 'gpu-native-tone-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
} finally { await browser.close(); }
