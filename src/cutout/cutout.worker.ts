import { CUTOUT_MODEL } from './CutoutModelManifest';
import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { alphaFromLogits, prepareInput } from './cutoutMath';
import { CutoutBackendSession, probeCutoutGpu } from './cutoutBackend';
import { refineGuidedAlphaTiles, validateCutoutSize } from './guidedAlpha';
import { repairMaskGaps } from './maskContinuity';

let runtime: CutoutBackendSession<ort.InferenceSession> | undefined;
const worker = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
worker.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.kind === 'initialize') {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, import.meta.url).href, mjs: new URL(mjsUrl, import.meta.url).href };
      // ORT 1.30's WebGPU entry uses its Asyncify runtime (not legacy JSEP).
      // Both backends share it. Retain the transferred weights only
      // for a possible CPU rebuild; worker termination releases all model memory.
      const gpu = (navigator as unknown as { gpu?: Parameters<typeof probeCutoutGpu>[0] }).gpu;
      const probe = message.acceleration === 'cpu' ? { backend: 'wasm' as const } : await probeCutoutGpu(gpu);
      if (probe.adapter) ort.env.webgpu.adapter = probe.adapter as typeof ort.env.webgpu.adapter;
      runtime = await CutoutBackendSession.create(probe, backend => ort.InferenceSession.create(message.weights, {
        // Request GPU alone: ORT must not silently drop it and report CPU as GPU.
        // Unsupported graph operators still use ORT's default CPU provider.
        executionProviders: [backend], graphOptimizationLevel: 'all',
        enableCpuMemArena: false, enableMemPattern: false, preferredOutputLocation: 'cpu',
      }));
      worker.postMessage({ kind: 'ready', ...runtime.status });
    } else if (message.kind === 'infer' || message.kind === 'infer-refined') {
      if (!runtime) throw new Error('本地抠图模型尚未初始化。');
      const rgba = new Uint8ClampedArray(message.rgba);
      const input = prepareInput(rgba, CUTOUT_MODEL.inputSize, CUTOUT_MODEL.inputSize);
      let alpha = await runtime.run(async session => {
        const tensor = new ort.Tensor('float32', input, [1, 3, CUTOUT_MODEL.inputSize, CUTOUT_MODEL.inputSize]);
        let outputs: ort.InferenceSession.ReturnType | undefined;
        try {
          outputs = await session.run({ [session.inputNames[0]]: tensor });
          const result = outputs[session.outputNames[0]];
          if (!result || result.type !== 'float32' || result.dims.length !== 4 || result.dims[0] !== 1 || result.dims[1] !== 1 || result.dims[2] !== CUTOUT_MODEL.inputSize || result.dims[3] !== CUTOUT_MODEL.inputSize) throw new Error('模型输出维度不符，未应用抠图。');
          return alphaFromLogits(result.data as Float32Array, CUTOUT_MODEL.inputSize, CUTOUT_MODEL.inputSize);
        } finally {
          for (const output of Object.values(outputs ?? {})) output.dispose();
          tensor.dispose();
        }
      });
      alpha = repairMaskGaps(alpha, rgba, CUTOUT_MODEL.inputSize, CUTOUT_MODEL.inputSize);
      if (message.kind === 'infer-refined') {
        const guide = message.guide as ImageBitmap | undefined;
        if (!guide) throw new Error('原图引导数据缺失。');
        validateCutoutSize(guide.width, guide.height);
        // Read only a tile plus its halo. Never allocate original-size RGBA/float planes.
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('无法读取原图边缘。');
        alpha = refineGuidedAlphaTiles(alpha, CUTOUT_MODEL.inputSize, CUTOUT_MODEL.inputSize, guide.width, guide.height, (x, y, w, h) => {
          canvas.width = w; canvas.height = h;
          context.drawImage(guide, x, y, w, h, 0, 0, w, h);
          return context.getImageData(0, 0, w, h).data;
        });
        canvas.width = canvas.height = 1;
      }
      worker.postMessage({ kind: 'result', alpha: alpha.buffer, ...runtime.status }, [alpha.buffer]);
    }
  } catch (reason) { worker.postMessage({ kind: 'error', error: reason instanceof Error ? reason.message : String(reason), ...runtime?.status }); }
  finally { message.guide?.close(); }
};
