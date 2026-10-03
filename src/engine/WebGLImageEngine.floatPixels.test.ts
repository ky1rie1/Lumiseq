import { afterEach, expect, it, vi } from 'vitest';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { createEditDocument, createImageLayer, createTextLayer } from '../document/EditDocument';
import { WebGLImageEngine } from './WebGLImageEngine';
import { drawTextLayer } from './drawTextLayer';
import { FloatEditRenderer } from './editFloat/renderer';
import { floatToDisplay } from './FloatEditSources';

afterEach(() => vi.unstubAllGlobals());
function installCanvas() {
  const doc = { createElement: () => createCanvas(1, 1) };
  vi.stubGlobal('window', { document: doc }); vi.stubGlobal('document', doc); vi.stubGlobal('ImageData', ImageData);
}
it('renders multiline text, long aligned lines, stroke and shadow beyond the text box', async () => {
  installCanvas();
  const layer = createTextLayer({ text: 'Lum\niseq\nStudio', fontSize: 24, color: '#eeeeee', x: 50, y: 30 });
  layer.transform.width = 20; layer.transform.height = 20; layer.align = 'center';
  layer.stroke = { enabled: true, width: 4, color: '#aaccff' };
  layer.shadow = { enabled: true, color: '#ff0000', opacity: .7, blur: 2, offsetX: 12, offsetY: 4 };
  const doc = createEditDocument({ renderingVersion: 2, width: 170, height: 160, layers: [layer], backgroundColor: 'transparent' });
  const actual = createCanvas(170, 160), reference = createCanvas(170, 160);
  const ctx = reference.getContext('2d'); ctx.translate(50, 30); drawTextLayer(ctx as any, layer);
  await new WebGLImageEngine().renderEdit(doc, actual as any);
  const a = actual.getContext('2d').getImageData(0, 0, 170, 160).data, b = reference.getContext('2d').getImageData(0, 0, 170, 160).data;
  let missing = 0, expected = 0;
  for (let i = 3; i < b.length; i += 4) { if (b[i] > 8) { expected++; if (a[i] === 0) missing++; } }
  expect(expected).toBeGreaterThan(300); expect(missing).toBe(0);
  expect(a.slice(70 * 170 * 4).some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
});

it('composites transparent float display tiles over the preview backdrop', async () => {
  installCanvas();
  const doc = createEditDocument({ renderingVersion: 2, width: 8, height: 8, backgroundColor: 'transparent' });
  const canvas = createCanvas(8, 8);
  await new WebGLImageEngine().renderEdit(doc, canvas as any, undefined, (ctx, rect) => {
    ctx.fillStyle = '#aabbcc'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  });
  expect(Array.from(canvas.getContext('2d').getImageData(4, 4, 1, 1).data)).toEqual([170, 187, 204, 255]);
});

it('maps an observation region to the exact independently rounded target dimensions', async () => {
  installCanvas();
  const doc = createEditDocument({ renderingVersion: 2, width: 10, height: 10, layers: [createImageLayer({name: 'gradient', sourceAssetId: 'original', naturalWidth: 10, naturalHeight: 10})] });
  const renderer = new FloatEditRenderer({ getSource: async () => ({ width: 10, height: 10, getRegion: async r => {
    const data = new Float32Array(r.width * r.height * 4);
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4; data[i] = data[i + 1] = data[i + 2] = (r.y + y) / 9; data[i + 3] = 1;
    }
    return {width: r.width, height: r.height, data};
  }}), getMask: async () => {throw Error('unused')}, getRawSource: async () => {throw Error('unused')}, getTextSource: async () => {throw Error('unused')} });
  const engine = new WebGLImageEngine(); vi.spyOn(engine as any, 'floatRenderer').mockReturnValue(renderer);
  const canvas = createCanvas(3, 4);
  await engine.renderEdit(doc, canvas as any, undefined, undefined, undefined, {
    sourceRegion: { x: 2, y: 2, width: 5, height: 5 },
  });
  const reference = await renderer.renderRegion(doc, {x: 2, y: 2, width: 5, height: 5}, {scale: .6, scaleY: .8});
  expect(canvas.getContext('2d').getImageData(0, 0, 3, 4).data).toEqual(floatToDisplay(reference));
});
