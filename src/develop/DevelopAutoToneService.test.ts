import { expect, it } from 'vitest';
import { DevelopAutoToneService } from './DevelopAutoToneService';
import { DocumentManager } from '../document/DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { createDevelopDocument } from '../document/DevelopDocument';
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
