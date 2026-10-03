import { reconstructAutoToneEvaluator, type AutoToneEvaluatorSnapshot } from './autoToneEvaluator';
import { computeNaturalAutoColor, type NaturalAutoColorResult } from './floatAutoTone';

export interface AutoToneWorkerOptions {signal?:AbortSignal;budgetMs?:number;workerFactory?:()=>Worker}
export async function runNaturalAutoColor(snapshot:AutoToneEvaluatorSnapshot,options:AutoToneWorkerOptions={}):Promise<NaturalAutoColorResult|null> {
 if(options.signal?.aborted)throw new Error('Automatic color analysis cancelled');
 const budgetMs=Math.max(1,Math.min(5000,options.budgetMs??5000));
 if(!options.workerFactory&&typeof Worker==='undefined'){
  if(typeof window!=='undefined')throw new Error('Automatic color analysis worker is unavailable');
  // Headless callers have no UI thread; desktop/browser requests always use a worker.
  await new Promise<void>(resolve=>setTimeout(resolve,0));
  return computeNaturalAutoColor(snapshot.source.samples,{tailSamples:snapshot.source.tailSamples,positions:snapshot.source.positions,
   semanticCandidate:snapshot.semanticCandidate,
   renderingVersion:snapshot.settings.renderingVersion,evaluate:reconstructAutoToneEvaluator(snapshot),signal:options.signal,budgetMs});
 }
 return new Promise((resolve,reject)=>{
  const worker=options.workerFactory?.()??new Worker(new URL('./autoToneWorker.ts',import.meta.url),{type:'module'});
  let done=false;
  const finish=(error?:Error,result?:NaturalAutoColorResult|null)=>{
   if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
   worker.onmessage=null;worker.onerror=null;worker.terminate();
   if(error)reject(error);else resolve(result??null);
  };
  const abort=()=>finish(new Error('Automatic color analysis cancelled'));
  const timer=setTimeout(()=>finish(new Error('Automatic color analysis timed out')),budgetMs);
  options.signal?.addEventListener('abort',abort,{once:true});
  worker.onmessage=event=>{const data=event.data as {result?:NaturalAutoColorResult|null;error?:string};finish(data.error?new Error(data.error):undefined,data.result);};
  worker.onerror=event=>finish(new Error(event.message||'Automatic color analysis worker failed'));
  try {worker.postMessage({snapshot,budgetMs});}catch(error){finish(error instanceof Error?error:new Error(String(error)));}
 });
}
