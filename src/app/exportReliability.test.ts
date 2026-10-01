import { it, expect } from 'vitest';
import { createDevelopDocument } from '../document/DevelopDocument';
import { ImageExportService } from './ImageExportService';
it('rejects a null native export result', async () => {
 const doc = createDevelopDocument({sourceUri:'C:\\photo.cr3',fileName:'photo.cr3',isRaw:true}); doc.nativeAssetId='raw';
 const service = new ImageExportService({exportRaw:async()=>null, renderEdit:async()=>new Blob(),renderDevelop:async()=>new Blob(),write:async()=>{}});
 await expect(service.export(doc,'C:\\out.png',{format:'png',quality:90,width:10,height:10})).rejects.toThrow();
});
it('rejects empty raster encodes before any disk write', async()=>{
 let wrote=false;const service=new ImageExportService({exportRaw:async()=>null,renderEdit:async()=>new Blob(),renderDevelop:async()=>new Blob(),write:async()=>{wrote=true}});
 const {createEditDocument}=await import('../document/EditDocument');
 await expect(service.export(createEditDocument({name:'empty'}),'C:\\out.png',{format:'png',quality:90,width:10,height:10})).rejects.toThrow('empty');expect(wrote).toBe(false);
});
it('propagates rejected native export writes', async()=>{
 const doc=createDevelopDocument({sourceUri:'C:\\photo.cr3',fileName:'photo.cr3',isRaw:true});doc.nativeAssetId='raw';const service=new ImageExportService({exportRaw:async()=>{throw Error('disk full')},renderEdit:async()=>new Blob(),renderDevelop:async()=>new Blob(),write:async()=>{}});
 await expect(service.export(doc,'C:\\out.png',{format:'png',quality:90,width:10,height:10})).rejects.toThrow('disk full');
});
