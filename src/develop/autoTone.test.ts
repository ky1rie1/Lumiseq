import { describe, expect, it } from 'vitest';
import { computeAutoTone, neutralToneSettings } from './autoTone';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';
import { applyBaseTone, linearToSrgb, srgbToLinear } from '../engine/developColorMath';
const pixels = (values: number[]) => new Uint8ClampedArray(values.flatMap(v => [v,v,v,255]));
describe('scene adaptive auto tone', () => {
 const rendered = (value:number, patch:NonNullable<ReturnType<typeof computeAutoTone>>) =>
  linearToSrgb(applyBaseTone([srgbToLinear(value/255),srgbToLinear(value/255),srgbToLinear(value/255)],patch)[0]);
 it('preserves intentional high and low key scenes while brightening a broad dark scene',()=>{
  expect(computeAutoTone(pixels([80,80,80]))!.exposure).toBe(0);
  expect(computeAutoTone(pixels([200,200,200]))!.exposure).toBe(0);
  const patch=computeAutoTone(pixels([25,35,45,55,65,75,85]))!;
  expect(patch.exposure).toBeGreaterThanOrEqual(.8);
  expect(rendered(45,patch)).toBeGreaterThan(45/255+.08);
 });
 it('uses highlight compression to brighten shadows without blowing a bright tail', () => {
  const patch=computeAutoTone(pixels([35,40,45,50,55,60,65,70,75,230]))!;
  expect(patch.exposure).toBeGreaterThan(.3);
  expect(patch.highlights).toBeLessThan(0);
  expect(rendered(230,patch)).toBeLessThanOrEqual(.985);
  expect(rendered(50,patch)).toBeGreaterThan(50/255+.05);
 });
 it('does not drag bright scenes toward middle gray or exaggerate moderate tone', () => {
  expect(computeAutoTone(pixels([180,200,220,240,255]))!.exposure).toBeGreaterThanOrEqual(-.25);
  expect(Math.abs(computeAutoTone(pixels([100,110,120,130,140]))!.contrast)).toBeLessThanOrEqual(12);
 });
 it('ignores a rare clipped specular while exposing a predominantly dark scene', () => {
  const patch=computeAutoTone(pixels([...Array.from({length:99},(_,i)=>40+i%21),255]))!;
  expect(patch.exposure).toBeGreaterThan(.5);
 });
 it('does not clip a saturated color channel when luminance suggests underexposure',()=>{
  const patch=computeAutoTone(new Uint8ClampedArray([255,0,0,255,0,0,255,255,0,255,0,255]))!;
  expect(patch.exposure).toBe(0);
  expect(patch.whites).toBe(0);
 });
 it('does not invent detail in black, white or empty input', () => {
  expect(computeAutoTone(pixels([0,0,0]))!.exposure).toBe(0);
  expect(computeAutoTone(pixels([255,255]))!.exposure).toBe(0);
  expect(computeAutoTone(new Uint8ClampedArray([20,20,20,0]))).toBeNull();
 });
 it('neutralizes all automatic tone controls for repeatable baseline analysis', () => {
  const s = createDefaultDevelopSettings(true); s.exposure=2; s.contrast=20; s.saturation=18;
  const baseline=neutralToneSettings(s);
  expect(baseline.exposure).toBe(0); expect(baseline.contrast).toBe(0);
  expect(baseline.highlights).toBe(0); expect(baseline.shadows).toBe(0);
  expect(baseline.whites).toBe(0); expect(baseline.blacks).toBe(0);
  expect(baseline.whiteBalance).toEqual(s.whiteBalance); expect(baseline.masks).toEqual(s.masks);
  expect(baseline.saturation).toBe(18); expect(s.exposure).toBe(2);
 });
 it('keeps results finite and bounded for saturated and strongly skewed scenes',()=>{
  for(const data of [new Uint8ClampedArray([255,0,0,255,0,0,255,255]),pixels([0,0,0,1,255])]){
   const patch=computeAutoTone(data)!;
   for(const value of Object.values(patch))expect(Number.isFinite(value)).toBe(true);
   expect(Math.abs(patch.exposure)).toBeLessThanOrEqual(1.5);expect(Math.abs(patch.highlights)).toBeLessThanOrEqual(75);
  }
 });
});
