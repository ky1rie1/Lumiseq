import { describe, expect, it } from 'vitest';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';
import { applyBaseTone, applyDevelopColor, applyRelativeWhiteBalance, buildDevelopCurveLUT, curvesAreNeutral, linearToSrgb, luminance, relativeWhiteBalanceMatrix, sampleDevelopCurve, srgbToLinear, type RGB } from './developColorMath';
describe('develop color contract',()=>{
 it('round trips the full display ramp with neutral settings and camera WB metadata',()=>{
  const settings=createDefaultDevelopSettings(true);settings.whiteBalance.cameraMultipliers=[2.3,1,1.7,1];
  const lut=buildDevelopCurveLUT(settings.curves),matrix=relativeWhiteBalanceMatrix(settings.whiteBalance);
  for(let i=0;i<256;i++){
   const input=[i/255,(255-i)/255,Math.floor(i/2)/255] as RGB;
   const linear=input.map(srgbToLinear) as RGB;
   const result=applyDevelopColor(applyBaseTone(applyRelativeWhiteBalance(linear,matrix),settings),settings,lut);
   expect(result.map(v=>Math.round(linearToSrgb(v)*255))).toEqual(input.map(v=>Math.round(v*255)));
  }
 });
 it('retains HDR channel differences through neutral color controls',()=>{
  const settings=createDefaultDevelopSettings(true),input:RGB=[1.6,.8,.2];
  expect(applyDevelopColor(input,settings,buildDevelopCurveLUT(settings.curves))).toEqual(input);
  expect(sampleDevelopCurve(1.5,buildDevelopCurveLUT(settings.curves),0)).toBeCloseTo(1.5,6);
 });
 it('uses bounded Bradford adaptation with exact neutral and preserves luminance',()=>{
  const neutral=relativeWhiteBalanceMatrix({mode:'custom',temperature:5500,tint:0});
  expect(neutral).toEqual([1,0,0,0,1,0,0,0,1]);
  for(const temperature of [2000,4000,5500,9500,12000])for(const tint of [-150,0,150]){
   const input:RGB=[.3,.2,.1],matrix=relativeWhiteBalanceMatrix({mode:'custom',temperature,tint});
   expect(matrix.every(Number.isFinite)).toBe(true);
   expect(luminance(applyRelativeWhiteBalance(input,matrix))).toBeCloseTo(luminance(input),7);
  }
 });
 it('retains channel ratios for simultaneous exposure, tone endpoints, and contrast',()=>{
  const settings=createDefaultDevelopSettings(false);Object.assign(settings,{exposure:.4,highlights:-40,shadows:35,whites:-20,blacks:20,contrast:30});
  const result=applyBaseTone([.4,.2,.1],settings);
  expect(result[0]/result[1]).toBeCloseTo(2,8);expect(result[2]/result[1]).toBeCloseTo(.5,8);
 });
 it('does not classify a horizontal or missing endpoint curve as neutral',()=>{
  const settings=createDefaultDevelopSettings(false);
  expect(curvesAreNeutral(settings.curves)).toBe(true);
  settings.curves.rgb=[{x:.5,y:.5}];expect(curvesAreNeutral(settings.curves)).toBe(false);
 });
 it('supplies cross language reference values for relative WB',()=>{
  const result=applyRelativeWhiteBalance([.3,.3,.3],relativeWhiteBalanceMatrix({mode:'custom',temperature:9500,tint:100}));
  // Independent matrix evaluation fixture, also checked by Rust to detect drift.
  [0.376311,0.28533526,0.22056096].forEach((expected,c)=>expect(result[c]).toBeCloseTo(expected,6));
 });
});
