import { describe, expect, it, vi } from 'vitest';
import { DocumentManager } from '../../../document/DocumentManager';
import { createEditDocument } from '../../../document/EditDocument';
import { ToolRegistry } from '../ToolRegistry';
import { ExportImageTool, SaveStudioProjectTool,GetDocumentContextTool } from './index';
import {createDevelopDocument} from '../../../document/DevelopDocument';

describe('AI persistence tools', () => {
  it('routes TIFF/P3 delivery and exposes RAW processing state through existing AI tools',async()=>{
    const documents=new DocumentManager();const doc=createDevelopDocument({fileName:'camera.arw',sourceUri:'C:\\camera.arw',isRaw:true});
    doc.exif={opticalCorrection:{mode:'camera',provenance:'sony-embedded-tables',source_width:6240,source_height:4168,active_crop:[26,20,6192,4128],distortion_applied:true,aberration_applied:true,shading_applied:true}};
    documents.openDocument(doc);
    const exportImage=vi.fn(async()=>undefined);
    const context={documentManager:documents,commandBus:{} as any,currentWorkspace:'develop' as const};
    const result=await new ExportImageTool({export:exportImage} as any).execute(context,{documentId:doc.id,path:'C:\\out.tif',format:'tiff',outputProfile:'display-p3',width:6192,height:4128},'p3');
    expect(result.success).toBe(true);expect(exportImage).toHaveBeenCalledWith(doc,'C:\\out.tif',expect.objectContaining({format:'tiff',outputProfile:'display-p3'}));
    const state=await new GetDocumentContextTool().execute(context,{},'state');
    expect(state.data).toMatchObject({rawProcessingVersion:2,opticalCorrection:{distortion_applied:true}});
  });
  it('exposes save and delivery export to both workspaces', () => {
    const registry = new ToolRegistry();
    expect(registry.getForAgent('develop').map(tool => tool.schema.name)).toContain('system_export_image');
    expect(registry.getForAgent('edit').map(tool => tool.schema.name)).toContain('system_save_project');
  });

  it('calls the same export service as the UI and requires a specified document', async () => {
    const documents = new DocumentManager();
    const doc = createEditDocument({ name: 'poster', width: 1200, height: 800 }); documents.openDocument(doc);
    const exportImage = vi.fn(async () => undefined);
    const tool = new ExportImageTool({ export: exportImage } as any);
    const context = { documentManager: documents, commandBus: {} as any, currentWorkspace: 'edit' as const };
    const result = await tool.execute(context, { documentId: doc.id, path: 'C:\\out.jpg', format: 'jpeg', quality: 82, width: 600, height: 400 }, 'call-1');
    expect(result.success).toBe(true);
    expect(exportImage).toHaveBeenCalledWith(doc, 'C:\\out.jpg', { format: 'jpeg', quality: 82, width: 600, height: 400 });
    expect(tool.schema.riskLevel).toBe('dangerous');
  });

  it('calls the same project save service with a local project path', async () => {
    const documents = new DocumentManager();
    const doc = createEditDocument({ name: 'poster' }); documents.openDocument(doc);
    const save = vi.fn(async () => ({ recentRecorded: true }));
    const tool = new SaveStudioProjectTool({ save } as any);
    const result = await tool.execute({ documentManager: documents, commandBus: {} as any, currentWorkspace: 'edit' },
      { documentId: doc.id, path: 'C:\\poster.aistudio' }, 'call-2');
    expect(result.success).toBe(true);
    expect(save).toHaveBeenCalledWith(doc, 'C:\\poster.aistudio');
  });
});
