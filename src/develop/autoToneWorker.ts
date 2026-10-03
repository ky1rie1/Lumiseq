import { reconstructAutoToneEvaluator, type AutoToneEvaluatorSnapshot } from './autoToneEvaluator';
import { computeNaturalAutoColor } from './floatAutoTone';

self.onmessage=(event:MessageEvent<{snapshot:AutoToneEvaluatorSnapshot;budgetMs:number}>)=>{
 try {
  const {snapshot,budgetMs}=event.data;
  const result=computeNaturalAutoColor(snapshot.source.samples,{tailSamples:snapshot.source.tailSamples,
   positions:snapshot.source.positions,renderingVersion:snapshot.settings.renderingVersion,budgetMs,
   semanticCandidate:snapshot.semanticCandidate,
   evaluate:reconstructAutoToneEvaluator(snapshot)});
  self.postMessage({result});
 } catch(error){self.postMessage({error:error instanceof Error?error.message:String(error),...(error instanceof Error?{errorStack:error.stack}:{})});}
};
