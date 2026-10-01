import { afterEach, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { technicalReview } from './QualityReview';
import { ToolRegistry } from '../tools/ToolRegistry';
import { DocumentManager } from '../../document/DocumentManager';
import { CommandBus } from '../../history/CommandBus';
import { createEditDocument, createImageLayer, createPaintLayer } from '../../document/EditDocument';
import { defaultAssetManager } from '../../assets/AssetManager';
import type { AgentActionLogEntry } from '../types';
import type { IToolContext } from '../tools/CanonicalTool';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(){
  const docs=new DocumentManager(),layer=createImageLayer({id:'target',name:'target',sourceAssetId:'source',naturalWidth:80,naturalHeight:60});
  const doc=createEditDocument({id:'postconditions',width:80,height:60,layers:[layer,createImageLayer({...layer,id:'other',naturalWidth:80,naturalHeight:60})]});docs.openDocument(doc);
  const bus=new CommandBus(docs),registry=new ToolRegistry(),context:IToolContext={documentManager:docs,commandBus:bus,currentWorkspace:'edit'};
  const review=(action:AgentActionLogEntry)=>technicalReview(docs.getActiveDocument(),[action],id=>docs.getDocument(id),id=>bus.getHistory().find(e=>e.command.id===id)?.command);
  return {docs,doc,bus,registry,context,review};
}
it.each([
  ['edit_create_image_layer',{assetId:'new-asset',name:'created'}],
  ['edit_move_layer_order',{layerId:'target',toIndex:1}],
  ['edit_transform',{layerId:'target',x:12,scaleX:0.8}],
] as const)('verifies real %s postcondition and detects rollback instead of comparing response summaries',async(name,args)=>{
  const f=setup();const result=await f.registry.get(name)!.execute(f.context,args,'canonical');
  expect(result.success).toBe(true);
  const action={toolName:name,args,status:'success',result} as unknown as AgentActionLogEntry;
  expect(f.review(action).pending).toEqual([]);expect(f.review(action).verified.length).toBeGreaterThan(0);
  expect(f.bus.undo()).toBe(true);expect(f.review(action).pending.length).toBeGreaterThan(0);
});
it('verifies actual raster identity and produced pixels of a real canonical brush stroke',async()=>{
  const f=setup();
  vi.stubGlobal('document',{createElement:()=>{
    const canvas=createCanvas(80,60);Object.assign(canvas,{toBlob:(callback:(blob:Blob)=>void)=>callback(new Blob([new Uint8Array(canvas.toBuffer('image/png'))],{type:'image/png'}))});return canvas;
  }});
  const paint=createPaintLayer({id:'paint',rasterAssetId:'before',width:80,height:60});f.docs.updateDocument({...f.doc,layers:[paint]});
  const args={layerId:paint.id,points:[{x:20,y:20},{x:25,y:20}],settings:{size:6,color:'#ff0000',hardness:0.8}};
  const result=await f.registry.get('edit_brush_stroke')!.execute(f.context,args,'stroke');expect(result.success).toBe(true);
  const action={toolName:'edit_brush_stroke',args,status:'success',result} as unknown as AgentActionLogEntry;
  expect(f.review(action).pending).toEqual([]);
  const current=f.docs.getEditDocument(f.doc.id)!.layers[0];const asset='rasterAssetId' in current?current.rasterAssetId:'';
  const blob=await defaultAssetManager.getBlob(asset);expect(blob).toBeTruthy();
  const img=await loadImage(Buffer.from(await blob!.arrayBuffer())),canvas=createCanvas(80,60);canvas.getContext('2d').drawImage(img,0,0);
  const pixel=canvas.getContext('2d').getImageData(22,20,1,1).data;expect(pixel[0]).toBe(255);expect(pixel[3]).toBeGreaterThan(0);
  expect(f.bus.undo()).toBe(true);expect(f.review(action).pending.length).toBeGreaterThan(0);defaultAssetManager.releaseAsset(asset);
});
it('verifies current transform claims after a later valid canonical alignment supersedes x',async()=>{
  const f=setup(),actions:AgentActionLogEntry[]=[];
  for(const [name,args] of [['edit_transform',{documentId:f.doc.id,layerId:'target',x:12}],['edit_align_layer',{documentId:f.doc.id,layerId:'target',alignment:'right'}]] as const) {
    const result=await f.registry.get(name)!.execute(f.context,args,name);expect(result.success).toBe(true);
    actions.push({toolName:name,args,status:'success',result} as unknown as AgentActionLogEntry);
  }
  const review=technicalReview(f.docs.getActiveDocument(),actions,id=>f.docs.getDocument(id),id=>f.bus.getHistory().find(e=>e.command.id===id)?.command);
  expect(review.pending).toEqual([]);
});
it('checks every created ID and accepts later valid renames instead of an obsolete creation snapshot',async()=>{
  let tick=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>++tick);
  const f=setup(),actions:AgentActionLogEntry[]=[];
  for(let n=0;n<2;n++) {
    const args={assetId:'source-'+n,name:'created-'+n},result=await f.registry.get('edit_create_image_layer')!.execute(f.context,args,'create-'+n);
    actions.push({toolName:'edit_create_image_layer',args,status:'success',result} as unknown as AgentActionLogEntry);
    const renameArgs={layerId:result.after.createdLayerId,name:'renamed-'+n},renamed=await f.registry.get('edit_rename_layer')!.execute(f.context,renameArgs,'rename-'+n);
    actions.push({toolName:'edit_rename_layer',args:renameArgs,status:'success',result:renamed} as unknown as AgentActionLogEntry);
  }
  const review=technicalReview(f.docs.getActiveDocument(),actions,id=>f.docs.getDocument(id),id=>f.bus.getHistory().find(e=>e.command.id===id)?.command);
  expect(review.pending).toEqual([]);expect(review.verified.filter(v=>v.startsWith('created layer'))).toHaveLength(2);
});
it('keeps independent transform fields and documents distinct',async()=>{
  const f=setup(),actions:AgentActionLogEntry[]=[];
  const second=createEditDocument({...f.doc,id:'second'});f.docs.openDocument(second);
  for(const args of [{documentId:f.doc.id,layerId:'target',x:12},{documentId:f.doc.id,layerId:'target',y:15},{documentId:second.id,layerId:'target',x:30}]) {
    const result=await f.registry.get('edit_transform')!.execute(f.context,args,'transform-'+actions.length);
    actions.push({toolName:'edit_transform',args,status:'success',result} as unknown as AgentActionLogEntry);
  }
  expect(technicalReview(f.docs.getActiveDocument(),actions,id=>f.docs.getDocument(id),id=>f.bus.getHistory().find(e=>e.command.id===id)?.command).pending).toEqual([]);
  expect(f.bus.undo()).toBe(true);
  expect(technicalReview(f.docs.getActiveDocument(),actions,id=>f.docs.getDocument(id),id=>f.bus.getHistory().find(e=>e.command.id===id)?.command).pending.length).toBeGreaterThan(0);
});
it('keeps a claimed edit without a canonical command pending',async()=>{
  const f=setup(),args={x:20,y:20,size:3},result=await f.registry.get('edit_heal')!.execute(f.context,args,'heal');
  expect(result.success).toBe(true);expect(f.review({toolName:'edit_heal',args,status:'success',result} as unknown as AgentActionLogEntry).pending.join(' ')).toContain('command');
});
