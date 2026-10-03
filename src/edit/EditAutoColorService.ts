import type { AdjustmentLayer, AdjustmentSettings, ColorBalanceSettings, CurvePoint, EditDocument } from '../types/edit';
import type { IDocumentManager } from '../types/document';
import type { ICommandBus } from '../types/history';
import type { EditRegion, LinearPixelBuffer } from '../engine/editFloat/types';
import { applyFloatAdjustment, encodeLinear } from '../engine/editFloat/adjustments';
import { createAdjustmentLayer } from '../document/EditDocument';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultCommandBus } from '../history/CommandBus';
import { BaseCommand } from '../history/Command';

export const EDIT_AUTO_COLOR_STRATEGIES=['autoContrast','autoTone','autoColor'] as const;
export type EditAutoColorStrategy=typeof EDIT_AUTO_COLOR_STRATEGIES[number];
export type EditFloatRegionRenderer=(document:EditDocument,region:EditRegion,scale:number,signal?:AbortSignal)=>Promise<LinearPixelBuffer>;
export interface EditAutoColorResult {
 adjustments:AdjustmentSettings[];
 commandId?:string;
 layerIds?:string[];
 evidence:{algorithm:'edit-auto-v2';strategy:EditAutoColorStrategy;sampleCount:number;workingPrecision:'float32';
  neutralCount:number;neutralConfidence:number;newClippedPixelFraction:number;alphaPreserved:true;
  fallbackReason?:string;renderingVersion:2};
}
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const identityCurve=[{x:0,y:0},{x:255,y:255}];
function anchor(values:number[],fraction:number,upper=false):number {
 const index=(upper?Math.ceil:Math.floor)((values.length-1)*fraction);
 return values[Math.max(0,Math.min(values.length-1,index))];
}
function neutral(settings:AdjustmentSettings):boolean {
 if(settings.type==='levels')return settings.values.inputBlack===0&&settings.values.inputWhite===255;
 if(settings.type==='curves')return (Object.values(settings.values) as CurvePoint[][]).every(points=>points.every(p=>p.x===p.y));
 if(settings.type==='color_balance')return Object.values(settings.values.shadows).every(v=>Math.abs(v)<.001);
 return false;
}
function soften(settings:AdjustmentSettings,weight:number):AdjustmentSettings {
 const copy=structuredClone(settings);
 if(copy.type==='levels'){copy.values.inputBlack*=weight;copy.values.inputWhite=255+(copy.values.inputWhite-255)*weight;}
 if(copy.type==='curves')for(const points of Object.values(copy.values) as CurvePoint[][])for(const p of points)p.y=p.x+(p.y-p.x)*weight;
 if(copy.type==='color_balance')for(const band of [copy.values.shadows,copy.values.midtones,copy.values.highlights])for(const key of ['cyanRed','magentaGreen','yellowBlue'] as const)band[key]*=weight;
 return copy;
}

/** Statistics and final recipe validation use float working pixels, never Canvas delivery bytes. */
export function computeEditAutoColor(buffer:LinearPixelBuffer,strategy:EditAutoColorStrategy):EditAutoColorResult|null {
 if(!EDIT_AUTO_COLOR_STRATEGIES.includes(strategy))throw new RangeError('Unknown edit automatic strategy');
 const {width,height,data}=buffer;
 if(!(data instanceof Float32Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
  width>4096||height>4096||width*height>65536||data.length!==width*height*4)throw new RangeError('Invalid edit automatic float buffer size');
 const indices:number[]=[],channels:number[][]=[[],[],[]],luminances:number[]=[];
 for(let i=0;i<data.length;i+=4){
  if(![data[i],data[i+1],data[i+2],data[i+3]].every(Number.isFinite))throw new Error('Edit automatic requires finite working pixels');
  if(data[i+3]<0||data[i+3]>1)throw new Error('Edit automatic requires valid alpha');
  if(data[i+3]<.01)continue;
  indices.push(i);const rgb=[data[i],data[i+1],data[i+2]].map(encodeLinear);
  rgb.forEach((v,c)=>channels[c].push(v));luminances.push(.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]);
 }
 if(!indices.length)return null;
 channels.forEach(values=>values.sort((a,b)=>a-b));luminances.sort((a,b)=>a-b);
 const anchors=channels.map(values=>({black:clamp(anchor(values,.0005),0,.3),white:clamp(anchor(values,.9995,true),.31,1)}));
 const black=Math.min(...anchors.map(p=>p.black)),white=Math.max(...anchors.map(p=>p.white));
 const narrow=anchor(luminances,.98)-anchor(luminances,.02)<.025;
 const levels:AdjustmentSettings={type:'levels',values:{inputBlack:black*255,inputWhite:white*255,inputGamma:1,outputBlack:0,outputWhite:255}};
 let adjustments:AdjustmentSettings[]=narrow?[]:[levels];
 let fallbackReason:string|undefined=narrow?'Narrow luminance distribution retained':undefined;
 const neutralPixels=indices.filter(i=>{
  const rgb=[data[i],data[i+1],data[i+2]].map(encodeLinear),peak=Math.max(...rgb),low=Math.min(...rgb);
  return low>.12&&peak<.88&&(peak-low)/peak<.13;
 });
 const neutralBands=new Set(neutralPixels.map(i=>Math.floor((encodeLinear(data[i])+encodeLinear(data[i+1])+encodeLinear(data[i+2]))/3*4)));
 const neutralConfidence=Math.min(1,neutralPixels.length/64)*Math.min(1,neutralPixels.length/indices.length/.08)*Math.min(1,neutralBands.size/2);
 if(strategy==='autoTone'&&!narrow){
  const curve=(p:{black:number;white:number})=>[
   ...identityCurve.slice(0,1),...(p.black>0?[{x:p.black*255,y:0}]:[]),
   ...(p.white<1?[{x:p.white*255,y:255}]:[]),...identityCurve.slice(1)];
  adjustments=[{type:'curves',values:{rgb:structuredClone(identityCurve),red:curve(anchors[0]),green:curve(anchors[1]),blue:curve(anchors[2])}}];
 }
 if(strategy==='autoColor'){
  if(neutralConfidence<.5||neutralPixels.length<32||neutralBands.size<2)fallbackReason='Insufficient reliable neutral support; shared-channel contrast retained';
  else {
   const transformed=data.slice();adjustments.forEach(s=>applyFloatAdjustment(transformed,s));
   const median=[0,1,2].map(c=>anchor(neutralPixels.map(i=>encodeLinear(transformed[i+c])).sort((a,b)=>a-b),.5));
   const gray=.299*median[0]+.587*median[1]+.114*median[2];
   const correction=median.map(v=>Math.round(clamp((gray-v)*255,-15,15)*100)/100);
   const band={cyanRed:correction[0],magentaGreen:correction[1],yellowBlue:correction[2]};
   const values:ColorBalanceSettings={shadows:{...band},midtones:{...band},highlights:{...band},preserveLuminosity:true};
   adjustments.push({type:'color_balance',values});
  }
 }
 adjustments=adjustments.filter(s=>!neutral(s));
 const verify=(recipe:AdjustmentSettings[])=>{
  const output=data.slice();recipe.forEach(s=>applyFloatAdjustment(output,s));let clipped=0;
  for(const i of indices){
   if(![output[i],output[i+1],output[i+2]].every(Number.isFinite))throw new Error('Edit automatic produced nonfinite pixels');
   if(output[i+3]!==data[i+3])throw new Error('Edit automatic changed alpha');
   if([0,1,2].some(c=>data[i+c]<=1&&output[i+c]>1+1e-6))clipped++;
  }
  return clipped/indices.length;
 };
 let newClippedPixelFraction=verify(adjustments);
 if(newClippedPixelFraction>.003){
  fallbackReason='Generated adjustment exceeds representative clipped-channel limit';
  for(const weight of [.75,.5,.25,0]){
   const candidate=adjustments.map(s=>soften(s,weight)).filter(s=>!neutral(s)),fraction=verify(candidate);
   if(fraction<=.003){adjustments=candidate;newClippedPixelFraction=fraction;break;}
  }
 }
 return {adjustments,evidence:{algorithm:'edit-auto-v2',strategy,sampleCount:indices.length,workingPrecision:'float32',
  neutralCount:neutralPixels.length,neutralConfidence,newClippedPixelFraction,alphaPreserved:true,renderingVersion:2,...(fallbackReason?{fallbackReason}:{})}};
}

function signature(doc:EditDocument):string {return JSON.stringify({...doc,isDirty:false,updatedAt:0});}
class EditAutoAdjustmentCommand extends BaseCommand {
 private previousSelection:string|null=null;
 committed=false;
 constructor(documentId:string,private layers:AdjustmentLayer[],private docs:IDocumentManager,
  private expected?:string,private stale?:()=>boolean){super('Automatic edit color',documentId);}
 execute(){
  const doc=this.docs.getEditDocument(this.documentId);if(!doc)throw new Error('Edit document closed');
  if(this.expected&&(this.stale?.()||signature(doc)!==this.expected))throw new Error('Edit automatic cancelled because the source changed');
  this.expected=undefined;this.stale=undefined;this.previousSelection=doc.selectedLayerId;this.committed=true;
  this.docs.updateDocument({...doc,layers:[...doc.layers,...structuredClone(this.layers)],selectedLayerId:this.layers.at(-1)!.id},this.name);
 }
 undo(){const doc=this.docs.getEditDocument(this.documentId);if(!doc)return;
  const ids=new Set(this.layers.map(layer=>layer.id));this.docs.updateDocument({...doc,layers:doc.layers.filter(layer=>!ids.has(layer.id)),selectedLayerId:this.previousSelection},`Undo ${this.name}`);
 }
}

export class EditAutoColorService {
 private generation=0;
 private controller?:AbortController;
 constructor(private docs:IDocumentManager=defaultDocumentManager,private history:ICommandBus=defaultCommandBus,
  private render:EditFloatRegionRenderer=async(doc,region,scale,signal)=>{
   const {defaultImageEngine}=await import('../engine/WebGLImageEngine');return defaultImageEngine.renderEditFloatRegion(doc,region,scale,signal);
  }){}
 cancel(){this.generation++;this.controller?.abort();}
 async applyWithResult(id:string,strategy:EditAutoColorStrategy,signal?:AbortSignal):Promise<EditAutoColorResult|null>{
  if(!EDIT_AUTO_COLOR_STRATEGIES.includes(strategy))throw new RangeError('Unknown edit automatic strategy');
  this.controller?.abort();const controller=new AbortController();this.controller=controller;const generation=++this.generation;
  const doc=this.docs.getEditDocument(id);if(!doc)throw new Error('Edit document closed');
  if(doc.renderingVersion!==2||doc.bitDepth!==32||doc.workingProfile!=='linear-srgb')throw new Error('Edit automatic requires version 2 float precision');
  const snapshot=structuredClone(doc),expected=signature(doc);
  const stale=()=>{const current=this.docs.getEditDocument(id);return controller.signal.aborted||generation!==this.generation||this.docs.getActiveDocument()?.id!==id||!current||signature(current)!==expected;};
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  let command:EditAutoAdjustmentCommand|undefined,abortListener:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
  const unsubscribe=this.docs.subscribe(()=>{if(!command?.committed&&stale())controller.abort();});
  try {
   if(stale())return null;
   const cancellation=new Promise<never>((_,reject)=>{
    abortListener=()=>reject(new Error('Edit automatic analysis cancelled'));controller.signal.addEventListener('abort',abortListener,{once:true});
    timer=setTimeout(()=>{timedOut=true;reject(new Error('Edit automatic analysis timed out'));controller.abort();},5000);
   });
   const work=async()=>{
    const buffer=await this.render(snapshot,{x:0,y:0,width:snapshot.width,height:snapshot.height},Math.min(1,256/Math.max(snapshot.width,snapshot.height)),controller.signal);
    if(stale())return null;
    return computeEditAutoColor(buffer,strategy);
   };
   const result=await Promise.race([work(),cancellation]);if(stale())return null;
   if(!result)throw new Error('No visible float pixels available for edit automatic analysis');
   if(!result.adjustments.length)return result;
   const layers=result.adjustments.map(settings=>{
    const layer=createAdjustmentLayer({name:`${strategy} (${settings.type})`,adjustmentType:settings.type,settings});
    layer.transform.width=snapshot.width;layer.transform.height=snapshot.height;return layer;
   });
   command=new EditAutoAdjustmentCommand(id,layers,this.docs,expected,stale);
   await Promise.race([this.history.execute(command),cancellation]);
   return {...result,commandId:command.id,layerIds:layers.map(layer=>layer.id)};
  }catch(error){if(!timedOut&&stale())return null;throw error;}
  finally {if(timer)clearTimeout(timer);if(abortListener)controller.signal.removeEventListener('abort',abortListener);signal?.removeEventListener('abort',abort);unsubscribe();if(this.controller===controller)this.controller=undefined;}
 }
 async apply(id:string,strategy:EditAutoColorStrategy,signal?:AbortSignal):Promise<boolean>{return (await this.applyWithResult(id,strategy,signal))!==null;}
}
export const defaultEditAutoColor=new EditAutoColorService();
