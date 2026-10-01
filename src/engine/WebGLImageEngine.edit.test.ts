import { afterEach, expect, it, vi } from 'vitest';
import { WebGLImageEngine } from './WebGLImageEngine';
import { createEditDocument, createGroupLayer, createImageLayer, createSmartObjectLayer, createTextLayer } from '../document/EditDocument';
import { defaultAssetManager } from '../assets/AssetManager';
import { SelectionUtils } from '../selection/SelectionUtils';
import { createSmartFilter } from '../filters/smartFilters';

afterEach(() => vi.unstubAllGlobals());
it('applies a preview-only backdrop while exports keep the document background', async () => {
  const fills: string[] = [];
  const context = { fillStyle: '', clearRect() {}, fillRect() { fills.push(this.fillStyle); }, save() {}, restore() {}, translate() {}, scale() {} };
  const canvas = { width: 100, height: 100, getContext: () => context } as unknown as HTMLCanvasElement;
  const doc = createEditDocument({ width: 100, height: 100, backgroundColor: '#abcdef' });
  const engine = new WebGLImageEngine();
  await engine.renderEdit(doc, canvas, undefined, (ctx, rect) => {
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, 100, 100);
  });
  expect(fills).toEqual(['#123456']);
  await engine.renderEdit(doc, canvas);
  expect(fills).toEqual(['#123456', '#abcdef']);
  expect(doc.backgroundColor).toBe('#abcdef');
});
function canvasFactory() {
  const canvases: any[] = [];
  const create = () => {
    const events: any[] = [];
    const canvas: any = { width: 100, height: 100, events };
    let state: any = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
    const stack: any[] = [];
    const ctx: any = new Proxy({ canvas, save() { stack.push({ ...state }); }, restore() { state = stack.pop(); },
      translate(x: number, y: number) { events.push(['translate', x, y]); }, scale(x: number, y: number) { events.push(['scale', x, y]); }, rotate(x: number) { events.push(['rotate', x]); },
      transform(...args: number[]) { events.push(['transform', ...args]); },
      clearRect() {}, fillRect() {}, measureText(s: string) { return { width: s.length * 10 }; },
      fillText(s: string) { events.push(['text', s, state.globalAlpha]); }, strokeText() {},
      drawImage(...args: any[]) { events.push(['image', state.globalCompositeOperation, ...args]); events.push(['imageAlpha', state.globalAlpha]); },
      createImageData(w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      getImageData(_x: number, _y: number, w: number, h: number) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let pixel = 0; pixel < w * h; pixel++) {
          data[pixel * 4] = pixel % 2 ? 240 : 20;
          data[pixel * 4 + 1] = 80;
          data[pixel * 4 + 2] = 40;
          data[pixel * 4 + 3] = 255;
        }
        return { data, width: w, height: h };
      },
      putImageData(data: any) { events.push(['pixels', [...data.data]]); },
    }, { get(target, key) { return Reflect.get(target, key) ?? state[key]; }, set(_target, key, value) { state[key] = value; return true; } });
    canvas.getContext = () => ctx;
    canvases.push(canvas);
    return canvas;
  };
  vi.stubGlobal('window', { document: { createElement: create } });
  return { create, canvases };
}

it('applies nested text transforms and child opacity', async () => {
  const { create, canvases } = canvasFactory();
  const child = createTextLayer({ text: 'Nested', x: 7, y: 8, opacity: 0.25 });
  child.transform.rotation = 90;
  const group = createGroupLayer({ children: [child] });
  group.transform.x = 10;
  const canvas = create();
  await new WebGLImageEngine().renderEdit(createEditDocument({ width: 100, height: 100, layers: [group] }), canvas);
  const events = canvases.flatMap(c => c.events);
  expect(events).toContainEqual(['translate', 7, 8]);
  expect(events).toContainEqual(['rotate', Math.PI / 2]);
  expect(events).toContainEqual(['text', 'Nested', 0.25]);
});

it('rejects decoding without browser image capabilities instead of inventing pixels', async () => {
  vi.stubGlobal('createImageBitmap', undefined); vi.stubGlobal('Image', undefined);
  await expect(new WebGLImageEngine().loadAsset('headless', new Blob(['bytes']))).rejects.toThrow(/decod|解码/i);
});

it('composites translucent groups once while preserving child alpha inside the buffer', async () => {
  const { create, canvases } = canvasFactory();
  const group = createGroupLayer({ children: [createTextLayer({ text: 'A', opacity: 0.8 }), createTextLayer({ text: 'B', opacity: 0.6 })] });
  group.opacity = 0.5;
  const target = create();
  await new WebGLImageEngine().renderEdit(createEditDocument({ width: 100, height: 100, layers: [group] }), target);
  expect(target.events).toContainEqual(['imageAlpha', 0.5]);
  const children = canvases.flatMap(c => c.events).filter(e => e[0] === 'text');
  expect(children).toEqual([['text', 'A', 0.8], ['text', 'B', 0.6]]);
});

it('fails before drawing when a nested image asset is unavailable', async () => {
  const { create } = canvasFactory();
  const layer = createImageLayer({ name: 'Missing', sourceAssetId: 'missing-nested', naturalWidth: 2, naturalHeight: 2 });
  await expect(new WebGLImageEngine().renderEdit(createEditDocument({ layers: [createGroupLayer({ children: [layer] })] }), create())).rejects.toThrow(/asset|资源/i);
});

it('uses inverse document transforms for nested rotated masks and honors inversion', async () => {
  const { create, canvases } = canvasFactory();
  const mask = await defaultAssetManager.registerMask(new Uint8ClampedArray([0, 64, 128, 255]), 2, 2, 'test');
  const child = createTextLayer({ text: 'Masked', x: 0, y: 0 });
  child.transform.rotation = 90; child.transform.scaleX = 2;
  child.mask = { id: 'mask', assetId: mask.id, enabled: true, linked: true, density: 0.5, feather: 0, inverted: true };
  const group = createGroupLayer({ children: [child] }); group.transform.x = 10;
  await new WebGLImageEngine().renderEdit(createEditDocument({ width: 2, height: 2, layers: [group] }), create());
  const all = canvases.flatMap(c => c.events);
  expect(all.some(e => e[0] === 'transform' && Math.abs(e[2] + 1) < 1e-6 && Math.abs(e[3] - 0.5) < 1e-6 && Math.abs(e[6] - 10) < 1e-6)).toBe(true);
  expect(all.find(e => e[0] === 'pixels')?.[1].filter((_v: number, i: number) => i % 4 === 3)).toEqual([255, 223, 191, 128]);
});

it('feathers mask alpha in document pixels before mapping into scaled text coordinates', async () => {
  const { create, canvases } = canvasFactory();
  const values = new Uint8ClampedArray([0, 255, 0]);
  const mask = await defaultAssetManager.registerMask(values, 3, 1, 'feather-test');
  const child = createTextLayer({ text: 'Soft' }); child.transform.scaleX = 2;
  child.mask = { id: 'soft', assetId: mask.id, enabled: true, linked: true, density: 1, feather: 1 };
  await new WebGLImageEngine().renderEdit(createEditDocument({ width: 3, height: 1, layers: [child] }), create());
  const pixels = canvases.flatMap(c => c.events).find(e => e[0] === 'pixels')[1];
  expect(pixels.filter((_v: number, i: number) => i % 4 === 3)).toEqual([...SelectionUtils.featherMask(values, 3, 1, 1)]);
});

it('renders a linked document mask through the moved and resized nested layer mapping', async () => {
  const { create, canvases } = canvasFactory();
  const asset = await defaultAssetManager.registerMask(new Uint8ClampedArray(100 * 100).fill(255), 100, 100, 'linked');
  const child = createTextLayer({ text: 'Follow', x: 8, y: 6 });
  child.transform.width = 40; child.transform.height = 30; child.transform.rotation = 90;
  child.mask = { id: 'linked-mask', assetId: asset.id, enabled: true, linked: true, density: 1, feather: 0,
    referenceTransform: [0, 1, -1, 0, 13, 4], referenceWidth: 20, referenceHeight: 10 };
  const group = createGroupLayer({ children: [child] }); group.transform.x = 30;
  await new WebGLImageEngine().renderEdit(createEditDocument({ width: 100, height: 100, layers: [group] }), create());
  const mapping = canvases.flatMap(c => c.events).find(e => e[0] === 'transform' && Math.abs(e[1] - 3) < 1e-6);
  expect(mapping).toBeDefined();
  expect(mapping.slice(1)).toEqual([expect.closeTo(3), expect.closeTo(0), expect.closeTo(0), expect.closeTo(2), expect.closeTo(-1), expect.closeTo(-2)]);
});

it('keeps a captured linked mask usable after resizing the document canvas', async () => {
  const { create, canvases } = canvasFactory();
  const asset = await defaultAssetManager.registerMask(new Uint8ClampedArray([0, 64, 128, 255]), 2, 2, 'before-resize');
  const child = createTextLayer({ text: 'Resized', x: 3, y: 4 });
  child.transform.width = 4; child.transform.height = 4;
  child.mask = { id: 'resize-mask', assetId: asset.id, enabled: true, linked: true, density: 1, feather: 0,
    referenceTransform: [1, 0, 0, 1, 0, 0], referenceWidth: 2, referenceHeight: 2 };
  await expect(new WebGLImageEngine().renderEdit(createEditDocument({ width: 10, height: 12, layers: [child] }), create())).resolves.toBeUndefined();
  const events = canvases.flatMap(c => c.events);
  expect(events.find(e => e[0] === 'pixels')[1].filter((_v: number, i: number) => i % 4 === 3)).toEqual([0, 64, 128, 255]);
  expect(events).toContainEqual(['transform', 2, 0, 0, 2, 3, 4]);
});

it('evaluates enabled Smart Object filters once and reuses the cached pixels', async () => {
  const { create, canvases } = canvasFactory();
  const engine = new WebGLImageEngine();
  engine.setLoadedSource('smart-source', {} as HTMLCanvasElement, 3, 1);
  const layer = createSmartObjectLayer({ sourceAssetId: 'smart-source', embeddedAssetId: 'smart-source', originalWidth: 3, originalHeight: 1 });
  layer.smartFilters = [createSmartFilter('gaussian_blur', { id: 'blur', settings: { radius: 1 } })];
  const document = createEditDocument({ width: 3, height: 1, layers: [layer] });
  const target = create();

  await engine.renderEdit(document, target);
  await engine.renderEdit(document, target);

  expect(canvases.flatMap(canvas => canvas.events).filter(event => event[0] === 'pixels')).toHaveLength(1);
  expect(target.events.filter((event: any[]) => event[0] === 'image')).toHaveLength(2);
});
