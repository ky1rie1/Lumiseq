import { expect, it } from 'vitest';
import { DevelopAutoToneService, developAutoColorRevision, developAutoColorSourceId } from './DevelopAutoToneService';
import { DocumentManager } from '../document/DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { createDevelopDocument } from '../document/DevelopDocument';
import type { FloatAutoToneSource } from './autoToneSource';
const floatSource=():FloatAutoToneSource=>({samples:Array.from({length:64},(_,i)=>[.001+i*.001,.001+i*.001,.001+i*.001]),
 positions:Array.from({length:64},(_,i)=>[(i+.5)/64,.5]),tailSamples:[],tailPositions:[],precision:'float32',sourcePixels:64,sourcePeak:.064});
it('uses the same atomic path for explicit semantic proposals and retains local on vision failure',async()=>{
 const docs=new DocumentManager(),history=new CommandBus(docs),doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:true});
 doc.nativeAssetId='native';doc.rawState='ready';docs.openDocument(doc);
 const service=new DevelopAutoToneService(docs,history,undefined,async()=>floatSource());
 const proposal={intent:'natural' as const,regions:[],parameters:{exposure:3,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,saturation:0,vibrance:0},
  visionStatus:'failed' as const,sourceId:developAutoColorSourceId(doc),documentRevision:developAutoColorRevision(doc)};
 const result=await service.applySemanticWithResult(doc.id,proposal);
 expect(result?.evidence?.semantic?.status).toBe('vision-unavailable');expect(history.getHistory()).toHaveLength(1);
 expect(result?.patch.exposure).toBeGreaterThan(0);expect(result?.patch.exposure).toBeLessThan(3);
 history.undo();expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
 const stale=await service.applySemanticWithResult(doc.id,{...proposal,sourceId:'other'});expect(stale).toBeNull();
 expect(await service.applySemanticWithResult(doc.id,{...proposal,documentRevision:'old'})).toBeNull();
});
it('applies float analysis with one awaited history command and real source evidence',async()=>{
 const docs=new DocumentManager(),history=new CommandBus(docs),doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:true});
 doc.nativeAssetId='native';doc.rawState='ready';docs.openDocument(doc);
 const service=new DevelopAutoToneService(docs,history,undefined,async()=>floatSource());
 const result=await service.applyWithResult(doc.id);
 expect(result?.evidence?.algorithm).toBe('natural-linear-v2');
 expect(result?.patch).toHaveProperty('saturation');expect(result?.patch).toHaveProperty('vibrance');
 expect(result?.evidence?.precision).toBe('float32');expect(result?.commandId).toBeTruthy();
 expect(history.getHistory()).toHaveLength(1);expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBeGreaterThan(0);
 history.undo();expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
});
it('settles cancellation promptly while native source sampling is still pending',async()=>{
 const docs=new DocumentManager(),history=new CommandBus(docs),doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:true});
 doc.nativeAssetId='native';doc.rawState='ready';docs.openDocument(doc);
 const service=new DevelopAutoToneService(docs,history,undefined,()=>new Promise(()=>{}));
 const pending=service.applyWithResult(doc.id);service.cancel();
 const result=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('blocked'),50))]);
 expect(result).toBeNull();expect(history.getHistory()).toHaveLength(0);
});
it('commits and undoes color-only changes as one complete eight-control recipe',async()=>{
 const docs=new DocumentManager(),history=new CommandBus(docs),doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:true});
 doc.nativeAssetId='native';doc.rawState='ready';doc.settings.saturation=17;doc.settings.vibrance=22;docs.openDocument(doc);
 const original=structuredClone(doc.settings);
 const source=floatSource();source.samples=Array.from({length:64},(_,i)=>{const y=.003+.877*(i/63)**2;return [y,y,y];});source.sourcePeak=.88;
 const service=new DevelopAutoToneService(docs,history,undefined,async()=>source);
 const result=await service.applyWithResult(doc.id);
 expect(result?.commandId).toBeTruthy();expect(result?.patch).toMatchObject({exposure:0,contrast:0,saturation:0,vibrance:0});
 expect(history.getHistory()).toHaveLength(1);history.undo();expect(docs.getDevelopDocument(doc.id)!.settings).toEqual(original);
});
it('rejects native source swaps and cancellation even when the display source stays the same',async()=>{
 for(const change of ['native','abort']){
  const docs=new DocumentManager(),history=new CommandBus(docs),doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:true});
  doc.nativeAssetId='native';doc.rawState='ready';doc.sourceAssetId='display';docs.openDocument(doc);
  let resolve!:(source:FloatAutoToneSource)=>void;
  const service=new DevelopAutoToneService(docs,history,undefined,()=>new Promise(r=>resolve=r));
  const controller=new AbortController(),pending=service.applyWithResult(doc.id,()=>true,controller.signal);
  if(change==='native')docs.updateDocument({...doc,nativeAssetId:'other'},'Decode');else controller.abort();
  resolve(floatSource());expect(await pending).toBeNull();expect(history.getHistory()).toHaveLength(0);
 }
});
it('rejects cancellation while the history bus is waiting to execute the command',async()=>{
 const docs=new DocumentManager(),history=new CommandBus(docs),doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:true});
 doc.nativeAssetId='native';doc.rawState='ready';docs.openDocument(doc);
 const execute=history.execute.bind(history);let queued!:(()=>Promise<void>);
 let announce!:()=>void;const ready=new Promise<void>(resolve=>announce=resolve);
 history.execute=command=>new Promise<void>((resolve,reject)=>{
  queued=async()=>{try{await execute(command);resolve();}catch(error){reject(error);}};announce();
 });
 const service=new DevelopAutoToneService(docs,history,undefined,async()=>floatSource());
 const controller=new AbortController(),work=service.applyWithResult(doc.id,()=>true,controller.signal);
 await ready;controller.abort();await queued();
 expect(await work).toBeNull();expect(history.getHistory()).toHaveLength(0);
 expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
});
it('settles cancellation promptly while a history command remains queued',async()=>{
 const docs=new DocumentManager(),history=new CommandBus(docs),doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:true});
 doc.nativeAssetId='native';doc.rawState='ready';docs.openDocument(doc);
 let ready!:()=>void;const queued=new Promise<void>(resolve=>ready=resolve);
 history.execute=()=>{ready();return new Promise(()=>{});};
 const service=new DevelopAutoToneService(docs,history,undefined,async()=>floatSource());
 const pending=service.applyWithResult(doc.id);await queued;service.cancel();
 expect(await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('blocked'),50))])).toBeNull();
});
it('applies one undoable tonal patch, preserves other adjustments and is stable when repeated', async()=>{
 const docs=new DocumentManager(),history=new CommandBus(docs);const doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:false});
 doc.sourceAssetId='source';doc.settings.saturation=17;doc.settings.contrast=18;doc.settings.shadows=12;doc.settings.whites=-20;doc.settings.blacks=-3;docs.openDocument(doc);
 const service=new DevelopAutoToneService(docs,history,async(_document,baseline)=>{
  expect(baseline.exposure).toBe(0);expect(baseline.highlights).toBe(0);
  expect(baseline.contrast).toBe(0);expect(baseline.shadows).toBe(0);expect(baseline.whites).toBe(0);expect(baseline.blacks).toBe(0);
  return new Uint8ClampedArray([30,30,30,255,60,60,60,255]);
 });
 await service.apply(doc.id);const applied=structuredClone(docs.getDevelopDocument(doc.id)!.settings);
 expect(applied.exposure).toBeGreaterThan(0);expect(applied.saturation).toBe(17);expect(applied.whiteBalance).toEqual(doc.settings.whiteBalance);
 expect(applied.contrast).not.toBe(18);expect(applied.shadows).not.toBe(12);expect(applied.whites).not.toBe(-20);expect(applied.blacks).not.toBe(-3);
 await service.apply(doc.id);expect(docs.getDevelopDocument(doc.id)!.settings).toEqual(applied);
 history.undo();expect(docs.getDevelopDocument(doc.id)!.settings).toEqual(doc.settings);history.redo();expect(docs.getDevelopDocument(doc.id)!.settings).toEqual(applied);
});
it('discards analysis after edits, source changes, active photo changes or cancellation',async()=>{
 for(const change of ['edit','source','photo','cancel']){
  const docs=new DocumentManager(),history=new CommandBus(docs);const doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:false});doc.sourceAssetId='a';docs.openDocument(doc);
  let resolve!:(data:Uint8ClampedArray)=>void;const service=new DevelopAutoToneService(docs,history,()=>new Promise(r=>resolve=r));
  const work=service.apply(doc.id);
  if(change==='edit')docs.updateDocument({...doc,settings:{...doc.settings,saturation:10}},'Edit');
  if(change==='source')docs.updateDocument({...doc,sourceAssetId:'b'},'Decode');
  if(change==='photo')docs.openDocument(createDevelopDocument({sourceUri:'y',fileName:'y',isRaw:false}));
  if(change==='cancel')service.cancel();
  resolve(new Uint8ClampedArray([30,30,30,255]));expect(await work).toBe(false);expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
 }
});
it('discards a late analysis failure after cancellation',async()=>{
 const docs=new DocumentManager(),history=new CommandBus(docs);const doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:false});docs.openDocument(doc);
 let reject!:(error:Error)=>void;const service=new DevelopAutoToneService(docs,history,()=>new Promise((_resolve,r)=>reject=r));
 const work=service.apply(doc.id);service.cancel();reject(new Error('late failure'));
 expect(await work).toBe(false);
});
it('discards a late analysis failure after settings or source changes',async()=>{
 for(const change of ['edit','source']){
  const docs=new DocumentManager(),history=new CommandBus(docs);const doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:false});doc.sourceAssetId='a';docs.openDocument(doc);
  let reject!:(error:Error)=>void;const service=new DevelopAutoToneService(docs,history,()=>new Promise((_resolve,r)=>reject=r));
  const work=service.apply(doc.id);
  if(change==='edit')docs.updateDocument({...doc,settings:{...doc.settings,contrast:10}},'Edit');
  else docs.updateDocument({...doc,sourceAssetId:'b'},'Decode');
  reject(new Error('late failure'));expect(await work).toBe(false);
 }
});
