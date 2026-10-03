import { expect, it } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { AssetManager } from '../assets/AssetManager';
import { createDevelopDocument } from '../document/DevelopDocument';
import { DevelopOperationService } from './DevelopOperationService';

it('creates an undoable rendering upgrade without changing RAW coordinates, decoder or original',async()=>{
 const docs=new DocumentManager(),history=new CommandBus(docs),assets=new AssetManager();
 const mask=await assets.registerMask(new Uint8ClampedArray([0,255,128,0]),2,2,'mask');
 const doc=createDevelopDocument({sourceUri:'x.arw',fileName:'x.arw',isRaw:true,rawProcessingVersion:1});
 doc.settings.renderingVersion=1;doc.settings.clarity=35;
 doc.settings.masks=[{id:'mask',name:'mask',kind:'radial',geometry:{center:{x:.4,y:.2},radiusX:.2,radiusY:.3},
  maskAssetId:mask.id,inverted:false,opacity:1,exposure:1}];docs.openDocument(doc);
 const before=structuredClone(doc),service=new DevelopOperationService(docs,history,assets);
 const result=await service.createRenderingUpgrade(doc.id),copy=docs.getDevelopDocument(result.documentId)!;
 expect(copy.settings.renderingVersion).toBe(2);expect(copy.rawProcessingVersion).toBe(1);
 expect(copy.rawCorrectionMode).toBe(doc.rawCorrectionMode);expect(copy.settings.masks[0].geometry).toEqual(doc.settings.masks[0].geometry);
 expect(copy.settings.masks[0].maskAssetId).not.toBe(mask.id);expect(copy.nativeAssetId).toBeUndefined();
 expect(docs.getDevelopDocument(doc.id)).toEqual(before);expect(history.getHistory()).toHaveLength(1);
 history.undo();expect(docs.getDevelopDocument(result.documentId)).toBeNull();
 history.redo();expect(docs.getDevelopDocument(result.documentId)!.settings.renderingVersion).toBe(2);
});

it.each(['abort','source'])('rejects queued upgrade on %s and releases cloned mask assets',async change=>{
 const docs=new DocumentManager(),history=new CommandBus(docs),assets=new AssetManager();
 const mask=await assets.registerMask(new Uint8ClampedArray([255]),1,1,'mask');
 const doc=createDevelopDocument({sourceUri:'x.arw',fileName:'x.arw',isRaw:true});doc.settings.renderingVersion=1;
 doc.settings.masks=[{id:'mask',name:'mask',kind:'radial',geometry:{center:{x:.5,y:.5},radiusX:.5,radiusY:.5},maskAssetId:mask.id,inverted:false,opacity:1}];
 docs.openDocument(doc);
 const execute=history.execute.bind(history);let queued!:(()=>Promise<void>),announce!:()=>void;
 const ready=new Promise<void>(resolve=>announce=resolve);
 history.execute=command=>new Promise<void>((resolve,reject)=>{queued=async()=>{try{await execute(command);resolve();}catch(error){reject(error);}};announce();});
 const controller=new AbortController(),service=new DevelopOperationService(docs,history,assets);
 const work=service.createRenderingUpgrade(doc.id,controller.signal);
 const failure=expect(work).rejects.toThrow(/cancelled/i);
 await ready;
 if(change==='abort')controller.abort();else docs.updateDocument({...doc,nativeAssetId:'new-source'},'Decode');
 await queued();await failure;
 expect(docs.getOpenDocuments()).toHaveLength(1);expect(history.getHistory()).toHaveLength(0);
 expect(assets.listAssets()).toHaveLength(1);
});
