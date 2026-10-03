import { describe, expect, it } from 'vitest';
import { computeFloatAutoTone } from './floatAutoTone';
import type { RGB } from '../engine/developColorMath';

const ramp=(lo:number,hi:number,count=512):RGB[]=>Array.from({length:count},(_,i)=>{
 const y=lo+(hi-lo)*i/(count-1); return [y,y,y];
});
describe('float joint automatic tone quality',()=>{
 it('reduces broad overexposure using real highlight headroom',()=>{
  const result=computeFloatAutoTone(ramp(.4,2.5));
  expect(result!.patch.exposure).toBeLessThan(0);
  expect(result!.evidence.sourcePeak).toBeGreaterThan(1);
  expect(result!.evaluations).toBeLessThanOrEqual(256);
 });
 it('jointly adjusts a broad underexposed scene instead of only adding exposure',()=>{
  const result=computeFloatAutoTone(ramp(.0003,.08));
  expect(result!.patch.exposure).toBeGreaterThan(.5);
  expect(['contrast','highlights','shadows','whites','blacks'].some(key=>result!.patch[key as keyof NonNullable<typeof result>['patch']]!==0)).toBe(true);
  expect(result!.evidence.after.median).toBeGreaterThan(result!.evidence.before.median);
 });
 it('preserves intentional constant low and high key fields',()=>{
  for(const value of [.001,.8,2])expect(computeFloatAutoTone(ramp(value,value))!.patch).toEqual({exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0});
 });
 it('protects a night sky with sparse stars rather than turning it into daylight',()=>{
  const samples=ramp(.0005,.012,1024);samples.push([1.8,1.4,1.1],[2.4,1.8,1.5]);
  const result=computeFloatAutoTone(samples,{tailSamples:[[3,2.5,2]]});
  expect(result!.evidence.scene).toBe('low-key');
  expect(result!.evidence.after.median).toBeLessThan(.05);
  expect(result!.patch.exposure).toBeLessThan(3);
 });
 it('retains finite outcomes for signed and saturated float sources',()=>{
  const result=computeFloatAutoTone([[-.2,.01,.1],[.1,1.2,.2],[2,.02,-.1],[.3,.3,.3]]);
  expect(Object.values(result!.patch).every(Number.isFinite)).toBe(true);
  expect(result!.evidence.sourcePeak).toBe(2);
  expect(computeFloatAutoTone([])).toBeNull();
  expect(()=>computeFloatAutoTone([[NaN,0,0]])).toThrow(/finite/i);
 });
 it('returns a bounded deterministic result and checks cancellation during optimization',()=>{
  const samples=ramp(.003,.6);expect(computeFloatAutoTone(samples)).toEqual(computeFloatAutoTone(samples));
  const signal=new AbortController(); signal.abort();
  expect(()=>computeFloatAutoTone(samples,{signal:signal.signal})).toThrow(/cancel/i);
 });
});
