import { describe, expect, it } from 'vitest';
import { computeEditAutoColor, EditAutoColorService } from './EditAutoColorService';
import { applyFloatAdjustment, decodeEncoded, encodeLinear } from '../engine/editFloat/adjustments';
import type { LinearPixelBuffer } from '../engine/editFloat/types';
import { createEditDocument, createImageLayer } from '../document/EditDocument';
import { DocumentManager } from '../document/DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { FloatEditRenderer } from '../engine/editFloat/renderer';

function fixture(color:(t:number)=>number[]):LinearPixelBuffer {
 const data=new Float32Array(16*16*4);
 for(let i=0;i<256;i++)data.set([...color(i/255).map(decodeEncoded),i===0?0:.5+i/512],i*4);
 return {width:16,height:16,data};
}
const cast=()=>fixture(t=>[.18+.62*t,.12+.50*t,.25+.65*t]);
describe('float edit automatic strategies',()=>{
 it('uses common channel anchors for Contrast and independent channel curves for Tone',()=>{
  const input=cast(),original=input.data.slice();
  const contrast=computeEditAutoColor(input,'autoContrast')!,tone=computeEditAutoColor(input,'autoTone')!;
  expect(contrast.adjustments[0].type).toBe('levels');expect(tone.adjustments[0].type).toBe('curves');
  expect(contrast.evidence.workingPrecision).toBe('float32');
  const values=tone.adjustments[0].type==='curves'?tone.adjustments[0].values:null;
  expect(values?.red).not.toEqual(values?.blue);
  const output=input.data.slice();contrast.adjustments.forEach(s=>applyFloatAdjustment(output,s));
  const a=4*128,gain=(encodeLinear(output[a])-encodeLinear(output[a+1]))/(encodeLinear(input.data[a])-encodeLinear(input.data[a+1]));
  expect((encodeLinear(output[a+1])-encodeLinear(output[a+2]))/(encodeLinear(input.data[a+1])-encodeLinear(input.data[a+2]))).toBeCloseTo(gain,5);
  expect(input.data).toEqual(original);
  for(let i=3;i<output.length;i+=4)expect(output[i]).toBe(original[i]);
 });
 it('requires supported neutral pixels for Color and reports an explicit fallback for saturated subjects',()=>{
  const neutral=fixture(t=>{const v=.2+t*.5;return [v+.015,v,v-.015];});
  const result=computeEditAutoColor(neutral,'autoColor')!;
  expect(result.evidence.neutralConfidence).toBeGreaterThan(.5);
  expect(result.adjustments.some(s=>s.type==='color_balance')).toBe(true);
  const output=neutral.data.slice();result.adjustments.forEach(s=>applyFloatAdjustment(output,s));
  const i=128*4;expect(Math.abs(output[i]-output[i+2])).toBeLessThan(Math.abs(neutral.data[i]-neutral.data[i+2]));
  const colored=computeEditAutoColor(fixture(t=>[.3+t*.5,.025,.01]),'autoColor')!;
  expect(colored.evidence.neutralConfidence).toBe(0);expect(colored.evidence.fallbackReason).toMatch(/neutral/i);
  expect(colored.adjustments.some(s=>s.type==='color_balance')).toBe(false);
 });
 it('preserves signed/HDR working data and refuses nonfinite or malformed buffers',()=>{
  const input=cast();input.data[20]=-.04;input.data[21]=1.5;const original=input.data.slice();
  const result=computeEditAutoColor(input,'autoTone')!;const output=input.data.slice();result.adjustments.forEach(s=>applyFloatAdjustment(output,s));
  expect(output[20]).toBeLessThan(0);expect(output[21]).toBeGreaterThan(1);expect(input.data).toEqual(original);
  expect(result.evidence.newClippedPixelFraction).toBeLessThanOrEqual(.003);
  expect(()=>computeEditAutoColor({...input,data:new Float32Array([NaN,0,0,1])},'autoTone')).toThrow(/size|finite/i);
 });
});

function setup(){const docs=new DocumentManager(),history=new CommandBus(docs),doc=createEditDocument({width:16,height:16,renderingVersion:2,
 layers:[createImageLayer({name:'Original',sourceAssetId:'original',naturalWidth:16,naturalHeight:16})]});docs.openDocument(doc);return {docs,history,doc};}
it('creates editable adjustment layers in one command, restores selection on undo, and never rasterizes',async()=>{
 const {docs,history,doc}=setup(),original=structuredClone(doc);
 const service=new EditAutoColorService(docs,history,async()=>cast());const result=await service.applyWithResult(doc.id,'autoTone');
 expect(result?.commandId).toBeTruthy();expect(history.getHistory()).toHaveLength(1);
 const current=docs.getEditDocument(doc.id)!;expect(current.layers[0]).toEqual(original.layers[0]);expect(current.layers.at(-1)?.type).toBe('adjustment');
 history.undo();expect(docs.getEditDocument(doc.id)!.layers).toEqual(original.layers);expect(docs.getEditDocument(doc.id)!.selectedLayerId).toBe(original.selectedLayerId);
 history.redo();expect(docs.getEditDocument(doc.id)!.layers).toEqual(current.layers);
});
it('replays the generated recipe through the actual float layer compositor with intact alpha and source',async()=>{
 const {docs,history,doc}=setup();doc.backgroundColor='transparent';const input=cast(),original=input.data.slice();
 const source={width:16,height:16,async getRegion(r:{x:number;y:number;width:number;height:number}){
  const data=new Float32Array(r.width*r.height*4);
  for(let y=0;y<r.height;y++)data.set(input.data.subarray(((y+r.y)*16+r.x)*4,((y+r.y)*16+r.x+r.width)*4),y*r.width*4);
  return {width:r.width,height:r.height,data};
 }};
 const renderer=new FloatEditRenderer({getSource:async()=>source,getRawSource:async()=>source,getMask:async()=>{throw new Error('No masks');}});
 const region={x:0,y:0,width:16,height:16},baseline=await renderer.renderRegion(doc,region);
 const service=new EditAutoColorService(docs,history,(snapshot,r,scale,signal)=>renderer.renderRegion(snapshot,r,{scale,signal}));
 const result=await service.applyWithResult(doc.id,'autoColor');
 const output=await renderer.renderRegion(docs.getEditDocument(doc.id)!,region),expected=baseline.data.slice();
 result!.adjustments.forEach(settings=>applyFloatAdjustment(expected,settings));
 for(let i=0;i<output.data.length;i++)expect(output.data[i]).toBeCloseTo(expected[i],6);
 expect(input.data).toEqual(original);for(let i=3;i<output.data.length;i+=4)expect(output.data[i]).toBe(baseline.data[i]);
 history.undo();expect((await renderer.renderRegion(docs.getEditDocument(doc.id)!,region)).data).toEqual(baseline.data);
});
it('rejects legacy documents and stale/closed/changed snapshots before mutation',async()=>{
 const legacy=setup();legacy.doc.renderingVersion=1;
 await expect(new EditAutoColorService(legacy.docs,legacy.history,async()=>cast()).applyWithResult(legacy.doc.id,'autoTone')).rejects.toThrow(/version|precision/i);
 for(const change of ['layers','close','cancel']){
  const {docs,history,doc}=setup();let resolve!:(b:LinearPixelBuffer)=>void;
  const service=new EditAutoColorService(docs,history,()=>new Promise(r=>resolve=r));const pending=service.applyWithResult(doc.id,'autoContrast');
  if(change==='layers')docs.updateDocument({...doc,layers:[]},'Changed');else if(change==='close')docs.closeDocument(doc.id);else service.cancel();
  resolve(cast());expect(await pending).toBeNull();expect(history.getHistory()).toHaveLength(0);
 }
});
it('settles cancellation during rendering and protects a command that executes after cancellation',async()=>{
 const {docs,history,doc}=setup();const service=new EditAutoColorService(docs,history,()=>new Promise(()=>{}));
 const pending=service.applyWithResult(doc.id,'autoContrast');service.cancel();
 expect(await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('blocked'),50))])).toBeNull();
 const next=setup();const realExecute=next.history.execute.bind(next.history);let execute!:(()=>Promise<void>),ready!:()=>void;
 const queued=new Promise<void>(resolve=>ready=resolve);
 next.history.execute=command=>new Promise((resolve,reject)=>{execute=async()=>{try{await realExecute(command);resolve();}catch(e){reject(e);}};ready();});
 const nextService=new EditAutoColorService(next.docs,next.history,async()=>cast()),work=nextService.applyWithResult(next.doc.id,'autoTone');
 await queued;nextService.cancel();expect(await work).toBeNull();await execute();expect(next.history.getHistory()).toHaveLength(0);
});
