import { afterEach, expect, it, vi } from 'vitest';
import { WebGLImageEngine } from './WebGLImageEngine';
import { createEditDocument } from '../document/EditDocument';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('exports the committed crop rectangle from real document coordinates', async () => {
  const calls: unknown[][] = [];
  const canvases: Array<{ width: number; height: number; getContext: () => unknown; toBlob: (callback: (blob: Blob) => void) => void }> = [];
  vi.stubGlobal('document', { createElement: () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args: unknown[]) => calls.push(args) }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['cropped'])) };
    canvases.push(canvas);
    return canvas;
  } });
  const doc = createEditDocument({ width: 400, height: 300 });
  doc.cropRect = { x: 20, y: 30, width: 200, height: 100 };
  const engine = new WebGLImageEngine();
  const render = vi.spyOn(engine, 'renderEdit').mockResolvedValue();
  await engine.exportEditImage(doc, { width: 800, height: 400, format: 'png', quality: 0.9 });
  expect(render).toHaveBeenCalledWith(doc, canvases[0]);
  expect(canvases[0]).toMatchObject({ width: 400, height: 300 });
  expect(canvases[1]).toMatchObject({ width: 800, height: 400 });
  expect(calls[0]).toEqual([canvases[0], 20, 30, 200, 100, 0, 0, 800, 400]);
});
