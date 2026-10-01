import { CUTOUT_MODEL, defaultCutoutModelStore } from './CutoutModelStore';
import { validateCutoutSize } from './guidedAlpha';

/** A dedicated worker keeps CPU inference off the editor's UI thread. */
export class LocalCutoutProvider {
  private worker?: Worker;
  private busy = false;
  private pendingCancel?: () => void;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private idleMinutes = 3;
  private operationGeneration = 0;
  private backend:'uninitialized'|'webgpu'|'wasm'='uninitialized';
  private fallbackReason?:string;
  private acceleration:'auto'|'cpu'='auto';
  private workerAcceleration?:'auto'|'cpu';
  getRuntimeStatus() {return {loaded:!!this.worker,busy:this.busy,idleMinutes:this.idleMinutes,backend:this.worker?this.backend:'uninitialized',fallbackReason:this.fallbackReason,acceleration:this.acceleration};}
  setAcceleration(mode:'auto'|'cpu'):void {
    if(mode!=='auto'&&mode!=='cpu')throw new RangeError('Invalid cutout acceleration.');
    if(this.acceleration===mode)return;this.acceleration=mode;if(!this.busy)this.releaseIdleSession();
  }
  setIdleMinutes(minutes:number):void {
    if(![0,1,3,5].includes(minutes))throw new RangeError('Invalid cutout idle timeout.');
    this.idleMinutes=minutes;this.cancelIdleTimer();if(!this.busy)this.scheduleIdleRelease();
  }
  releaseIdleSession():boolean {
    if(this.busy)return false;
    this.cancelIdleTimer();this.worker?.terminate();this.worker=undefined;return true;
  }
  private cancelIdleTimer():void {if(this.idleTimer!==undefined)clearTimeout(this.idleTimer);this.idleTimer=undefined;}
  private scheduleIdleRelease():void {
    this.cancelIdleTimer();if(this.worker&&this.idleMinutes>0)this.idleTimer=setTimeout(()=>{this.releaseIdleSession();},this.idleMinutes*60_000);
  }
  dispose(): void {
    ++this.operationGeneration;
    this.cancelIdleTimer();
    this.pendingCancel?.();
    this.worker?.terminate(); this.worker = undefined;
  }
  private request(message: unknown, transfer: Transferable[], signal: AbortSignal, timeoutMs: number): Promise<MessageEvent['data']> {
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.onmessage = null; worker.onerror = null; this.pendingCancel = undefined; };
      const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); worker.terminate(); if (this.worker === worker) this.worker = undefined; reject(error); };
      const abort = () => fail(new Error('已取消本地抠图。'));
      const timeout = setTimeout(() => fail(new Error('本地模型处理超时，请重试或使用手动蒙版。')), timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      this.pendingCancel = () => fail(new Error('本地抠图已终止，请重新操作。'));
      worker.onmessage = event => {
        if (settled) return;
        if (event.data.kind === 'error') { fail(new Error(event.data.error)); return; }
        if(event.data.backend==='webgpu'||event.data.backend==='wasm')this.backend=event.data.backend;
        if(typeof event.data.fallbackReason==='string')this.fallbackReason=event.data.fallbackReason.slice(0,500);
        settled = true; cleanup(); resolve(event.data);
      };
      worker.onerror = event => fail(new Error(`本地模型运行失败：${event.message}`));
      if (signal.aborted) { abort(); return; }
      try {worker.postMessage(message, transfer);} catch(reason) {fail(reason instanceof Error?reason:new Error(String(reason)));}
    });
  }
  async infer(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Uint8ClampedArray> {
    return this.run(canvas, signal, false);
  }
  /** Original-size soft mask, using the same model and source RGB guided refinement. */
  async inferRefined(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Uint8ClampedArray> {
    validateCutoutSize(canvas.width, canvas.height);
    return this.run(canvas, signal, true);
  }
  private async run(canvas: HTMLCanvasElement, signal: AbortSignal, refined: boolean): Promise<Uint8ClampedArray> {
    if (this.busy) throw new Error('本地抠图正在处理，请等待或取消后重试。');
    if(this.worker&&this.workerAcceleration!==this.acceleration)this.releaseIdleSession();
    this.cancelIdleTimer();
    this.busy = true;
    const generation=this.operationGeneration;
    const width = canvas.width, height = canvas.height;
    let guide: ImageBitmap | undefined;
    const checkCurrent = () => { signal.throwIfAborted(); if (generation !== this.operationGeneration) throw new Error('本地抠图已终止，请重新操作。'); };
    try {
      checkCurrent();
      if (!this.worker) {
        const weights = await defaultCutoutModelStore.load(signal);
        if(generation!==this.operationGeneration)throw new Error('本地抠图已终止，请重新操作。');
        signal.throwIfAborted();
        this.worker = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' });
        this.workerAcceleration=this.acceleration;this.backend='uninitialized';this.fallbackReason=undefined;
        await this.request({ kind: 'initialize', weights: weights.buffer, acceleration:this.acceleration }, [weights.buffer as ArrayBuffer], signal, 120_000);
      }
      if (refined) {
        guide = await createImageBitmap(canvas);
        checkCurrent();
        if (guide.width !== width || guide.height !== height || canvas.width !== width || canvas.height !== height) throw new Error('原图尺寸已变化，请重新抠图。');
      }
      const resized = document.createElement('canvas'); resized.width = resized.height = CUTOUT_MODEL.inputSize;
      const context = resized.getContext('2d');
      if (!context) throw new Error('无法读取图像像素。');
      context.drawImage(guide ?? canvas, 0, 0, CUTOUT_MODEL.inputSize, CUTOUT_MODEL.inputSize);
      const pixels = context.getImageData(0, 0, CUTOUT_MODEL.inputSize, CUTOUT_MODEL.inputSize).data;
      checkCurrent();
      const result = await this.request({ kind: refined ? 'infer-refined' : 'infer', rgba: pixels.buffer, guide },
        guide ? [pixels.buffer as ArrayBuffer, guide] : [pixels.buffer as ArrayBuffer], signal, 300_000);
      checkCurrent();
      if (refined && (canvas.width !== width || canvas.height !== height)) throw new Error('原图尺寸已变化，请重新抠图。');
      if (refined && (result.kind !== 'result' || !(result.alpha instanceof ArrayBuffer))) throw new Error('原图蒙版数据无效，未应用抠图。');
      const alpha = new Uint8ClampedArray(result.alpha);
      if (refined && alpha.length !== width * height) throw new Error('原图蒙版尺寸不符，未应用抠图。');
      return alpha;
    } finally { guide?.close(); this.busy = false; this.scheduleIdleRelease(); }
  }
}
export const defaultLocalCutoutProvider = new LocalCutoutProvider();
