import type { DevelopDocument, DevelopSettings } from '../types/develop';
import type { IDocumentManager } from '../types/document';
import type { ICommandBus } from '../types/history';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultCommandBus } from '../history/CommandBus';
import { BaseCommand } from '../history/Command';
import { computeAutoTone, neutralToneSettings, AUTO_TONE_KEYS } from './autoTone';
type Analyzer=(doc:DevelopDocument,baseline:DevelopSettings)=>Promise<Uint8ClampedArray>;
async function analyze(doc:DevelopDocument,baseline:DevelopSettings) {
 const {defaultImageEngine,DevelopGpuError}=await import('../engine/WebGLImageEngine');
 const asset=doc.sourceAssetId||doc.previewAssetId;if(!asset)throw new Error('图像尚未就绪');
 let canvas=document.createElement('canvas');const scale=Math.min(1,512/Math.max(doc.width,doc.height));
 const width=Math.max(1,Math.round(doc.width*scale)),height=Math.max(1,Math.round(doc.height*scale));
 canvas.width=width;canvas.height=height;
 try {
  // A separate render surface leaves the visible preview untouched and preserves masks/curves.
  try { await defaultImageEngine.renderDevelop(asset,baseline,canvas); }
  catch(error){
   if(!(error instanceof DevelopGpuError))throw error;
   defaultImageEngine.releaseDevelopContext(canvas);canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();canvas.width=canvas.height=0;
   canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   await defaultImageEngine.renderDevelop(asset,baseline,canvas,undefined,{forceCPU:true,fallbackReason:error.message});
  }
  const read=document.createElement('canvas');read.width=canvas.width;read.height=canvas.height;
  const ctx=read.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('自动调整分析画布不可用');
  ctx.drawImage(canvas,0,0);return ctx.getImageData(0,0,read.width,read.height).data;
 } finally { defaultImageEngine.releaseDevelopContext(canvas);canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();canvas.width=canvas.height=0; }
}
class AutoToneCommand extends BaseCommand {
 private before?:DevelopSettings;
 constructor(id:string,private settings:DevelopSettings,private docs:IDocumentManager){super('自动调整',id);}
 execute(){const doc=this.docs.getDevelopDocument(this.documentId);if(!doc)throw new Error('照片已关闭');this.before=structuredClone(doc.settings);this.docs.updateDocument({...doc,settings:structuredClone(this.settings)},this.name);}
 undo(){const doc=this.docs.getDevelopDocument(this.documentId);if(doc&&this.before)this.docs.updateDocument({...doc,settings:structuredClone(this.before)},'Undo 自动调整');}
}
export class DevelopAutoToneService {
 private generation=0;
 constructor(private docs:IDocumentManager=defaultDocumentManager,private history:ICommandBus=defaultCommandBus,private analyzer:Analyzer=analyze){}
 cancel(){this.generation++;}
 async apply(id:string,isCurrent:()=>boolean=()=>true):Promise<boolean>{
  const generation=++this.generation,doc=this.docs.getDevelopDocument(id);if(!doc)throw new Error('照片已关闭');
  const settings=structuredClone(doc.settings),signature=JSON.stringify(settings),asset=doc.sourceAssetId||doc.previewAssetId;
  const isStale=()=>{const current=this.docs.getDevelopDocument(id);return generation!==this.generation||!isCurrent()||this.docs.getActiveDocument()?.id!==id||!current||JSON.stringify(current.settings)!==signature||(current.sourceAssetId||current.previewAssetId)!==asset;};
  let pixels:Uint8ClampedArray;
  try { pixels=await this.analyzer(doc,neutralToneSettings(settings)); }
  catch(error){if(isStale())return false;throw error;}
  const current=this.docs.getDevelopDocument(id);
  if(!current||isStale())return false;
  const patch=computeAutoTone(pixels);if(!patch)throw new Error('预览没有可分析的像素');
  if(AUTO_TONE_KEYS.every(key=>current.settings[key]===patch[key]))return true;
  this.history.execute(new AutoToneCommand(id,{...settings,...patch},this.docs));return true;
 }
}
export const defaultDevelopAutoTone=new DevelopAutoToneService();
