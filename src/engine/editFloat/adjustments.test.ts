import { describe, expect, it } from 'vitest';
import { applyFloatAdjustment,decodeEncoded,makeFloatCurve } from './adjustments';
import type {AdjustmentSettings} from '../../types/edit';

describe('float adjustments', () => {
  it('reverses exposure without losing signed and HDR values or adjacent 16 bit levels', () => {
    const d = new Float32Array([.8, -.2, 40000/65535, .7, 40001/65535, 2, .001, 1]);
    const before = d.slice();
    applyFloatAdjustment(d, {type:'exposure',values:{exposure:1}});
    expect(d[0]).toBeCloseTo(1.6, 6);
    applyFloatAdjustment(d, {type:'exposure',values:{exposure:-1}});
    expect([...d]).toEqual([...before]);
    expect(d[4]).toBeGreaterThan(d[2]);
  });
  it('keeps neutral curves exact and endpoint distances signed and HDR', () => {
    const d = new Float32Array([-.2, .42, 2, 1]);
    applyFloatAdjustment(d,{type:'curves',values:{rgb:[{x:0,y:0},{x:255,y:255}]}});
    expect([...d]).toEqual([...new Float32Array([-.2,.42,2,1])]);
  });
  it('has monotonic, flat and reversing shape preserving curves', () => {
    for(const points of [[{x:0,y:0},{x:128,y:100},{x:255,y:255}], [{x:0,y:100},{x:255,y:100}], [{x:0,y:255},{x:128,y:100},{x:255,y:0}]]) {
      const d=new Float32Array(256*4);for(let i=0;i<256;i++)d.set([i/255,i/255,i/255,1],i*4);
      applyFloatAdjustment(d,{type:'curves',values:{rgb:points}});
      for(let i=1;i<256;i++) expect((d[i*4]-d[(i-1)*4])*Math.sign(points[2]?.y-points[0].y || points[1].y-points[0].y || 1)).toBeGreaterThanOrEqual(-1e-6);
    }
  });
  it('keeps every neutral artistic control exactly neutral including signed HDR',()=>{
    const settings:AdjustmentSettings[]=[
      {type:'brightness_contrast',values:{brightness:0,contrast:0}},
      {type:'levels',values:{inputBlack:0,inputWhite:255,inputGamma:1,outputBlack:0,outputWhite:255}},
      {type:'hue_saturation',values:{hue:0,saturation:0,lightness:0}},
      {type:'color_balance',values:{shadows:{cyanRed:0,magentaGreen:0,yellowBlue:0},midtones:{cyanRed:0,magentaGreen:0,yellowBlue:0},highlights:{cyanRed:0,magentaGreen:0,yellowBlue:0},preserveLuminosity:true}},
    ];
    for(const s of settings){const data=new Float32Array([-.2,.8,2,.43]);applyFloatAdjustment(data,s);expect([...data]).toEqual([...new Float32Array([-.2,.8,2,.43])]);}
  });
  it('applies every existing control in its specified domain with signed gamma',()=>{
    let d=new Float32Array([-.25,1,4,.3]);applyFloatAdjustment(d,{type:'exposure',values:{exposure:0,gamma:2,offset:0}});expect(d[0]).toBe(-.5);expect(d[2]).toBe(2);expect(d[3]).toBeCloseTo(.3);
    d=new Float32Array([decodeEncoded(.25),decodeEncoded(.5),decodeEncoded(.75),1]);
    applyFloatAdjustment(d,{type:'levels',values:{inputBlack:0,inputWhite:255,inputGamma:2,outputBlack:0,outputWhite:255}});expect(d[0]).toBeCloseTo(decodeEncoded(.5),6);
    d=new Float32Array([1,0,0,1]);applyFloatAdjustment(d,{type:'hue_saturation',values:{hue:120,saturation:0,lightness:0}});expect([...d]).toEqual([0,1,0,1]);
    d=new Float32Array([1,0,0,1]);applyFloatAdjustment(d,{type:'black_and_white',values:{reds:100,yellows:0,greens:0,cyans:0,blues:0,magentas:0}});expect([...d]).toEqual([1,1,1,1]);
    d=new Float32Array([.2,.3,.4,1]);applyFloatAdjustment(d,{type:'color_balance',values:{shadows:{cyanRed:20,magentaGreen:0,yellowBlue:0},midtones:{cyanRed:20,magentaGreen:0,yellowBlue:0},highlights:{cyanRed:20,magentaGreen:0,yellowBlue:0},preserveLuminosity:false}});expect(d[0]).toBeGreaterThan(.2);expect(d[1]).toBeCloseTo(.3,6);
    d=new Float32Array([1,-1,2,1]);applyFloatAdjustment(d,{type:'brightness_contrast',values:{brightness:20,contrast:50}});expect(d[0]).toBeGreaterThan(1);expect(d[1]).toBeLessThan(0);
  });
  it('preserves endpoint distance and handles duplicates and malformed curve points',()=>{
    const curve=makeFloatCurve([{x:0,y:50},{x:128,y:100},{x:128,y:120},{x:255,y:200},{x:NaN,y:20}]);
    expect(curve(-.2)).toBeCloseTo(50/255-.2);expect(curve(2)).toBeCloseTo(200/255+1);
    const flat=makeFloatCurve([{x:0,y:100},{x:255,y:100}]);expect(flat(.2)).toBeCloseTo(flat(.8));
  });
  it('keeps extreme physical operations finite at Float32 storage limits',()=>{
    const d=new Float32Array([3e38,-3e38,0,1]);applyFloatAdjustment(d,{type:'exposure',values:{exposure:1024,gamma:1}});
    expect([...d].every(Number.isFinite)).toBe(true);expect(d[0]).toBeGreaterThan(1);expect(d[1]).toBeLessThan(0);
  });
});
