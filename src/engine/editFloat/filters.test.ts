import { expect,it } from 'vitest';
import { applyFloatFilterStack } from './filters';
import type { SmartFilter } from '../../types/edit';
const blur:SmartFilter={id:'blur',name:'blur',type:'gaussian_blur',enabled:true,opacity:1,settings:{radius:1}};
it('uses normalized true Gaussian sigma and premultiplied alpha without changing source',()=>{
  const data=new Float32Array(9*9*4);data.set([2,-.2,.4,1],(4*9+4)*4);
  data.set([100,0,0,0],0);const before=data.slice();
  const result=applyFloatFilterStack({width:9,height:9,data},[blur]);
  const center=(4*9+4)*4,right=center+4;
  expect(result.data[right+3]/result.data[center+3]).toBeCloseTo(Math.exp(-.5),6);
  expect(result.data[right]).toBeCloseTo(2,6);
  expect(result.data[right+1]).toBeCloseTo(-.2,6);
  expect(result.data.reduce((s,v,i)=>s+(i%4===3?v:0),0)).toBeCloseTo(1,6);
  expect([...data]).toEqual([...before]);
});
it('evaluates each filter on the previous result',()=>{
  const data=new Float32Array(11*11*4);data.set([1,1,1,1],(5*11+5)*4);
  const input={width:11,height:11,data};const one=applyFloatFilterStack(input,[blur]);
  const twice=applyFloatFilterStack(input,[blur,blur]);
  expect([...twice.data]).toEqual([...applyFloatFilterStack(one,[blur]).data]);
  expect(twice.data[(5*11+5)*4+3]).toBeLessThan(one.data[(5*11+5)*4+3]);
});
it('is rotationally symmetric and has radius=sigma rather than a box kernel',()=>{
  const data=new Float32Array(13*13*4);data.set([1,1,1,1],(6*13+6)*4);
  const result=applyFloatFilterStack({width:13,height:13,data},[blur]);
  const alpha=(x:number,y:number)=>result.data[(y*13+x)*4+3];
  expect(alpha(7,6)).toBeCloseTo(alpha(6,7),7);expect(alpha(8,6)/alpha(6,6)).toBeCloseTo(Math.exp(-2),6);
});
it('uses a luminance threshold and preserves alpha for USM',()=>{
  const data=new Float32Array(9*4);for(let x=0;x<9;x++)data.set([x===4?1.2:1,.2,.1,.7],x*4);
  const settings={radius:1,amount:2,threshold:255},filter:SmartFilter={...blur,type:'unsharp_mask',settings};
  const unchanged=applyFloatFilterStack({width:9,height:1,data},[filter]);expect([...unchanged.data]).toEqual([...data]);
  const result=applyFloatFilterStack({width:9,height:1,data},[{...filter,settings:{...settings,threshold:0}}]);
  expect(result.data[16]).toBeGreaterThan(data[16]);expect(result.data[17]-data[17]).toBeCloseTo(result.data[16]-data[16],6);
  for(let i=3;i<data.length;i+=4)expect(result.data[i]).toBe(data[i]);
});
it('bilateral preserveEdges protects boundaries while reducing small noise',()=>{
  const data=new Float32Array(15*4);for(let x=0;x<15;x++)data.set([x<7?(x%2?.22:.2):2,x<7?.2:2,x<7?.2:2,1],x*4);
  const filter:SmartFilter={...blur,type:'noise_reduction',settings:{radius:2,strength:1,preserveEdges:1}};
  const result=applyFloatFilterStack({width:15,height:1,data},[filter]);
  expect(result.data[6*4]).toBeLessThan(.25);expect(result.data[7*4]).toBeGreaterThan(1.95);
  const soft=applyFloatFilterStack({width:15,height:1,data},[{...filter,settings:{radius:2,strength:1,preserveEdges:0}}]);
  expect(soft.data[6*4]).toBeGreaterThan(result.data[6*4]);
  expect(result.data[3*4]).toBeLessThan(data[3*4]);
});
