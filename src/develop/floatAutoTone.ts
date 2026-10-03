import { applyBaseTone, luminance, type RGB } from '../engine/developColorMath';
import type { DevelopSettings } from '../types/develop';
import { AUTO_TONE_KEYS, type AutoTonePatch } from './autoTone';

type Scene = 'general' | 'low-key' | 'high-key' | 'uniform';
export interface FloatToneDistribution { black: number; shadow: number; median: number; white: number; clipFraction: number }
export interface FloatAutoToneOptions {
  tailSamples?: readonly RGB[];
  renderingVersion?: 1 | 2;
  signal?: AbortSignal;
  /** Production point transformations, including preserved WB/color/mask intent. */
  evaluate?: (rgb: RGB, patch: AutoTonePatch, sourceIndex: number, tail: boolean) => RGB;
  budgetMs?: number;
}
export interface FloatAutoToneResult {
  patch: AutoTonePatch;
  evaluations: number;
  evidence: { algorithm: 'joint-linear-v1'; scene: Scene; sourcePeak: number; sampleCount: number;
    before: FloatToneDistribution; after: FloatToneDistribution; precision: 'linear-float' };
}
const neutral = (): AutoTonePatch => ({exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0});
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const quantile=(ordered:number[],fraction:number)=>ordered[Math.min(ordered.length-1,Math.floor((ordered.length-1)*fraction))];
const logDistance=(a:number,b:number)=>Math.log2((Math.max(0,a)+.003)/(Math.max(0,b)+.003));

/** Joint, deterministic fit in unbounded working RGB. No source or output RGB is quantized. */
export function computeFloatAutoTone(samples: readonly RGB[], options: FloatAutoToneOptions={}): FloatAutoToneResult | null {
  if (!samples.length) return null;
  const started=performance.now(),budget=Math.min(5000,Math.max(1,options.budgetMs??5000));
  const check=()=>{
    if(options.signal?.aborted)throw new Error('Automatic tone analysis cancelled');
    if(performance.now()-started>budget)throw new Error('Automatic tone analysis timed out');
  };
  check();
  let sourcePeak=-Infinity;
  for(const rgb of [...samples,...(options.tailSamples??[])]) {
    if(rgb.length!==3 || !rgb.every(Number.isFinite))throw new Error('Automatic tone requires finite RGB samples');
    sourcePeak=Math.max(sourcePeak,...rgb);
  }
  const count=Math.min(1024,samples.length);
  const points=Array.from({length:count},(_,i)=>{
    const index=Math.min(samples.length-1,Math.floor((i+.5)*samples.length/count));
    return {rgb:samples[index],index};
  });
  const evaluate=options.evaluate??((rgb:RGB,patch:AutoTonePatch)=>applyBaseTone(rgb,
    {...patch,renderingVersion:options.renderingVersion??2} as DevelopSettings));
  let evaluations=0;
  const distribution=(patch:AutoTonePatch):FloatToneDistribution=>{
    check();evaluations++;
    const values:number[]=[];let clipped=0;
    for(const point of points){
      const rgb=evaluate(point.rgb,patch,point.index,false);
      if(!rgb.every(Number.isFinite))throw new Error('Automatic tone produced nonfinite working pixels');
      values.push(Math.max(0,luminance(rgb)));
      if(Math.max(...rgb)>1)clipped++;
    }
    values.sort((a,b)=>a-b);
    return {black:quantile(values,.02),shadow:quantile(values,.1),median:quantile(values,.5),white:quantile(values,.98),clipFraction:clipped/count};
  };
  const before=distribution(neutral());
  const sourceY=points.map(p=>Math.max(0,luminance(p.rgb))).sort((a,b)=>a-b);
  const p90=quantile(sourceY,.9),p50=quantile(sourceY,.5);
  const darkFraction=sourceY.filter(v=>v<.02).length/count;
  let scene:Scene='general';
  if(before.white-before.shadow<1e-7)scene='uniform';
  else if(p50<.014 && p90<.12 && darkFraction>.75 && sourcePeak>Math.max(.15,p90*6))scene='low-key';
  else if(before.median>.32 && before.shadow>.13)scene='high-key';
  const finish=(patch:AutoTonePatch,after:FloatToneDistribution):FloatAutoToneResult=>({patch,evaluations,
    evidence:{algorithm:'joint-linear-v1',scene,sourcePeak,sampleCount:samples.length,before,after,precision:'linear-float'}});
  if(scene==='uniform')return finish(neutral(),before);

  const targetMedian=scene==='low-key'?.018:scene==='high-key'?Math.min(.55,before.median):.14;
  const targetShadow=scene==='low-key'?.0025:scene==='high-key'?.10:.025;
  const targetBlack=scene==='low-key'?.0007:scene==='high-key'?.025:.003;
  const targetWhite=scene==='low-key'?.34:.88;
  let patch=neutral();
  patch.exposure=clamp(Math.log2(targetMedian/Math.max(.0001,before.median))*.72,-3,scene==='low-key'?2.2:3);
  const gain=2**patch.exposure;
  patch.shadows=clamp((targetShadow-before.shadow*gain)/(targetShadow+.015)*40,-30,65);
  patch.highlights=clamp((targetWhite-before.white*gain)/(Math.max(.1,before.white*gain))*65,-90,25);
  patch.whites=clamp((targetWhite-before.white*gain)*18,-30,25);
  patch.blacks=clamp((targetBlack-before.black*gain)/(targetBlack+.008)*18,-30,30);
  patch.contrast=scene==='low-key'?0:clamp((.5-(before.white-before.shadow)*gain)*16,-15,20);

  const tails=(options.tailSamples??[]).slice(0,512);
  const loss=(candidate:AutoTonePatch):{loss:number;stats:FloatToneDistribution}=>{
    const stats=distribution(candidate);
    const clipExcess=Math.max(0,stats.clipFraction-Math.min(before.clipFraction,.002)-.003);
    let tailPenalty=0;
    for(let i=0;i<tails.length;i++){
      const rgb=evaluate(tails[i],candidate,i,true);
      if(!rgb.every(Number.isFinite))throw new Error('Automatic tone produced nonfinite highlight pixels');
      tailPenalty+=Math.min(3,Math.max(0,Math.max(...rgb)-1))**2;
    }
    const score=logDistance(stats.median,targetMedian)**2*2.5+
      logDistance(stats.shadow,targetShadow)**2*.45+logDistance(stats.black,targetBlack)**2*.16+
      logDistance(stats.white,targetWhite)**2*.30+clipExcess*18+clipExcess**2*80+
      tailPenalty/Math.max(1,tails.length)*.12+
      AUTO_TONE_KEYS.reduce((sum,key)=>sum+(candidate[key]/(key==='exposure'?3:100))**2,0)*.018;
    return {loss:score,stats};
  };
  let best=loss(patch);
  const plain=loss(neutral());
  if(plain.loss<best.loss){patch=neutral();best=plain;}
  const bounds:Record<keyof AutoTonePatch,[number,number]>={exposure:[-3,scene==='low-key'?2.2:3],
    contrast:[-25,35],highlights:[-95,40],shadows:[-45,75],whites:[-45,35],blacks:[-35,40]};
  // Revisit each tonal dimension at coarse, medium and fine scales; the full joint
  // objective includes channel clipping, not merely a gray histogram or exposure.
  for(const step of [1,.5,.25,.1])for(let pass=0;pass<2;pass++)for(const key of AUTO_TONE_KEYS){
    for(const direction of [-1,1]){
      if(evaluations>=254)break;
      const [lo,hi]=bounds[key],delta=step*(key==='exposure'?.7:20);
      const value=clamp(patch[key]+direction*delta,lo,hi);
      if(value===patch[key])continue;
      const candidate={...patch,[key]:value},trial=loss(candidate);
      if(trial.loss<best.loss-1e-8){patch=candidate;best=trial;}
    }
  }
  patch={...patch,exposure:Math.round(patch.exposure*100)/100};
  for(const key of AUTO_TONE_KEYS)if(key!=='exposure')patch[key]=Math.round(patch[key]);
  const after=distribution(patch);
  return finish(patch,after);
}
