import { describe, expect, it } from 'vitest';
import { computeNaturalAutoColor } from './floatAutoTone';
import { applyBaseTone, type RGB } from '../engine/developColorMath';

const gray=(lo:number,hi:number,count=2048):RGB[]=>Array.from({length:count},(_,i)=>{const y=lo+(hi-lo)*i/(count-1);return [y,y,y];});
describe('natural automatic color',()=>{
 it('keeps an already broad balanced scene natural',()=>{
  const y=Array.from({length:2048},(_,i)=>.003+.877*(i/2047)**2);
  const result=computeNaturalAutoColor(y.map(v=>[v,v,v]));
  expect(Math.abs(result!.patch.contrast)).toBeLessThan(25);
  expect(Math.abs(result!.patch.shadows)).toBeLessThan(40);
  expect(result!.patch.saturation).toBe(0);
  expect(result!.patch.vibrance).toBe(0);
  expect(result!.evidence.algorithm).toBe('natural-linear-v2');
 });
 it('improves broad underexposure and preserves high-key and night intent',()=>{
  const dark=computeNaturalAutoColor(gray(.001,.08))!;
  expect(dark.patch.exposure).toBeGreaterThan(.5);
  expect(dark.evidence.after.median).toBeGreaterThan(dark.evidence.before.median);
  const night=gray(.0005,.012);night.push([2,1.5,1]);
  const result=computeNaturalAutoColor(night,{tailSamples:[[3,2,1]]})!;
  expect(result.evidence.after.median).toBeLessThan(.04);
  expect(result.evidence.sceneConfidence.lowKey).toBeGreaterThan(.5);
  expect(Math.abs(computeNaturalAutoColor(gray(.3,.9))!.patch.exposure)).toBeLessThan(.5);
 });
 it('avoids strengthening saturated colors and preserves the neutral axis',()=>{
  const result=computeNaturalAutoColor(Array.from({length:2048},(_,i)=>[.4+i/4096,.02,.01] as RGB))!;
  expect(result.patch.saturation).toBeLessThanOrEqual(0);
  expect(result.patch.vibrance).toBeLessThanOrEqual(0);
  expect(result.evidence.safety.newClippedPixelFraction).toBeLessThanOrEqual(.003);
 });
 it('validates the rounded candidate against dense samples missed by a periodic fitting grid',()=>{
  const samples=gray(.001,.08,16384);
  for(let i=0;i<samples.length;i++)if(i%16===1)samples[i]=[.99,.3,.1];
  const result=computeNaturalAutoColor(samples)!;
  let clips=0;
  for(const pixel of samples){const output=applyBaseTone(pixel,result.patch);if(output.some((v,c)=>v>1&&pixel[c]<=1))clips++;}
  expect(clips/samples.length).toBeLessThanOrEqual(.003);
  expect(result.evidence.safety.validationCount).toBe(samples.length);
  expect(result.evidence.safety.roundedRecipeVerified).toBe(true);
  expect(result.evidence.safety.tailCount).toBe(0);
 });
 it('falls back when only the actual rounded recipe violates safety',()=>{
  const samples=gray(.001,.08);
  const result=computeNaturalAutoColor(samples,{evaluate:(rgb,patch)=>{
   if(patch.exposure>0&&patch.exposure===Math.round(patch.exposure*100)/100)return [1.1,1.1,1.1];
   return applyBaseTone(rgb,patch);
  }})!;
  expect(result.patch.exposure).toBe(0);
  expect(result.evidence.safety.fallbackReason).toBeTruthy();
  expect(result.evidence.safety.newClippedPixelFraction).toBe(0);
 });
 it('records extrema separately and rejects malformed and excessive source data',()=>{
  const result=computeNaturalAutoColor(gray(.003,.7),{tailSamples:[[4,3,2]]})!;
  expect(result.evidence.safety.tailCount).toBe(1);
  expect(result.evidence.sourcePeak).toBe(4);
  expect(()=>computeNaturalAutoColor([[NaN,0,0]])).toThrow(/finite/i);
  expect(()=>computeNaturalAutoColor(gray(.1,.2,65537))).toThrow(/limit/i);
 });
 it('does not worsen already out-of-range extrema while lifting a dark representative scene',()=>{
  const result=computeNaturalAutoColor(gray(.001,.08),{tailSamples:[[2,1.5,1.2]]})!;
  expect(result.evidence.safety.tailPeakAfter).toBeLessThanOrEqual(result.evidence.safety.tailPeakBefore*1.1);
  expect(result.evidence.safety.fallbackReason).toBeTruthy();
  expect(result.patch.exposure).toBeGreaterThan(.5);
 });
 it('refits useful dark tones without exposure when sparse saturated HDR stars block the fitted recipe',()=>{
  const samples=Array.from({length:4096},(_,i)=>{
   const p=i/4095,y=p<.5?.0008+p/.5*.01037:p<.82?.01117+(p-.5)/.32*.00883:.02+(p-.82)/.18*.04951;
   return [y,y,y] as RGB;
  });
  const tail:RGB=[.001,.002,4.210332],original=structuredClone(samples);
  const result=computeNaturalAutoColor(samples,{tailSamples:[tail]})!;
  expect(result.evidence.safety.fallbackReason).toMatch(/highlight extrema/);
  expect(result.patch.exposure).toBe(0);
  expect(Object.values(result.patch).some(value=>value!==0)).toBe(true);
  expect(result.evidence.after.median).toBeGreaterThan(result.evidence.before.median*1.05);
  expect(result.evidence.after.median).toBeLessThan(.03);
  expect(result.evidence.safety.maxShadowGain).toBeLessThanOrEqual(2.5);
  expect(result.evidence.safety.maxHueDrift).toBeLessThanOrEqual(.15);
  expect(result.evidence.safety.newClippedPixelFraction).toBeLessThanOrEqual(.003);
  expect(result.evidence.safety.tailPeakAfter).toBeLessThanOrEqual(result.evidence.safety.tailPeakBefore*1.1);
  expect(result.evidence.safety.fallbackRefit?.accepted).toBe(true);
  expect(result.evidence.safety.fallbackRefit!.refitScore).toBeLessThan(result.evidence.safety.fallbackRefit!.neutralScore);
  expect(result.evidence.safety.fallbackRefit!.refitScore).toBeLessThan(result.evidence.safety.fallbackRefit!.previousScore);
  expect(samples).toEqual(original);
 });
 it('does not force an HDR-star night scene away from neutral when the natural objective is already satisfied',()=>{
  const result=computeNaturalAutoColor(gray(.01117,.01117),{tailSamples:[[.001,.002,4.210332]]})!;
  expect(Object.values(result.patch).every(value=>value===0)).toBe(true);
  expect(result.evidence.after).toEqual(result.evidence.before);
  expect(result.evidence.safety.maxShadowGain).toBe(1);
  expect(result.evidence.safety.tailPeakAfter).toBe(result.evidence.safety.tailPeakBefore);
 });
 it('keeps signed source samples immutable and proves a deterministic eight-control recipe',()=>{
  const samples=gray(.003,.7);samples[5]=[-.03,.03,.1];const original=structuredClone(samples);
  const a=computeNaturalAutoColor(samples),b=computeNaturalAutoColor(samples);
  expect(a).toEqual(b);expect(samples).toEqual(original);
  expect(Object.keys(a!.patch)).toHaveLength(8);
  const abort=new AbortController();abort.abort();
  expect(()=>computeNaturalAutoColor(samples,{signal:abort.signal})).toThrow(/cancel/i);
 });
 it('reports bounded spatial block statistics without claiming native detail verification',()=>{
  const samples=gray(.003,.7),positions=samples.map((_,i)=>[(i%64+.5)/64,(Math.floor(i/64)+.5)/32] as [number,number]);
  const result=computeNaturalAutoColor(samples,{positions})!;
  expect(result.evidence.blockContext.length).toBeLessThanOrEqual(64);
  expect(result.evidence.blockContext.reduce((sum,b)=>sum+b.sampleCount,0)).toBe(samples.length);
  expect(result.evidence.blockContext.every(b=>Number.isFinite(b.luminanceDeviation)&&Number.isFinite(b.meanSaturation))).toBe(true);
  expect(result.evidence.safety.spatialDetailVerified).toBe(false);
 });
 it('retains verified local color when an explicit semantic recipe is unsafe or vision failed',()=>{
  const samples=gray(.003,.7),positions=samples.map((_,i)=>[(i+.5)/samples.length,.5] as [number,number]);
  const local=computeNaturalAutoColor(samples,{positions})!;
  const parameters={...local.patch,exposure:3,saturation:5};
  const result=computeNaturalAutoColor(samples,{positions,semanticCandidate:{intent:'natural',regions:[{x:0,y:0,width:1,height:1}],parameters}})!;
  expect(result.patch).toEqual(local.patch);expect(result.evidence.semantic?.status).toBe('local-retained');
  expect(result.evidence.semantic?.reason).toMatch(/clip|safety/i);
  const failed=computeNaturalAutoColor(samples,{positions,semanticCandidate:{intent:'natural',regions:[],parameters:local.patch,visionStatus:'failed'}})!;
  expect(failed.patch).toEqual(local.patch);expect(failed.evidence.semantic?.status).toBe('vision-unavailable');
 });
 it('compares a safe rounded semantic candidate to both local and neutral outcomes',()=>{
  const samples=gray(.003,.7),positions=samples.map((_,i)=>[(i+.5)/samples.length,.5] as [number,number]);
  const local=computeNaturalAutoColor(samples,{positions})!;
  const result=computeNaturalAutoColor(samples,{positions,semanticCandidate:{intent:'natural',regions:[{x:0,y:0,width:1,height:1}],parameters:local.patch}})!;
  expect(result.evidence.semantic?.roundedRecipeVerified).toBe(true);
  expect(result.evidence.semantic?.localScore).toBeGreaterThanOrEqual(0);
  expect(result.evidence.semantic?.neutralScore).toBeGreaterThanOrEqual(0);
  expect(result.evidence.semantic?.regionSampleCounts).toEqual([samples.length]);
 });
});
