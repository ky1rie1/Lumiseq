import { afterEach, expect, it, vi } from 'vitest';
import { LocalCutoutProvider } from './LocalCutoutProvider';
import { defaultCutoutModelStore } from './CutoutModelStore';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('disposal during weight loading cannot resurrect a worker',async()=>{
  let finish!:(bytes:Uint8Array)=>void;
  vi.spyOn(defaultCutoutModelStore,'load').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const construct=vi.fn();vi.stubGlobal('Worker',class{constructor(){construct();}});
  const provider=new LocalCutoutProvider();const pending=provider.infer({} as HTMLCanvasElement,new AbortController().signal);
  const rejected=expect(pending).rejects.toThrow('终止');provider.dispose();finish(new Uint8Array([1]));await rejected;
  expect(construct).not.toHaveBeenCalled();expect(provider.getRuntimeStatus()).toMatchObject({loaded:false,busy:false});
});
it('releases an idle worker after timeout and reconstructs it on next use',async()=>{
  vi.useFakeTimers();let workers=0;const terminate=vi.fn();
  vi.spyOn(defaultCutoutModelStore,'load').mockResolvedValue(new Uint8Array([1]));
  vi.stubGlobal('Worker',class{onmessage?: (event:{data:unknown})=>void;terminate=terminate;constructor(){workers++;}postMessage(message:{kind:string}){queueMicrotask(()=>this.onmessage?.({data:message.kind==='initialize'?{kind:'ready'}:{kind:'result',alpha:new Uint8Array([128]).buffer}}));}});
  vi.stubGlobal('document',{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4)})})})});
  const provider=new LocalCutoutProvider();provider.setIdleMinutes(1);
  await provider.infer({} as HTMLCanvasElement,new AbortController().signal);
  expect(provider.getRuntimeStatus()).toMatchObject({loaded:true,busy:false,idleMinutes:1});
  await vi.advanceTimersByTimeAsync(60_000);expect(terminate).toHaveBeenCalledOnce();
  expect(provider.getRuntimeStatus().loaded).toBe(false);
  await provider.infer({} as HTMLCanvasElement,new AbortController().signal);expect(workers).toBe(2);
  provider.dispose();
});
it('does not free a worker while recognition is active',async()=>{
  let complete!:()=>void;let started!:()=>void;const processing=new Promise<void>(resolve=>started=resolve);const terminate=vi.fn();
  vi.spyOn(defaultCutoutModelStore,'load').mockResolvedValue(new Uint8Array([1]));
  vi.stubGlobal('Worker',class{onmessage?: (event:{data:unknown})=>void;terminate=terminate;postMessage(message:{kind:string}){if(message.kind==='initialize')queueMicrotask(()=>this.onmessage?.({data:{kind:'ready'}}));else{complete=()=>this.onmessage?.({data:{kind:'result',alpha:new Uint8Array([128]).buffer}});started();}}});
  vi.stubGlobal('document',{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4)})})})});
  const provider=new LocalCutoutProvider();const running=provider.infer({} as HTMLCanvasElement,new AbortController().signal);await processing;
  expect(provider.releaseIdleSession()).toBe(false);expect(terminate).not.toHaveBeenCalled();
  complete();await running;expect(provider.releaseIdleSession()).toBe(true);expect(terminate).toHaveBeenCalledOnce();provider.dispose();
});
it('immediately rejects a disposed inference and allows a fresh request', async () => {
  let allowResult = false;
  let inferenceStarted!: () => void;
  const started = new Promise<void>(resolve => { inferenceStarted = resolve; });
  vi.spyOn(defaultCutoutModelStore, 'load').mockResolvedValue(new Uint8Array([1]));
  vi.stubGlobal('Worker', class {
    onmessage?: (event: { data: unknown }) => void;
    terminate() {}
    postMessage(message: { kind: string }) {
      if (message.kind === 'initialize') queueMicrotask(() => this.onmessage?.({ data: { kind: 'ready' } }));
      else { inferenceStarted(); if (allowResult) queueMicrotask(() => this.onmessage?.({ data: { kind: 'result', alpha: new Uint8Array([128]).buffer } })); }
    }
  });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }) }) });
  const provider = new LocalCutoutProvider();
  const request = provider.infer({} as HTMLCanvasElement, new AbortController().signal);
  const rejected = expect(request).rejects.toThrow('终止');
  await started; provider.dispose(); await rejected;
  allowResult = true;
  expect(await provider.infer({} as HTMLCanvasElement, new AbortController().signal)).toEqual(new Uint8ClampedArray([128]));
  provider.dispose();
});

it('aborting during source capture closes the bitmap and cannot submit or publish refinement', async () => {
  let finish!: (bitmap: ImageBitmap) => void;
  let captured!: () => void;
  const started = new Promise<void>(resolve => { captured = resolve; });
  const posts: string[] = [];
  const close = vi.fn();
  vi.spyOn(defaultCutoutModelStore, 'load').mockResolvedValue(new Uint8Array([1]));
  vi.stubGlobal('Worker', class {
    onmessage?: (event: { data: unknown }) => void;
    terminate() {}
    postMessage(message: { kind: string }) { posts.push(message.kind); queueMicrotask(() => this.onmessage?.({ data: { kind: 'ready' } })); }
  });
  vi.stubGlobal('createImageBitmap', () => { captured(); return new Promise(resolve => { finish = resolve; }); });
  const provider = new LocalCutoutProvider(), controller = new AbortController();
  const pending = provider.inferRefined({ width: 16, height: 8 } as HTMLCanvasElement, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await started; controller.abort(); finish({ width: 16, height: 8, close } as unknown as ImageBitmap);
  await rejected;
  expect(close).toHaveBeenCalledOnce();
  expect(posts).not.toContain('infer-refined');
  expect(provider.getRuntimeStatus().busy).toBe(false);
  provider.dispose();
});

it('refuses oversized refined inputs before allocating or loading a model', async () => {
  const load = vi.spyOn(defaultCutoutModelStore, 'load');
  const provider = new LocalCutoutProvider();
  await expect(provider.inferRefined({ width: 10000, height: 10000 } as HTMLCanvasElement, new AbortController().signal)).rejects.toThrow('4000');
  expect(load).not.toHaveBeenCalled();
});

it('a late result from a canceled worker cannot clear cancellation of the next request', async () => {
  const started: (() => void)[] = [];
  const callbacks: ((event: { data: unknown }) => void)[] = [];
  vi.spyOn(defaultCutoutModelStore, 'load').mockImplementation(async () => new Uint8Array([1]));
  vi.stubGlobal('Worker', class {
    onmessage?: (event: { data: unknown }) => void;
    terminate() {}
    postMessage(message: { kind: string }) {
      if (message.kind === 'initialize') queueMicrotask(() => this.onmessage?.({ data: { kind: 'ready' } }));
      else { callbacks.push(this.onmessage!); started.shift()!(); }
    }
  });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }) }) });
  const provider = new LocalCutoutProvider(), controller = new AbortController();
  let ready = new Promise<void>(resolve => started.push(resolve));
  const first = provider.infer({} as HTMLCanvasElement, controller.signal);
  const rejectedFirst = expect(first).rejects.toThrow('取消');
  await ready; controller.abort(); await rejectedFirst;
  ready = new Promise<void>(resolve => started.push(resolve));
  const next = provider.infer({} as HTMLCanvasElement, new AbortController().signal);
  const rejectedNext = expect(next).rejects.toThrow('终止');
  await ready;
  callbacks[0]({ data: { kind: 'result', alpha: new Uint8ClampedArray([128]).buffer } });
  provider.dispose(); await rejectedNext;
  expect(provider.getRuntimeStatus()).toMatchObject({ loaded: false, busy: false });
});
