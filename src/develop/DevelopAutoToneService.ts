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
import { createAutoToneEvaluatorSnapshot } from './autoToneEvaluator';
import { NATURAL_AUTO_COLOR_KEYS, type NaturalAutoColorPatch, type NaturalAutoColorResult, type NaturalSemanticColorCandidate } from './floatAutoTone';
import { runNaturalAutoColor } from './autoToneWorkerRunner';
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
export function developAutoColorSourceId(doc:DevelopDocument):string {return doc.nativeAssetId??doc.sourceAssetId??doc.sourceUri;}
export function developAutoColorRevision(doc:DevelopDocument):string {
 const text=JSON.stringify([doc.id,sourceSignature(doc)]);let a=0x811c9dc5,b=0x9e3779b9;
 for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),0x01000193);b=Math.imul(b^text.charCodeAt(i),0x85ebca6b);}
 return `auto-color-v2:${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}`;
}
export interface DevelopSemanticColorProposal extends NaturalSemanticColorCandidate {
 sourceId:string;
 documentRevision:string;
 /** Existing observation revision provider; omitted callers use developAutoColorRevision. */
 currentRevision?:()=>string;
}
export interface AppliedAutoTone {
 patch:AutoTonePatch & Partial<Pick<NaturalAutoColorPatch,'saturation'|'vibrance'>>;
 commandId?:string;
 evidence?:Omit<NaturalAutoColorResult['evidence'],'precision'> & {precision:FloatAutoToneSource['precision'];
  evaluatedStages:'tone-white-balance-color-local-masks-vignette';detailVerification:'native-region-required'};
}
export class DevelopAutoToneService {
 private generation=0;
 private controller?:AbortController;
 constructor(private docs:IDocumentManager=defaultDocumentManager,private history:ICommandBus=defaultCommandBus,
  private analyzer?:Analyzer,private floatAnalyzer:(doc:DevelopDocument)=>Promise<FloatAutoToneSource>=
   doc=>readFloatAutoToneSource(doc,defaultAssetManager),private assets:IAssetManager=defaultAssetManager,
  private naturalRunner:typeof runNaturalAutoColor=runNaturalAutoColor){}
 cancel(){this.generation++;this.controller?.abort();}
 async apply(id:string,isCurrent:()=>boolean=()=>true):Promise<boolean>{
  return (await this.applyWithResult(id,isCurrent))!==null;
 }
 async applySemanticWithResult(id:string,proposal:DevelopSemanticColorProposal,signal?:AbortSignal):Promise<AppliedAutoTone|null>{
  const doc=this.docs.getDevelopDocument(id);if(!doc)throw new Error('照片已关闭');
  if(!doc.isRaw||doc.settings.renderingVersion!==2||this.analyzer)throw new Error('Semantic automatic color requires a version 2 RAW source');
  const valid=()=>{
   const current=this.docs.getDevelopDocument(id);return !!current&&developAutoColorSourceId(current)===proposal.sourceId&&
    (proposal.currentRevision?.()??developAutoColorRevision(current))===proposal.documentRevision;
  };
  return this.applyWithResult(id,valid,signal,proposal);
 }
 async applyWithResult(id:string,isCurrent:()=>boolean=()=>true,signal?:AbortSignal,proposal?:NaturalSemanticColorCandidate):Promise<AppliedAutoTone|null>{
  this.controller?.abort();
  const controller=new AbortController();this.controller=controller;
  const relayAbort=()=>controller.abort();signal?.addEventListener('abort',relayAbort,{once:true});
  if(signal?.aborted)controller.abort();
  const generation=++this.generation,doc=this.docs.getDevelopDocument(id);
  let abortListener:(()=>void)|undefined;
  try {
  if(!doc)throw new Error('照片已关闭');
  const settings=structuredClone(doc.settings),signature=sourceSignature(doc);
  const semanticCandidate=proposal?structuredClone({intent:proposal.intent,regions:proposal.regions,parameters:proposal.parameters,visionStatus:proposal.visionStatus}):undefined;
  const isStale=()=>{const current=this.docs.getDevelopDocument(id);return signal?.aborted||controller.signal.aborted||generation!==this.generation||!isCurrent()||this.docs.getActiveDocument()?.id!==id||!current||sourceSignature(current)!==signature;};
  if(isStale())return null;
  const started=performance.now();let timer:ReturnType<typeof setTimeout>|undefined;let timedOut=false;
  let patch:AppliedAutoTone['patch']|null,evidence:AppliedAutoTone['evidence'];
  let cancellation:Promise<never>|undefined;
  try {
   const work=async()=>{
    if(settings.renderingVersion===2&&!this.analyzer){
     const source=await this.floatAnalyzer(doc);
     if(isStale())return null;
     const snapshot=await createAutoToneEvaluatorSnapshot(settings,source,this.assets);
     snapshot.semanticCandidate=semanticCandidate;
     if(isStale())return null;
     const budgetMs=5000-(performance.now()-started);
     if(budgetMs<=0)throw new Error('Automatic tone analysis timed out');
     const result=await this.naturalRunner(snapshot,{signal:controller.signal,budgetMs});
     if(!result)return null;
     evidence={...result.evidence,sourcePeak:source.sourcePeak,precision:source.precision,
      evaluatedStages:'tone-white-balance-color-local-masks-vignette',detailVerification:'native-region-required'};
     return result.patch;
    }
    return computeAutoTone(await (this.analyzer??analyze)(doc,neutralToneSettings(settings)));
   };
   cancellation=new Promise<never>((_,reject)=>{
    abortListener=()=>reject(new Error('Automatic color analysis cancelled'));
    controller.signal.addEventListener('abort',abortListener,{once:true});
    timer=setTimeout(()=>{timedOut=true;reject(new Error('Automatic tone analysis timed out'));controller.abort();},5000);
   });
   patch=await Promise.race([work(),cancellation]);
  } catch(error){if(!timedOut&&isStale())return null;throw error;}
  finally {
   if(timer)clearTimeout(timer);
  }
  const current=this.docs.getDevelopDocument(id);
  if(!current||isStale())return null;
  if(!patch)throw new Error('图像没有可分析的有效像素');
  const keys=patch.saturation===undefined?AUTO_TONE_KEYS:NATURAL_AUTO_COLOR_KEYS;
  if(keys.every(key=>current.settings[key]===patch[key]))return {patch,evidence};
  const command=new AutoToneCommand(id,{...settings,...patch},this.docs,signature,isStale);
  try {await Promise.race([this.history.execute(command),cancellation!]);}catch(error){if(isStale())return null;throw error;}
  return {patch,evidence,commandId:command.id};
  } finally {
   if(abortListener)controller.signal.removeEventListener('abort',abortListener);
   signal?.removeEventListener('abort',relayAbort);if(this.controller===controller)this.controller=undefined;
  }
 }
}
export const defaultDevelopAutoTone=new DevelopAutoToneService();
