import { afterEach, expect, it, vi } from 'vitest';
import { defaultRefinement } from './cutoutMath';

afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

it('preserves an original-size soft alpha base through neutral manual refinement', async () => {
  const results: { alpha?: ArrayBuffer; error?: string }[] = [];
  const worker = { onmessage: undefined as undefined | ((event: { data: unknown }) => void), postMessage(message: { alpha?: ArrayBuffer; error?: string }) { results.push(message); } };
  vi.stubGlobal('self', worker);
  await import('./refine.worker');
  worker.onmessage!({ data: { base: new Uint8ClampedArray([0, 64, 128, 255]).buffer, width: 4, height: 1, outputWidth: 4, outputHeight: 1, options: defaultRefinement, strokes: [] } });
  expect(results[0].error).toBeUndefined();
  expect([...new Uint8ClampedArray(results[0].alpha!)]).toEqual([0, 64, 128, 255]);
});
