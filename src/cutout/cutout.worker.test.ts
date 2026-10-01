import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CUTOUT_MODEL } from './CutoutModelManifest';

afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.doUnmock('onnxruntime-web/webgpu'); vi.doUnmock('onnxruntime-web/wasm'); });

async function workerHarness(acceleration: 'auto' | 'cpu' = 'auto', failGpuRun = false, guide?: ImageBitmap) {
  const posts: Record<string, unknown>[] = [];
  const events: string[] = [];
  const worker = { onmessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>), postMessage(message: Record<string, unknown>) { posts.push(message); } };
  const env = { wasm: {} as { wasmPaths?: { mjs: string; wasm: string } }, webgpu: {} };
  const adapter = { isFallbackAdapter: false };
  let requested = 0;
  const ort = {
    env,
    Tensor: class { type = 'float32'; constructor(_type: string, public data: Float32Array, public dims: number[]) {} dispose() { events.push('input dispose'); } },
    InferenceSession: { async create(_weights: unknown, options: { executionProviders: string[] }) {
      const backend = options.executionProviders[0];
      events.push(`create ${backend}`);
      return {
        inputNames: ['input'], outputNames: ['output'],
        async release() { events.push(`release ${backend}`); },
        async run() {
          events.push(`run ${backend}`);
          if (backend === 'webgpu' && failGpuRun) throw new Error('device lost');
          return { output: { type: 'float32', dims: [1, 1, CUTOUT_MODEL.inputSize, CUTOUT_MODEL.inputSize], data: new Float32Array(CUTOUT_MODEL.inputSize ** 2), dispose() { events.push('output dispose'); } } };
        },
      };
    } },
  };
  vi.doMock('onnxruntime-web/webgpu', () => ort);
  vi.doMock('onnxruntime-web/wasm', () => ort);
  vi.stubGlobal('self', worker);
  vi.stubGlobal('navigator', { gpu: { async requestAdapter() { requested++; return adapter; } } });
  await import('./cutout.worker');
  await worker.onmessage!({ data: { kind: 'initialize', weights: new Uint8Array([1]), acceleration } });
  await worker.onmessage!({ data: { kind: guide ? 'infer-refined' : 'infer', rgba: new Uint8ClampedArray(CUTOUT_MODEL.inputSize ** 2 * 4).buffer, guide } });
  return { posts, events, env, requested };
}

it('reports a GPU session and disposes input/output tensors after producing alpha', async () => {
  const { posts, events, requested } = await workerHarness();
  expect(requested).toBe(1);
  expect(posts[0]).toEqual({ kind: 'ready', backend: 'webgpu' });
  expect(posts[1]).toMatchObject({ kind: 'result', backend: 'webgpu' });
  expect(new Uint8ClampedArray(posts[1].alpha as ArrayBuffer)[0]).toBe(128);
  expect(events).toEqual(['create webgpu', 'run webgpu', 'output dispose', 'input dispose']);
});

it('loads the runtime pair that exposes the WebGPU and CPU entry points used by installed ORT', async () => {
  const { env } = await workerHarness();
  const paths=env.wasm.wasmPaths!;
  const moduleUrl=pathToFileURL(resolve('node_modules/onnxruntime-web/dist',basename(new URL(paths.mjs).pathname))).href;
  const binaryPath=resolve('node_modules/onnxruntime-web/dist',basename(new URL(paths.wasm).pathname));
  const exports=execFileSync(process.execPath, ['--input-type=module', '-e',
    `import fs from 'node:fs'; import create from ${JSON.stringify(moduleUrl)};
    const runtime=await create({numThreads:1,wasmBinary:fs.readFileSync(${JSON.stringify(binaryPath)})});
    console.log(JSON.stringify({gpu:typeof runtime.webgpuInit,cpu:typeof runtime._OrtInit,session:typeof runtime._OrtCreateSession}));`,
  ], { encoding: 'utf8' });
  expect(JSON.parse(exports)).toEqual({ gpu: 'function', cpu: 'function', session: 'function' });
});

it('allows explicit CPU recovery without probing a GPU', async () => {
  const { posts, requested } = await workerHarness('cpu');
  expect(requested).toBe(0);
  expect(posts[0]).toEqual({ kind: 'ready', backend: 'wasm' });
  expect(posts[1]).toMatchObject({ kind: 'result', backend: 'wasm' });
});

it('updates result backend after a failed GPU inference and cleans both attempts', async () => {
  const { posts, events } = await workerHarness('auto', true);
  expect(posts[0]).toEqual({ kind: 'ready', backend: 'webgpu' });
  expect(posts[1]).toMatchObject({ kind: 'result', backend: 'wasm', fallbackReason: expect.stringContaining('device lost') });
  expect(events).toEqual(['create webgpu', 'run webgpu', 'input dispose', 'release webgpu', 'create wasm', 'run wasm', 'output dispose', 'input dispose']);
});

it('returns original-size soft refinement in the inference worker and closes its transferred guide', async () => {
  const close = vi.fn();
  vi.stubGlobal('OffscreenCanvas', class {
    width = 1; height = 1;
    getContext() { return {
      drawImage() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4).fill(255);
        data[3] = 0;
        return { data };
      },
    }; }
  });
  const { posts } = await workerHarness('cpu', false, { width: 8, height: 1, close } as unknown as ImageBitmap);
  expect([...new Uint8ClampedArray(posts[1].alpha as ArrayBuffer)]).toEqual([0, 128, 128, 128, 128, 128, 128, 128]);
  expect(close).toHaveBeenCalledOnce();
});
