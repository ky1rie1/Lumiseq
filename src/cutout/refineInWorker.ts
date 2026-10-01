import type { Refinement } from './cutoutMath';
import type { Point } from '../selection/types';
export interface CutoutStroke { point: Point; radius: number; mode: 'add' | 'remove' }
export function refineInWorker(base: Uint8ClampedArray | undefined, width: number, height: number, options: Refinement, strokes: CutoutStroke[], outputWidth: number, outputHeight: number, signal: AbortSignal): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./refine.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timeout); worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('已取消精修。')); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('精修处理超时，请减少画布尺寸或笔画。')); }, 120_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => { cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(new Uint8ClampedArray(event.data.alpha)); };
    worker.onerror = event => { cleanup(); reject(new Error(event.message)); };
    if (signal.aborted) { abort(); return; }
    const buffer = base?.slice().buffer;
    worker.postMessage({ base: buffer, width, height, outputWidth, outputHeight, options, strokes }, buffer ? [buffer] : []);
  });
}
