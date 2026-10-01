import { afterEach, expect, it, vi } from 'vitest';
import { createDevelopDocument } from '../document/DevelopDocument';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultAssetManager } from '../assets/AssetManager';
import { defaultImageEngine } from '../engine/WebGLImageEngine';
import { useDevelopStore } from './useDevelopStore';
vi.mock('../platform',()=>({isTauriEnvironment:()=>false,getPlatformBridge:()=>({
 getRawMetadata:async()=>null,extractRawThumbnail:async()=>new Uint8Array([255,216]),
 decodeRawImage:async()=>({asset_id:'native-linear16',width:4000,height:3000,preview_png_bytes:[137,80,78,71],pixel_format:'RGBA16'}),
})}));
afterEach(()=>vi.restoreAllMocks());
it('registers a losslessly encoded PNG overview while preserving the native linear export asset',async()=>{
 const doc=createDevelopDocument({sourceUri:'sample.raw',fileName:'sample.raw',isRaw:true});
 defaultDocumentManager.openDocument(doc);
 vi.spyOn(defaultImageEngine,'loadAsset').mockResolvedValue({width:2048,height:1536});
 const register=vi.spyOn(defaultAssetManager,'registerBlob').mockResolvedValue({id:'browser-png',kind:'image',name:'preview.png',mimeType:'image/png',sizeBytes:4,createdAt:0,width:2048,height:1536});
 try{
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  const result=defaultDocumentManager.getDevelopDocument(doc.id)!;
  expect(result.rawState).toBe('ready');expect(result.nativeAssetId).toBe('native-linear16');
  expect(result.pipelineState?.colorState).toBe('display-encoded');
  expect(result.pipelineState?.transferFunctionApplied).toBe(true);expect(result.pipelineState?.whiteBalanceApplied).toBe(true);
  expect(result.pipelineState?.toneMappingApplied).toBe(false);
  expect(register.mock.calls.find(([, , name])=>String(name).endsWith('_decoded.png'))?.[3]).toBeUndefined();
  expect(register.mock.calls.find(([, , name])=>String(name).endsWith('_decoded.png'))?.[0].type).toBe('image/png');
  await expect(useDevelopStore.getState().transferToEditWorkspace(doc.id)).rejects.toThrow('原始分辨率');
 }finally{defaultDocumentManager.closeDocument(doc.id);}
});
