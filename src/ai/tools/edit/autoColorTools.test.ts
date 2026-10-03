import { expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { EditAutoColorTool, DevelopSemanticAutoColorTool } from './autoColorTools';
import { EditAutoColorService } from '../../../edit/EditAutoColorService';
import { DevelopAutoToneService, developAutoColorRevision, developAutoColorSourceId } from '../../../develop/DevelopAutoToneService';
import { createEditDocument, createImageLayer } from '../../../document/EditDocument';
import { createDevelopDocument } from '../../../document/DevelopDocument';
import { DocumentManager } from '../../../document/DocumentManager';
import { CommandBus } from '../../../history/CommandBus';
import { DocumentObservationService } from '../../vision/DocumentObservationService';
it('exposes exactly the eight bounded automatic controls and native observation requirements', () => {
 const schema=new DevelopSemanticAutoColorTool().schema, recipe=schema.parameters.properties.parameters;
 expect(Object.keys(recipe.properties!)).toEqual(['exposure','contrast','highlights','shadows','whites','blacks','saturation','vibrance']);
 expect(recipe.required).toHaveLength(8);expect(recipe.properties!.exposure.description).toContain('[-3, 3] EV');
 expect(schema.description).toContain('whole-image overview');expect(schema.description).toContain('native-resolution');
 expect(schema.parameters.properties.regions.items!.required).toContain('observationId');
});

it('routes the edit strategy through one adjustment command and validates arguments',async()=>{
 const documentManager=new DocumentManager(),commandBus=new CommandBus(documentManager),doc=createEditDocument({width:16,height:16,renderingVersion:2,
  layers:[createImageLayer({name:'original',sourceAssetId:'original',naturalWidth:16,naturalHeight:16})]});documentManager.openDocument(doc);
 const data=new Float32Array(256*4);for(let i=0;i<256;i++)data.set([.02+i*.002,.03+i*.001,.04+i*.003,1],i*4);
 const tool=new EditAutoColorTool(c=>new EditAutoColorService(c.documentManager,c.commandBus,async()=>({width:16,height:16,data})));
 const context={documentManager,commandBus,currentWorkspace:'edit' as const};
 const invalid=await tool.execute(context,{strategy:'secret'},'bad');expect(invalid.error?.code).toBe('INVALID_ARGUMENT');
 const result=await tool.execute(context,{strategy:'autoTone'},'auto');expect(result.success).toBe(true);expect(result.commandId).toBeTruthy();
 expect(commandBus.getHistory()).toHaveLength(1);expect(documentManager.getEditDocument(doc.id)!.layers.at(-1)?.type).toBe('adjustment');
});

function develop(){const documentManager=new DocumentManager(),commandBus=new CommandBus(documentManager),doc=createDevelopDocument({width:64,height:64,sourceUri:'x.arw',fileName:'x',isRaw:true});
 doc.nativeAssetId='native';doc.rawState='ready';documentManager.openDocument(doc);
 const service=new DevelopAutoToneService(documentManager,commandBus,undefined,async()=>({
  samples:Array.from({length:256},(_,i)=>{const y=.001+i*.00025;return [y,y,y];}),
  positions:Array.from({length:256},(_,i)=>[(i%16+.5)/16,(Math.floor(i/16)+.5)/16]),tailSamples:[],tailPositions:[],precision:'float32',sourcePixels:4096,sourcePeak:.065}));
 const parameters={exposure:3,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,saturation:0,vibrance:0};
 return {documentManager,commandBus,doc,service,parameters,currentWorkspace:'develop' as const};}
it('falls back to a valid local result on explicit vision failure without calling a model',async()=>{
 const c=develop(),tool=new DevelopSemanticAutoColorTool(()=>c.service);
 const result=await tool.execute(c,{sourceId:developAutoColorSourceId(c.doc),documentRevision:developAutoColorRevision(c.doc),intent:'natural',visionStatus:'failed'},'semantic');
 expect(result.success).toBe(true);expect(result.after.evidence.semantic.status).toBe('vision-unavailable');
 expect(c.commandBus.getHistory()).toHaveLength(1);expect(result.after.patch.exposure).toBeLessThan(3);
});
it('requires current source revision and rejects unknown/manual WB parameter keys',async()=>{
 const c=develop(),tool=new DevelopSemanticAutoColorTool(()=>c.service);
 const args={sourceId:'native',documentRevision:developAutoColorRevision(c.doc),intent:'natural',visionStatus:'failed',parameters:c.parameters};
 const old=await tool.execute(c,{...args,documentRevision:'old'},'old');expect(old.error?.code).toBe('STALE_SOURCE');
 const wrong=await tool.execute(c,{...args,parameters:{...c.parameters,temperature:5000}},'bad');expect(wrong.error?.code).toBe('INVALID_ARGUMENT');
 expect(c.commandBus.getHistory()).toHaveLength(0);
});
it('checks real cached overview and native region evidence before evaluating a semantic candidate',async()=>{
 const c=develop(),observationService=new DocumentObservationService({documents:c.documentManager,renderer:{async render(_doc,geometry){
  const canvas=createCanvas(geometry.width,geometry.height);canvas.getContext('2d').fillRect(0,0,geometry.width,geometry.height);
  return {mimeType:geometry.mimeType,data:(geometry.mimeType==='image/png'?canvas.toBuffer('image/png'):canvas.toBuffer('image/jpeg')).toString('base64'),approximate:false};
 }}});
 const overview=await observationService.observe({documentId:c.doc.id,mode:'overview'});
 const detail=await observationService.observe({documentId:c.doc.id,mode:'detail',region:{x:0,y:0,width:32,height:64}});
 const tool=new DevelopSemanticAutoColorTool(()=>c.service);
 const result=await tool.execute({...c,observationService},{sourceId:'native',documentRevision:overview.evidence.revision,intent:'natural',parameters:c.parameters,
  overviewObservationId:overview.evidence.observationId,regions:[{observationId:detail.evidence.observationId,x:0,y:0,width:32,height:64}]},'semantic');
 expect(result.success).toBe(true);expect(result.after.evidence.semantic.status).toBe('accepted');
 expect(result.after.evidence.semantic.candidateScore).toBeLessThan(result.after.evidence.semantic.localScore);
 expect(result.after.evidence.semantic.candidateScore).toBeLessThan(result.after.evidence.semantic.neutralScore);
 expect(result.after.evidence.semantic.roundedRecipeVerified).toBe(true);expect(c.commandBus.getHistory()).toHaveLength(1);
 observationService.dispose();
});
it('retains valid local analysis when native observation evidence is missing',async()=>{
 const c=develop(),tool=new DevelopSemanticAutoColorTool(()=>c.service);
 const result=await tool.execute(c,{sourceId:'native',documentRevision:developAutoColorRevision(c.doc),intent:'natural',parameters:c.parameters,
  overviewObservationId:'missing',regions:[{observationId:'missing',x:0,y:0,width:32,height:64}]},'missing');
 expect(result.success).toBe(true);expect(result.after.evidence.semantic.status).toBe('vision-unavailable');
});
