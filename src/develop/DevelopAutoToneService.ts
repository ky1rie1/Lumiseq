import type { DevelopDocument, DevelopSettings } from '../types/develop';
import type { IDocumentManager } from '../types/document';
import type { ICommandBus } from '../types/history';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultCommandBus } from '../history/CommandBus';
import { BaseCommand } from '../history/Command';
import { computeAutoTone, neutralToneSettings, AUTO_TONE_KEYS } from './autoTone';
import type { AutoTonePatch } from './autoTone';
import { defaultAssetManager } from '../assets/AssetManager';
import { readFloatAutoToneSource, type FloatAutoToneSource } from './autoToneSource';
import { createAutoToneEvaluator } from './autoToneEvaluator';
import { computeFloatAutoTone, type FloatAutoToneResult } from './floatAutoTone';
import type { IAssetManager } from '../types/asset';
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
 constructor(id:string,private settings:DevelopSettings,private docs:IDocumentManager,private expected?:string,private isStale?:()=>boolean){super('自动调整',id);}
 execute(){const doc=this.docs.getDevelopDocument(this.documentId);if(!doc)throw new Error('照片已关闭');if(this.expected&&(sourceSignature(doc)!==this.expected||this.isStale?.()))throw new Error('Automatic tone cancelled because the source or task changed');this.expected=undefined;this.isStale=undefined;this.before=structuredClone(doc.settings);this.docs.updateDocument({...doc,settings:structuredClone(this.settings)},this.name);}
 undo(){const doc=this.docs.getDevelopDocument(this.documentId);if(doc&&this.before)this.docs.updateDocument({...doc,settings:structuredClone(this.before)},'Undo 自动调整');}
}
function sourceSignature(doc:DevelopDocument):string {
 return JSON.stringify([doc.settings,doc.sourceAssetId,doc.previewAssetId,doc.nativeAssetId,doc.sourceUri,
  doc.width,doc.height,doc.rawState,doc.rawProcessingVersion,doc.rawCorrectionMode]);
}
export interface AppliedAutoTone {
 patch:AutoTonePatch;
 commandId?:string;
 evidence?:Omit<FloatAutoToneResult['evidence'],'precision'> & {precision:FloatAutoToneSource['precision'];
  evaluatedStages:'tone-white-balance-color-local-masks-vignette';detailVerification:'native-region-required'};
}
export class DevelopAutoToneService {
 private generation=0;
 constructor(private docs:IDocumentManager=defaultDocumentManager,private history:ICommandBus=defaultCommandBus,
  private analyzer?:Analyzer,private floatAnalyzer:(doc:DevelopDocument)=>Promise<FloatAutoToneSource>=
   doc=>readFloatAutoToneSource(doc,defaultAssetManager),private assets:IAssetManager=defaultAssetManager){}
 cancel(){this.generation++;}
 async apply(id:string,isCurrent:()=>boolean=()=>true):Promise<boolean>{
  return (await this.applyWithResult(id,isCurrent))!==null;
 }
 async applyWithResult(id:string,isCurrent:()=>boolean=()=>true,signal?:AbortSignal):Promise<AppliedAutoTone|null>{
  const generation=++this.generation,doc=this.docs.getDevelopDocument(id);if(!doc)throw new Error('照片已关闭');
  const settings=structuredClone(doc.settings),signature=sourceSignature(doc);
  const isStale=()=>{const current=this.docs.getDevelopDocument(id);return signal?.aborted||generation!==this.generation||!isCurrent()||this.docs.getActiveDocument()?.id!==id||!current||sourceSignature(current)!==signature;};
  if(isStale())return null;
  const started=performance.now();let timer:ReturnType<typeof setTimeout>|undefined;let timedOut=false;
  let patch:AutoTonePatch|null,evidence:AppliedAutoTone['evidence'];
  try {
   const work=async()=>{
    if(settings.renderingVersion===2&&!this.analyzer){
     const source=await this.floatAnalyzer(doc);
     if(isStale())return null;
     const evaluate=await createAutoToneEvaluator(settings,source,this.assets);
     if(isStale())return null;
     const budgetMs=5000-(performance.now()-started);
     if(budgetMs<=0)throw new Error('Automatic tone analysis timed out');
     const result=computeFloatAutoTone(source.samples,{tailSamples:source.tailSamples,renderingVersion:2,signal,evaluate,budgetMs});
     if(!result)return null;
     evidence={...result.evidence,sourcePeak:source.sourcePeak,precision:source.precision,
      evaluatedStages:'tone-white-balance-color-local-masks-vignette',detailVerification:'native-region-required'};
     return result.patch;
    }
    return computeAutoTone(await (this.analyzer??analyze)(doc,neutralToneSettings(settings)));
   };
   patch=await Promise.race([work(),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{timedOut=true;this.generation++;reject(new Error('Automatic tone analysis timed out'));},5000);
   })]);
  } catch(error){if(!timedOut&&isStale())return null;throw error;}
  finally {if(timer)clearTimeout(timer);}
  const current=this.docs.getDevelopDocument(id);
  if(!current||isStale())return null;
  if(!patch)throw new Error('图像没有可分析的有效像素');
  if(AUTO_TONE_KEYS.every(key=>current.settings[key]===patch[key]))return {patch,evidence};
  const command=new AutoToneCommand(id,{...settings,...patch},this.docs,signature,isStale);
  try {await this.history.execute(command);}catch(error){if(isStale())return null;throw error;}
  return {patch,evidence,commandId:command.id};
 }
}
export const defaultDevelopAutoTone=new DevelopAutoToneService();
