import { afterEach, expect, it, vi } from 'vitest';
import { createAdjustmentLayer, createEditDocument, createGroupLayer, createImageLayer } from '../document/EditDocument';
import { defaultAssetManager } from '../assets/AssetManager';
import { WebGLImageEngine } from './WebGLImageEngine';
import { installPixelCanvas, pixelBytes } from './editPixelTestCanvas';

afterEach(() => vi.unstubAllGlobals());
it.each(['hidden adjustment', 'zero-opacity adjustment', 'hidden ancestor', 'zero-opacity ancestor'])(
  'keeps the preview background unchanged for a %s', async condition => {
    const create = installPixelCanvas();
    const adjustment = createAdjustmentLayer({ adjustmentType: 'exposure' });
    if (condition === 'hidden adjustment') adjustment.visible = false;
    if (condition === 'zero-opacity adjustment') adjustment.opacity = 0;
    const group = createGroupLayer({ children: [adjustment] });
    if (condition === 'hidden ancestor') group.visible = false;
    if (condition === 'zero-opacity ancestor') group.opacity = 0;
    const document = createEditDocument({ width: 1, height: 1, layers: [] });
    const target = create(1, 1); const engine = new WebGLImageEngine();
    const backdrop = (ctx: CanvasRenderingContext2D) => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 1, 1); };
    await engine.renderEdit(document, target, undefined, backdrop);
    expect(pixelBytes(target)).toEqual([128, 128, 128, 255]);
    document.layers = condition.endsWith('ancestor') ? [group] : [adjustment];
    await engine.renderEdit(document, target, undefined, backdrop);
    expect(pixelBytes(target)).toEqual([128, 128, 128, 255]);
  },
);
function scene() {
  const create = installPixelCanvas();
  const source = create(2, 1);
  const context = source.getContext('2d')!;
  context.fillStyle = 'rgb(100,100,100)'; context.fillRect(0, 0, 2, 1);
  const image = createImageLayer({ name: 'Source', sourceAssetId: 'pixels', naturalWidth: 2, naturalHeight: 1 });
  const adjustment = createAdjustmentLayer({ adjustmentType: 'exposure', opacity: 0.25,
    settings: { type: 'exposure', values: { exposure: 1, offset: 0, gamma: 1 } } });
  const engine = new WebGLImageEngine(); engine.setLoadedSource('pixels', source, 2, 1);
  const document = createEditDocument({ width: 2, height: 1, backgroundColor: 'transparent', layers: [image, adjustment] });
  return { create, source, adjustment, engine, document };
}
it('composites adjustment opacity over the accumulated image pixels', async () => {
  const { create, engine, document } = scene(); const target = create(2, 1);
  await engine.renderEdit(document, target);
  expect(pixelBytes(target)).toEqual([125, 125, 125, 255, 125, 125, 125, 255]);
});
it('applies a document mask to the adjustment effect on the backdrop', async () => {
  const { create, engine, document, adjustment } = scene(); const target = create(2, 1);
  const mask = await defaultAssetManager.registerMask(new Uint8ClampedArray([0, 255]), 2, 1);
  adjustment.mask = { id: 'adjust-mask', assetId: mask.id, enabled: true, linked: false, density: 1, feather: 0 };
  await engine.renderEdit(document, target);
  expect(pixelBytes(target)).toEqual([100, 100, 100, 255, 125, 125, 125, 255]);
});
it('honors adjustment blending within an isolated group', async () => {
  const { create, engine, document, adjustment } = scene(); const target = create(2, 1);
  adjustment.opacity = 1; adjustment.blendMode = 'multiply';
  const group = createGroupLayer({ children: document.layers }); group.opacity = 0.5; document.layers = [group];
  await engine.renderEdit(document, target);
  const bytes = pixelBytes(target);
  // 100 * 200 / 255 is approximately 78; Canvas premultiplication rounds at group alpha.
  expect(Math.abs(bytes[0] - 78)).toBeLessThanOrEqual(2); expect(bytes[3]).toBe(128);
});
it('preserves source alpha and leaves the preview checker backdrop untouched', async () => {
  const { create, engine, document, source } = scene(); const target = create(2, 1);
  const context = source.getContext('2d')!; context.clearRect(0, 0, 2, 1);
  context.fillStyle = 'rgba(100,100,100,0.5)'; context.fillRect(0, 0, 1, 1);
  await engine.renderEdit(document, target);
  const exported = pixelBytes(target); expect(exported[3]).toBe(127); expect(exported[7]).toBe(0);
  expect(Math.abs(exported[0] - 125)).toBeLessThanOrEqual(2);
  await engine.renderEdit(document, target, undefined, (ctx) => { ctx.fillStyle = 'rgb(20,20,20)'; ctx.fillRect(0, 0, 2, 1); });
  expect(pixelBytes(target).slice(4)).toEqual([20, 20, 20, 255]);
});
it('maps a linked adjustment mask through a moved group before viewport scaling', async () => {
  const { create, engine, document, adjustment } = scene();
  const mask = await defaultAssetManager.registerMask(new Uint8ClampedArray([255, 0, 0, 0]), 4, 1);
  adjustment.mask = { id: 'linked', assetId: mask.id, enabled: true, linked: true, density: 1, feather: 0,
    referenceTransform: [1, 0, 0, 1, 0, 0], referenceWidth: adjustment.transform.width, referenceHeight: adjustment.transform.height };
  const group = createGroupLayer({ children: document.layers }); group.transform.x = 1;
  document.layers = [group]; document.width = 4;
  const target = create(8, 2); target.getContext('2d')!.imageSmoothingEnabled = false;
  await engine.renderEdit(document, target);
  const pixels = pixelBytes(target);
  expect(pixels.slice(8, 12)).toEqual([125, 125, 125, 255]);
  expect(pixels.slice(16, 20)).toEqual([100, 100, 100, 255]);
});
