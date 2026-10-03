import { expect, it, vi } from 'vitest';
import { runNaturalAutoColor } from './autoToneWorkerRunner';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';
import type { AutoToneEvaluatorSnapshot } from './autoToneEvaluator';

const snapshot=():AutoToneEvaluatorSnapshot=>({settings:createDefaultDevelopSettings(false),source:{samples:[[.01,.01,.01],[.1,.1,.1]],positions:[[.25,.5],[.75,.5]],tailSamples:[],tailPositions:[],precision:'float32',sourcePixels:2,sourcePeak:.1},masks:[]});
it('runs structured evaluator snapshots outside the UI and terminates on cancellation',async()=>{
 const terminate=vi.fn(),postMessage=vi.fn();const worker={terminate,postMessage,onmessage:null,onerror:null} as unknown as Worker;
 const controller=new AbortController();const work=runNaturalAutoColor(snapshot(),{signal:controller.signal,workerFactory:()=>worker});
 expect(postMessage).toHaveBeenCalledOnce();controller.abort();
 await expect(work).rejects.toThrow(/cancel/i);expect(terminate).toHaveBeenCalledOnce();
});
it('cleans up a worker on result and timeout',async()=>{
 for(const mode of ['result','timeout']){
  const terminate=vi.fn(),worker={terminate,postMessage:vi.fn(),onmessage:null,onerror:null} as unknown as Worker;
  const work=runNaturalAutoColor(snapshot(),{budgetMs:20,workerFactory:()=>worker});
  if(mode==='result')worker.onmessage!({data:{result:null}} as MessageEvent);
  if(mode==='result')expect(await work).toBeNull();else await expect(work).rejects.toThrow(/time/i);
  expect(terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();
 }
});
it('evaluates the full native 65536 sample transport within conservative WebView argument limits',async()=>{
 const value=snapshot();value.source.samples=Array.from({length:65536},(_,i)=>{const y=.003+(i%1024)/2048;return [y,y*.98,y*.96];});
 value.source.positions=Array.from({length:65536},()=>[.01,.01]);
 value.source.samples[65535]=[2,1.5,-.01];value.source.tailSamples=[];value.source.tailPositions=[];value.source.sourcePixels=65536;value.source.sourcePeak=2;
 const original=Math.max, maximum=vi.spyOn(Math,'max').mockImplementation((...args:number[])=>{
  if(args.length>8192)throw new RangeError('WebView maximum call stack size exceeded');return Reflect.apply(original,Math,args);
 });
 try {
  const result=await runNaturalAutoColor(value,{budgetMs:5000});
  expect(result).not.toBeNull();expect(result!.evidence.sampleCount).toBe(65536);
  expect(result!.evidence.blockContext[0].sampleCount).toBe(65536);
  expect(result!.evidence.safety.newClippedPixelFraction).toBeLessThanOrEqual(.003);
 }finally{maximum.mockRestore();}
});
