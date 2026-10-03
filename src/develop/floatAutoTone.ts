import { applyBaseTone, applyDevelopColor, luminance, type RGB } from '../engine/developColorMath';
import type { DevelopSettings } from '../types/develop';
import { AUTO_TONE_KEYS, type AutoTonePatch } from './autoTone';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';

type Scene = 'general' | 'low-key' | 'high-key' | 'uniform';
export interface FloatToneDistribution { black: number; shadow: number; median: number; white: number; clipFraction: number }
export interface FloatAutoToneOptions {
  tailSamples?: readonly RGB[];
  renderingVersion?: 1 | 2;
  signal?: AbortSignal;
  /** Production point transformations, including preserved WB/color/mask intent. */
  evaluate?: (rgb: RGB, patch: AutoTonePatch & Partial<Pick<DevelopSettings,'saturation'|'vibrance'>>, sourceIndex: number, tail: boolean) => RGB;
  budgetMs?: number;
}

export const NATURAL_AUTO_COLOR_KEYS = [...AUTO_TONE_KEYS,'saturation','vibrance'] as const;
export type NaturalAutoColorPatch = AutoTonePatch & Pick<DevelopSettings,'saturation'|'vibrance'>;
export interface NaturalSemanticColorCandidate {
 intent:'natural'|'low-key'|'high-key';
 regions:{x:number;y:number;width:number;height:number}[];
 parameters:NaturalAutoColorPatch;
 visionStatus?:'ready'|'failed';
}
export interface NaturalAutoColorOptions extends FloatAutoToneOptions {
 positions?: readonly [number,number][];
 semanticCandidate?:NaturalSemanticColorCandidate;
}
export interface NaturalAutoColorResult {
 patch: NaturalAutoColorPatch;
 evaluations: number;
 evidence: Omit<FloatAutoToneResult['evidence'],'algorithm'> & {
  algorithm:'natural-linear-v2';
  sceneConfidence:{lowKey:number;highKey:number;narrow:number};
  blockContext:{cell:number;sampleCount:number;median:number;channelPeak:number;meanSaturation:number;luminanceDeviation:number}[];
  semantic?:{status:'accepted'|'local-retained'|'vision-unavailable';reason?:string;intent:NaturalSemanticColorCandidate['intent'];
   localScore:number;neutralScore:number;candidateScore?:number;regionSampleCounts:number[];roundedRecipeVerified:boolean};
  safety:{validationCount:number;fitCount:number;newClippedPixelFraction:number;roundedRecipeVerified:true;
   tailCount:number;tailPeakBefore:number;tailPeakAfter:number;fallbackReason?:string;
   fallbackRefit?:{strategy:'exposure-fixed-zero';accepted:boolean;neutralScore:number;previousScore:number;refitScore:number};
   blockCount:number;maxShadowGain:number;maxHueDrift:number;spatialDetailVerified:false};
 };
}

/** Fits scene-adaptive intervals, then independently verifies the delivered rounded recipe. */
export function computeNaturalAutoColor(samples:readonly RGB[],options:NaturalAutoColorOptions={}):NaturalAutoColorResult|null {
 if(!samples.length)return null;
 const tails=options.tailSamples??[];
 if(samples.length+tails.length>65536||tails.length>512)throw new Error('Automatic color sample size limit exceeded');
 for(const rgb of [...samples,...tails])if(rgb.length!==3||!rgb.every(Number.isFinite))throw new Error('Automatic color requires finite RGB samples');
 if(options.positions&&(options.positions.length!==samples.length||options.positions.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1))))throw new Error('Automatic color requires valid source coordinates');
 const started=performance.now(),budget=Math.min(5000,Math.max(1,options.budgetMs??5000));
 const check=()=>{if(options.signal?.aborted)throw new Error('Automatic color analysis cancelled');if(performance.now()-started>budget)throw new Error('Automatic color analysis timed out');};
 check();
 const zero=():NaturalAutoColorPatch=>({...neutral(),saturation:0,vibrance:0});
 const colorDefaults=createDefaultDevelopSettings(false);
 const evaluate=options.evaluate??((rgb:RGB,patch:NaturalAutoColorPatch)=>{
  const toned=applyBaseTone(rgb,{...patch,renderingVersion:options.renderingVersion??2});
  // The production evaluator retains curves and HSL; this direct API uses neutral color settings.
  return applyDevelopColor(toned,{...colorDefaults,...patch},new Float32Array());
 });
 const finite=(rgb:RGB)=>{if(!rgb.every(Number.isFinite))throw new Error('Automatic color produced nonfinite working pixels');return rgb;};
 const baseline=samples.map((rgb,i)=>{if(i%256===0)check();return finite(evaluate(rgb,zero(),i,false));});
 const fitCount=Math.min(1024,samples.length);
 // Different offsets per stratum prevent a regular source pattern from sharing the fitting period.
 const fit=Array.from({length:fitCount},(_,i)=>{
  const lo=Math.floor(i*samples.length/fitCount),hi=Math.floor((i+1)*samples.length/fitCount);
  const hash=Math.imul(i+1,0x45d9f3b)>>>0;
  return lo+hash%Math.max(1,hi-lo);
 });
 let evaluations=0;
 const stats=(colors:readonly RGB[]):FloatToneDistribution=>{
  const values=colors.map(rgb=>Math.max(0,luminance(rgb))).sort((a,b)=>a-b);
  return {black:quantile(values,.02),shadow:quantile(values,.1),median:quantile(values,.5),white:quantile(values,.98),clipFraction:colors.filter(rgb=>rgb.some(v=>v>1)).length/colors.length};
 };
 const before=stats(baseline),ys=baseline.map(rgb=>Math.max(0,luminance(rgb))).sort((a,b)=>a-b);
 const darkFraction=ys.filter(y=>y<.02).length/ys.length;
 let sourcePeak=-Infinity;
 for(const collection of [samples,tails])for(const rgb of collection)sourcePeak=Math.max(sourcePeak,rgb[0],rgb[1],rgb[2]);
 const smooth=(v:number)=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
 const lowKey=smooth((.025-before.median)/.02)*smooth((darkFraction-.6)/.25)*smooth((sourcePeak-Math.max(.15,quantile(ys,.9)*4))/.2);
 const highKey=smooth((before.median-.25)/.2)*smooth((before.shadow-.09)/.12);
 const narrow=1-smooth((before.white-before.shadow)/.08);
 const scene:Scene=narrow>.95?'uniform':lowKey>.5?'low-key':highKey>.5?'high-key':'general';
 const mix=(normal:number,dark:number,bright:number)=>normal*(1-lowKey)*(1-highKey)+dark*lowKey+bright*highKey*(1-lowKey);
 const intervals={median:[mix(.075,.002,.30),mix(.30,.03,.75)],shadow:[mix(.008,.0003,.10),mix(.18,.025,.55)],
  black:[0,mix(.035,.004,.25)],white:[mix(.55,.03,.55),mix(1.02,1.1,1.1)]};
 for(const key of ['median','shadow','black','white'] as const){
  intervals[key][0]*=1-narrow;intervals[key][1]=Math.max(intervals[key][1],before[key]*narrow);
 }
 const intervalLoss=(value:number,range:number[])=>value<range[0]?logDistance(value,range[0])**2:value>range[1]?logDistance(value,range[1])**2:0;
 const saturation=(rgb:RGB)=>{const peak=Math.max(...rgb),lo=Math.min(...rgb);return peak>1e-6?clamp((peak-lo)/peak,0,1):0;};
 const sourceSat=baseline.reduce((sum,rgb)=>sum+saturation(rgb),0)/baseline.length;
 const warmFraction=baseline.filter(rgb=>rgb[0]>rgb[1]&&rgb[1]>rgb[2]&&rgb[0]>rgb[2]*1.15).length/baseline.length;
 const desiredVibrance=sourceSat>.02&&sourceSat<.35?Math.min(10,(.35-sourceSat)*25)*(1-warmFraction)* (1-lowKey):0;
 const score=(patch:NaturalAutoColorPatch)=>{
  check();evaluations++;
  const output=fit.map(i=>finite(evaluate(samples[i],patch,i,false))),s=stats(output);
  let clips=0;
  for(let n=0;n<fit.length;n++)if(output[n].some((v,c)=>v>1&&baseline[fit[n]][c]<=1))clips++;
  const regularization=NATURAL_AUTO_COLOR_KEYS.reduce((sum,key)=>sum+(patch[key]/(key==='exposure'?2:35))**2,0)*.28;
  return intervalLoss(s.median,intervals.median)*2+intervalLoss(s.shadow,intervals.shadow)*.22+
   intervalLoss(s.black,intervals.black)*.08+intervalLoss(s.white,intervals.white)*.35+
   clips/fit.length*40+regularization+((patch.vibrance-desiredVibrance)/35)**2*.4+
   (sourceSat>.5?Math.max(0,patch.saturation,patch.vibrance)**2*.02:0);
 };
 const bounds:Record<keyof NaturalAutoColorPatch,[number,number]>={exposure:[-3,lowKey>.5?1:3],contrast:[-20,20],
  highlights:[-85,25],shadows:[-25,35],whites:[-25,25],blacks:[-20,20],saturation:[-8,sourceSat>.5?0:5],vibrance:[-8,sourceSat>.5?0:12]};
 let patch=zero(),best=score(patch);
 for(const step of [1,.5,.2,.08])for(const key of NATURAL_AUTO_COLOR_KEYS)for(const direction of [-1,1]){
  const [lo,hi]=bounds[key],value=clamp(patch[key]+direction*step*(key==='exposure'?.8:12),lo,hi);
  if(value===patch[key])continue;
  const candidate={...patch,[key]:value},loss=score(candidate);
  if(loss<best-1e-8){patch=candidate;best=loss;}
 }
 const rounded=(candidate:NaturalAutoColorPatch)=>Object.fromEntries(NATURAL_AUTO_COLOR_KEYS.map(key=>[key,key==='exposure'?Math.round(candidate[key]*100)/100:Math.round(candidate[key])])) as unknown as NaturalAutoColorPatch;
 const blocks=new Set(options.positions?.map(p=>Math.floor(Math.min(.99999,p[0])*8)+8*Math.floor(Math.min(.99999,p[1])*8))??[]);
 const blockSamples=new Map<number,number[]>();
 options.positions?.forEach((p,i)=>{
  const cell=Math.floor(Math.min(.99999,p[0])*8)+8*Math.floor(Math.min(.99999,p[1])*8);
  const indices=blockSamples.get(cell)??[];indices.push(i);blockSamples.set(cell,indices);
 });
 const blockContext=[...blockSamples].map(([cell,indices])=>{
  const values=indices.map(i=>luminance(baseline[i])).sort((a,b)=>a-b),mean=values.reduce((sum,v)=>sum+v,0)/values.length;
  let channelPeak=-Infinity;
  for(const i of indices)channelPeak=Math.max(channelPeak,samples[i][0],samples[i][1],samples[i][2]);
  return {cell,sampleCount:indices.length,median:quantile(values,.5),channelPeak,
   meanSaturation:indices.reduce((sum,i)=>sum+saturation(baseline[i]),0)/indices.length,
   luminanceDeviation:Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/values.length)};
 });
 const verify=(candidate:NaturalAutoColorPatch)=>{
  const output:RGB[]=[];let clipped=0,maxShadowGain=1,maxHueDrift=0,newCrushed=0;
  let reason:string|undefined;
  for(let i=0;i<samples.length;i++){
   if(i%256===0)check();const rgb=finite(evaluate(samples[i],candidate,i,false)),old=baseline[i];output.push(rgb);
   if(rgb.some((v,c)=>v>1&&old[c]<=1))clipped++;
   const a=luminance(old),b=luminance(rgb);
   if(a>.0005&&a<.02)maxShadowGain=Math.max(maxShadowGain,b/a);
   if(a>.003&&b<=0)newCrushed++;
   const ac=old.map(v=>v-a),bc=rgb.map(v=>v-b),norm=Math.hypot(...ac)*Math.hypot(...bc);
   if(norm>1e-8&&saturation(old)>.12&&a>.01)maxHueDrift=Math.max(maxHueDrift,Math.acos(clamp(ac.reduce((sum,v,c)=>sum+v*bc[c],0)/norm,-1,1)));
  }
  const fraction=clipped/samples.length;
  if(fraction>.003)reason='rounded recipe adds clipped channels';
  else if(newCrushed/samples.length>.003)reason='rounded recipe crushes shadow structure';
  else if(maxHueDrift>.15)reason='rounded recipe shifts retained color hue';
  else if(lowKey>.5&&maxShadowGain>2.5)reason='rounded recipe amplifies low-key noise';
  // Nearby transported samples bound local contrast amplification without claiming full spatial detail.
  if(options.positions)for(let i=1;i<samples.length;i++){
   const p=options.positions[i],q=options.positions[i-1];if(Math.hypot(p[0]-q[0],p[1]-q[1])>.03)continue;
   const a=luminance(baseline[i]),b=luminance(baseline[i-1]),difference=a-b;
   if(a>.0005&&b>.0005&&Math.max(a,b)<.04&&Math.abs(difference)>1e-5){
    const delta=luminance(output[i])-luminance(output[i-1]);
    if(delta*difference< -1e-8||(lowKey>.5&&Math.abs(delta/difference)>3))reason='rounded recipe disturbs nearby dark structure';
   }
  }
  let tailPeakBefore=0,tailPeakAfter=0;
  for(let i=0;i<tails.length;i++){
   check();const old=finite(evaluate(tails[i],zero(),i,true)),rgb=finite(evaluate(tails[i],candidate,i,true));
   tailPeakBefore=Math.max(tailPeakBefore,...old);tailPeakAfter=Math.max(tailPeakAfter,...rgb);
   if(rgb.some((v,c)=>old[c]>1&&v>old[c]*1.1))reason='rounded recipe worsens existing highlight extrema';
  }
  return {reason,output,safety:{validationCount:samples.length,fitCount,newClippedPixelFraction:fraction,roundedRecipeVerified:true as const,
   tailCount:tails.length,tailPeakBefore,tailPeakAfter,blockCount:blocks.size,maxShadowGain,maxHueDrift,spatialDetailVerified:false as const}};
 };
 patch=rounded(patch);let validation=verify(patch),fallbackReason=validation.reason;
 if(validation.reason)for(const shoulder of [-20,-40,-60,-85]){
  if(shoulder>=patch.highlights)continue;
  const candidate={...patch,highlights:shoulder},trial=verify(candidate);
  if(!trial.reason){patch=candidate;validation=trial;break;}
 }
 // Every fallback is rounded and rechecked. A scaled floating candidate is never accepted blindly.
 if(validation.reason)for(const scale of [.75,.5,.25,0]){
  const candidate=rounded(Object.fromEntries(NATURAL_AUTO_COLOR_KEYS.map(key=>[key,patch[key]*scale])) as unknown as NaturalAutoColorPatch);
  const trial=verify(candidate);if(!trial.reason){patch=candidate;validation=trial;break;}
 }
 if(validation.reason)throw new Error('Automatic color neutral safety verification failed');
 let fallbackRefit:NaturalAutoColorResult['evidence']['safety']['fallbackRefit'];
 if(fallbackReason){
  const neutralScore=score(zero()),previousScore=score(patch);
  let refit=zero(),refitScore=neutralScore;
  const tailBaseline=tails.map((rgb,i)=>finite(evaluate(rgb,zero(),i,true)));
  // Exposure can amplify sparse HDR colors which a luminance shoulder cannot contain.
  // Refit the other controls from neutral, keeping the exact rounded extrema feasible.
  for(const step of [1,.5,.2,.08])for(const key of NATURAL_AUTO_COLOR_KEYS){
   if(key==='exposure')continue;
   for(const direction of [-1,1]){
    check();
    const [lo,hi]=bounds[key],value=clamp(refit[key]+direction*step*12,lo,hi);
    const candidate=rounded({...refit,[key]:value});if(candidate[key]===refit[key])continue;
    const worsensTail=tails.some((rgb,i)=>finite(evaluate(rgb,candidate,i,true)).some((v,c)=>tailBaseline[i][c]>1&&v>tailBaseline[i][c]*1.1));
    if(worsensTail)continue;
    const loss=score(candidate);if(loss<refitScore-1e-8){refit=candidate;refitScore=loss;}
   }
  }
  fallbackRefit={strategy:'exposure-fixed-zero',accepted:false,neutralScore,previousScore,refitScore};
  if(refitScore<Math.min(neutralScore,previousScore)-1e-8){
   const trial=verify(refit);
   if(!trial.reason){patch=refit;validation=trial;fallbackRefit.accepted=true;}
  }
 }
 let semantic:NaturalAutoColorResult['evidence']['semantic'];
 const proposal=options.semanticCandidate;
 if(proposal){
  const localScore=score(patch),neutralScore=score(zero());
  semantic={status:'local-retained',intent:proposal.intent,localScore,neutralScore,regionSampleCounts:[],roundedRecipeVerified:false};
  if(proposal.visionStatus==='failed'){semantic.status='vision-unavailable';semantic.reason='Vision unavailable; verified local recipe retained';}
  else if(!['natural','low-key','high-key'].includes(proposal.intent)||!proposal.parameters||
   Object.keys(proposal.parameters).length!==8||NATURAL_AUTO_COLOR_KEYS.some(key=>!Number.isFinite(proposal.parameters[key])||proposal.parameters[key]<bounds[key][0]||proposal.parameters[key]>bounds[key][1])||
   !Array.isArray(proposal.regions)||proposal.regions.length<1||proposal.regions.length>8||proposal.regions.some(r=>
    ![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1||r.y+r.height>1))semantic.reason='Semantic safety bounds or regions invalid';
  else {
   const candidate=rounded(proposal.parameters),trial=verify(candidate);semantic.roundedRecipeVerified=true;
   let regionReason:string|undefined;
   for(const region of proposal.regions){
    const covered=options.positions?.flatMap((p,i)=>p[0]>=region.x&&p[0]<=region.x+region.width&&p[1]>=region.y&&p[1]<=region.y+region.height?[i]:[])??[];
    semantic.regionSampleCounts.push(covered.length);
    if(covered.length<32)regionReason='Semantic region lacks enough transported numerical samples';
    else if(covered.filter(i=>trial.output[i].some((v,c)=>v>1&&baseline[i][c]<=1)).length/covered.length>.003)regionReason='Semantic region clipped-channel safety failed';
   }
   const candidateScore=score(candidate);semantic.candidateScore=candidateScore;
   if(trial.reason||regionReason)semantic.reason=trial.reason??regionReason;
   else if(candidateScore>=Math.min(localScore,neutralScore)-1e-8)semantic.reason='Verified local or neutral recipe has equal or better natural score';
   else {patch=candidate;validation=trial;semantic.status='accepted';}
  }
 }
 return {patch,evaluations,evidence:{algorithm:'natural-linear-v2',scene,sourcePeak,sampleCount:samples.length,before,after:stats(validation.output),precision:'linear-float',
  sceneConfidence:{lowKey,highKey,narrow},blockContext,...(semantic?{semantic}:{}),safety:{...validation.safety,...(fallbackReason?{fallbackReason}:{}),...(fallbackRefit?{fallbackRefit}:{})}}};
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
