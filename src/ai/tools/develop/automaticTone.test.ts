import { expect, it } from 'vitest';
import { AutoDevelopToneTool, UpgradeDevelopRenderingTool, ResetDevelopGroupTool } from './index';
import { DevelopAutoToneService } from '../../../develop/DevelopAutoToneService';
import { DocumentManager } from '../../../document/DocumentManager';
import { CommandBus } from '../../../history/CommandBus';
import { createDevelopDocument } from '../../../document/DevelopDocument';

function context(){const documentManager=new DocumentManager(),commandBus=new CommandBus(documentManager);
 const doc=createDevelopDocument({sourceUri:'x.arw',fileName:'x',isRaw:true});documentManager.openDocument(doc);
 return {documentManager,commandBus,currentWorkspace:'develop' as const,doc};}
it('canonical automatic tone uses one scoped command and exposes actual analysis result',async()=>{
 const c=context(),service=new DevelopAutoToneService(c.documentManager,c.commandBus,async()=>new Uint8ClampedArray([20,20,20,255,60,60,60,255]));
 const tool=new AutoDevelopToneTool(()=>service),result=await tool.execute(c,{},'tone');
 expect(result.success).toBe(true);expect(result.commandId).toBeTruthy();expect(c.commandBus.getHistory()).toHaveLength(1);
 expect(c.documentManager.getDevelopDocument(c.doc.id)!.settings.exposure).toBeGreaterThan(0);
});
it('canonical automatic tone respects abort before mutation',async()=>{
 const c=context(),abort=new AbortController();abort.abort();
 const tool=new AutoDevelopToneTool(()=>new DevelopAutoToneService(c.documentManager,c.commandBus,async()=>new Uint8ClampedArray([20,20,20,255])));
 const result=await tool.execute({...c,signal:abort.signal}, {},'tone');
 expect(result.success).toBe(false);expect(c.commandBus.getHistory()).toHaveLength(0);
});
it('canonical automatic color documents eight controls and returns the v2 service evidence',async()=>{
 const c=context();c.doc.nativeAssetId='native';c.doc.rawState='ready';
 const service=new DevelopAutoToneService(c.documentManager,c.commandBus,undefined,async()=>({
  samples:Array.from({length:64},(_,i)=>[.001+i*.001,.002+i*.001,.001+i*.001] as [number,number,number]),
  positions:Array.from({length:64},(_,i)=>[(i+.5)/64,.5] as [number,number]),tailSamples:[],tailPositions:[],precision:'float32',sourcePixels:64,sourcePeak:.065}));
 const tool=new AutoDevelopToneTool(()=>service);
 expect(tool.schema.description).toMatch(/eight/i);expect(tool.schema.description).toMatch(/saturation.*vibrance/i);
 const result=await tool.execute(c,{},'natural');
 expect(result.success).toBe(true);expect(result.after).toMatchObject({evidence:{algorithm:'natural-linear-v2',detailVerification:'native-region-required'}});
 expect(c.commandBus.getHistory()).toHaveLength(1);
});
it('canonical rendering upgrade preserves decoder and is available as a distinct explicit operation',async()=>{
 const c=context();c.doc.settings.renderingVersion=1;
 const result=await new UpgradeDevelopRenderingTool().execute(c,{documentId:c.doc.id},'upgrade');
 expect(result.success).toBe(true);expect(result.changedDocumentId).not.toBe(c.doc.id);
 expect(c.documentManager.getDevelopDocument(result.changedDocumentId!)?.rawProcessingVersion).toBe(c.doc.rawProcessingVersion);
});
it('canonical reset group validates groups and executes one undoable group reset',async()=>{
 const c=context();c.doc.settings.clarity=40;
 const tool=new ResetDevelopGroupTool();
 const bad=await tool.execute(c,{group:'secret'},'bad');expect(bad.success).toBe(false);
 const good=await tool.execute(c,{group:'color'},'ok');expect(good.success).toBe(true);
 expect(c.commandBus.getHistory()).toHaveLength(1);c.commandBus.undo();
 expect(c.documentManager.getDevelopDocument(c.doc.id)?.settings.clarity).toBe(40);
});
