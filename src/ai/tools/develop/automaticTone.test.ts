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
