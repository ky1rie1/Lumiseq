import { afterEach, expect, it, vi } from 'vitest';
import { defaultImageEngine } from '../engine/WebGLImageEngine';
import { createEditDocument } from '../document/EditDocument';
import { sampleDocumentColor } from './sampleDocumentColor';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('renders just the centered source pixel window at native resolution without UI overlays', async () => {
  const canvas = { width: 0, height: 0, getContext: () => ({ canvas, getImageData: () => ({ width: 3, height: 3, data: new Uint8ClampedArray(Array.from({ length: 9 }, () => [17, 103, 231, 255]).flat()) }) }) };
  vi.stubGlobal('document', { createElement: () => canvas });
  const render = vi.spyOn(defaultImageEngine, 'renderEdit').mockImplementation(async (doc, target, viewport, backdrop) => {
    expect([target.width, target.height]).toEqual([3, 3]);
    const scale = Math.min(target.width / doc.width, target.height / doc.height) * viewport!.zoom;
    expect(scale).toBeCloseTo(1);
    expect((target.width - doc.width * scale) / 2 + viewport!.panX).toBeCloseTo(-99);
    expect((target.height - doc.height * scale) / 2 + viewport!.panY).toBeCloseTo(-49);
    expect(backdrop).toBeUndefined();
  });
  const sample = await sampleDocumentColor(createEditDocument({ width: 400, height: 200 }), 100.9, 50.4, 3);
  expect(sample).toMatchObject({ x: 100, y: 50, sampleSize: 3, hex: '#1167e7' });
  expect(render).toHaveBeenCalledOnce();
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
});
it('rejects a click outside the document before creating any render buffer', async () => {
  const render = vi.spyOn(defaultImageEngine, 'renderEdit');
  await expect(sampleDocumentColor(createEditDocument({ width: 10, height: 10 }), -1, 0)).rejects.toThrow();
  expect(render).not.toHaveBeenCalled();
});
