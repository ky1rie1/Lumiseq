import {expect,it} from 'vitest';
import {compositeFloatPixel} from './compositing';
import {decodeEncoded,encodeLinear} from './adjustments';
import type {BlendMode} from '../../types/edit';
it('preserves signed HDR normal colors and computes source over alpha',()=>{
  const out=compositeFloatPixel([2,-1,.4,.5],[.2,.4,1,.5],'normal',1);
  [1.4,-.5333333333333333,.6,.75].forEach((v,i)=>expect(out[i]).toBeCloseTo(v,12));
});
it('evaluates all separable W3C modes in the specified blend domain',()=>{
  const src=[decodeEncoded(.7),decodeEncoded(.2),decodeEncoded(.4),1],dst=[decodeEncoded(.3),decodeEncoded(.6),decodeEncoded(.8),1];
  const refs:Partial<Record<BlendMode,number[]>>={multiply:[.21,.12,.32],screen:[.79,.68,.88],overlay:[.42,.36,.76],'hard-light':[.58,.24,.64],difference:[.4,.4,.4],exclusion:[.58,.56,.56],'color-dodge':[1,.75,1],'color-burn':[0,0,.5]};
  for(const [mode,expected] of Object.entries(refs)){const out=compositeFloatPixel(src,dst,mode as BlendMode,1);expected!.forEach((v,i)=>expect(encodeLinear(out[i])).toBeCloseTo(v,8));}
});
it('does not truncate signed and HDR encoded excursions in artistic dodge and burn',()=>{
  const dodge=compositeFloatPixel([2,2,2,1],[4,4,4,1],'color-dodge',1);
  const burn=compositeFloatPixel([-.2,-.2,-.2,1],[-.3,-.3,-.3,1],'color-burn',1);
  expect(dodge[0]).toBeGreaterThan(1);expect(burn[0]).toBeLessThan(0);
});
it('retains transparent-destination source color for every blend mode',()=>{
  const modes:BlendMode[]=['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity'];
  for(const mode of modes){const out=compositeFloatPixel([2,-.2,.6,.4],[0,0,0,0],mode,.5);[2,-.2,.6,.2].forEach((v,i)=>expect(out[i]).toBeCloseTo(v,8));}
});
it('uses W3C nonseparable luminosity instead of HSL lightness',()=>{
  const out=compositeFloatPixel([1,0,0,1],[0,1,0,1],'luminosity',1);
  const encode=(v:number)=>v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055;
  expect(encode(out[0])*.3+encode(out[1])*.59+encode(out[2])*.11).toBeCloseTo(.3,5);
});
