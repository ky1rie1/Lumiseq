import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LUMISEQ_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const base = process.env.LUMISEQ_VITE_URL || 'http://127.0.0.1:5173';
  await page.goto(`${base}/integration/develop-workflow-validation.html`);
  await page.waitForFunction(() => {
    const text = document.querySelector('#report').textContent;
    return text.startsWith('{') && JSON.parse(text).ready;
  });
  const photo = page.locator('.develop-photo-frame > canvas').first();
  await page.waitForFunction(() => document.querySelector('.develop-photo-frame > canvas')?.width > 300);
  await page.evaluate(async () => {
    const { defaultDocumentManager: manager } = await import('/src/document/DocumentManager.ts');
    const { useDevelopStore: store } = await import('/src/stores/useDevelopStore.ts');
    const { createDevelopDocument } = await import('/src/document/DevelopDocument.ts');
    const assetId = manager.getActiveDocument().sourceAssetId;
    const pending = createDevelopDocument({
      id: 'raw-loading-fixture', isRaw: true, sourceUri: 'photos/synthetic.arw',
      fileName: 'Synthetic RAW', width: 640, height: 480, rawState: 'decoding',
      previewAssetId: assetId,
    });
    manager.openDocument(pending);store.getState().loadDocument(pending);
    window.rawPreviewFixture = { manager, store, assetId, id: pending.id };
  });
  await page.waitForTimeout(250);
  if (await photo.isVisible()) throw new Error('An embedded JPEG or previous document is visible during RAW decoding');
  await page.getByRole('status', { name: 'RAW 载入状态' }).waitFor();
  if (!(await page.getByRole('button', { name: '自动', exact: true }).isDisabled())) throw new Error('Automatic tone is enabled for a camera JPEG');
  await page.evaluate(() => {
    const { manager, store, id, assetId } = window.rawPreviewFixture;
    manager.updateDevelopRuntime(id, { rawState: 'ready', sourceAssetId: assetId, previewAssetId: assetId }, 'Ready fixture');
    store.getState().loadDocument(manager.getDevelopDocument(id));
  });
  await photo.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[aria-label="RAW 载入状态"]'));
  const colors = await photo.evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return { max: Math.max(...pixels.subarray(0, 12000)), alpha: pixels[3] };
  });
  if (colors.max < 100 || colors.alpha !== 255) throw new Error('The decoded preview is blank');
  console.log('PASS: RAW decoding hides camera JPEG and stale photo, disables auto tone, and reveals painted working pixels');
  await page.evaluate(async () => {
    const { defaultImageEngine: engine } = await import('/src/engine/WebGLImageEngine.ts');
    window.rawPreviewFixture.engine = engine;
    window.rawPreviewFixture.renderDevelop = engine.renderDevelop;
    window.rawPreviewFixture.store.setState({ currentDoc: null, settings: null });
  });
  await page.getByText('未打开任何照片或 RAW 图像', { exact: true }).waitFor();
  await page.evaluate(() => {
    const { engine, manager, store, id } = window.rawPreviewFixture;
    engine.renderDevelop = async () => { throw new Error('Synthetic remount render failure'); };
    store.getState().loadDocument(manager.getDevelopDocument(id));
  });
  await page.waitForTimeout(250);
  if (await photo.isVisible()) throw new Error('A recreated canvas inherited the previous canvas paint readiness');
  await page.getByText('调色预览失败', { exact: true }).waitFor();
  await page.evaluate(() => {
    const { engine, renderDevelop, manager, store, id } = window.rawPreviewFixture;
    engine.renderDevelop = renderDevelop;
    manager.updateDevelopRuntime(id, { rawProgress: 100 }, 'Retry preview fixture');
    store.getState().loadDocument(manager.getDevelopDocument(id));
  });
  await photo.waitFor({ state: 'visible' });
  console.log('PASS: removing and recreating the canvas resets readiness, reports render errors and recovers after retry');
  await page.setViewportSize({ width: 900, height: 650 });
  await page.evaluate(() => {
    const { manager, store, id } = window.rawPreviewFixture;
    manager.updateDevelopRuntime(id, { rawState: 'error', rawError: 'Synthetic decode failure' }, 'Failure fixture');
    store.getState().loadDocument(manager.getDevelopDocument(id));
  });
  await page.getByRole('status', { name: 'RAW 载入状态' }).waitFor();
  if (await photo.isVisible()) throw new Error('Failed decoding silently falls back to the camera JPEG');
  const status = await page.getByRole('status', { name: 'RAW 载入状态' }).boundingBox();
  if (!status || status.x < 0 || status.x + status.width > 900) throw new Error('Loading status exceeds the viewport');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: decode failure preserves the error without a misleading JPEG fallback, status fits compact viewport');
  await page.evaluate(() => {
    const { manager, store, id } = window.rawPreviewFixture;
    manager.updateDevelopRuntime(id, { rawState: 'ready', rawError: null, sourceAssetId: 'missing-source' }, 'Missing source fixture');
    store.getState().loadDocument(manager.getDevelopDocument(id));
  });
  await page.getByText('调色预览失败', { exact: true }).waitFor();
  if (await photo.isVisible()) throw new Error('Render failure reveals stale working pixels');
  console.log('PASS: a first-render failure reports an error instead of waiting indefinitely or displaying stale pixels');
} finally {
  await browser.close();
}
