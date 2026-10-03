import type { NativeDevelopPayload } from '../app/nativeDevelopPayload';
import { decodeRawLinearPixels } from './rawLinearPixels';

export interface EditFloatPixels { width: number; height: number; data: Float32Array }
export interface EditSourceInfo { assetId: string; width: number; height: number; bitDepth: 8 | 16 | 32 }
export interface EditExportOptions { width: number; height: number; format: 'png' | 'jpeg' | 'tiff' | 'tiff-f32'; outputProfile?: 'srgb' | 'display-p3'; quality: number }

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(command, args);
}
function decode(packet: ArrayBuffer): EditFloatPixels {
  const pixels = decodeRawLinearPixels(packet);
  if (!(pixels.data instanceof Float32Array)) throw new Error('Edit transport requires LF32');
  return { ...pixels, data: pixels.data };
}
export async function decodeEditSource(bytes: Uint8Array): Promise<EditSourceInfo> {
  const { invoke: binaryInvoke } = await import('@tauri-apps/api/core');
  const result = await binaryInvoke<{asset_id:string;width:number;height:number;bit_depth:8|16|32}>('decode_edit_source', bytes);
  return { assetId: result.asset_id, width: result.width, height: result.height, bitDepth: result.bit_depth };
}
export async function stageEditRawSource(name:string,bytes:Uint8Array):Promise<string> {
  const { invoke: binaryInvoke } = await import('@tauri-apps/api/core');
  return binaryInvoke<string>('stage_raw_edit_source',bytes,{headers:{'x-edit-name':encodeURIComponent(name)}});
}
export async function readEditSourceTile(assetId:string,x:number,y:number,width:number,height:number):Promise<EditFloatPixels> {
  return decode(await invoke<ArrayBuffer>('read_edit_source_tile',{assetId,x,y,width,height}));
}
export async function releaseEditSource(assetId:string):Promise<void> { await invoke('release_edit_source',{assetId}); }
export async function renderRawDevelopTile(assetId:string,settings:NativeDevelopPayload,x:number,y:number,width:number,height:number):Promise<EditFloatPixels> {
  return decode(await invoke<ArrayBuffer>('render_raw_develop_tile',{assetId,settings,x,y,width,height}));
}
export async function beginEditExport(jobId:string,path:string,options:EditExportOptions):Promise<void> {
  await invoke('begin_edit_export',{jobId,path,options:{...options,output_profile:options.outputProfile??'srgb'}});
}
export async function appendEditExportBand(jobId:string,y:number,pixels:EditFloatPixels):Promise<void> {
  const {width,height,data}=pixels;
  if (!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||height>128||width*height>6_000_000||data.length!==width*height*4) throw new Error('Invalid Edit export row band');
  const bytes=new Uint8Array(12+data.length*4);bytes.set([76,70,51,50]);const view=new DataView(bytes.buffer);view.setUint32(4,width,true);view.setUint32(8,height,true);
  for(let i=0;i<data.length;i++){if(!Number.isFinite(data[i])||(i%4===3&&(data[i]<0||data[i]>1)))throw new Error('Invalid Edit float sample or alpha');view.setFloat32(12+i*4,data[i],true);}
  const { invoke: binaryInvoke } = await import('@tauri-apps/api/core');
  await binaryInvoke('append_edit_export_band',bytes,{headers:{'x-edit-job':encodeURIComponent(jobId),'x-edit-row':String(y)}});
}
export async function finishEditExport(jobId:string):Promise<string> {return invoke('finish_edit_export',{jobId});}
export async function cancelEditExport(jobId:string):Promise<void> {await invoke('cancel_edit_export',{jobId});}

export const EditNativeBridge={decodeEditSource,stageEditRawSource,readEditSourceTile,releaseEditSource,renderRawDevelopTile,beginEditExport,appendEditExportBand,finishEditExport,cancelEditExport};
