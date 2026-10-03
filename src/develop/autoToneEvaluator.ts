import type { DevelopSettings } from '../types/develop';
import type { IAssetManager } from '../types/asset';
import { applyBaseTone, applyDevelopColor, applyRelativeWhiteBalance, buildDevelopCurveLUT, luminance,
 relativeWhiteBalanceMatrix, type RGB } from '../engine/developColorMath';
import type { FloatAutoToneSource } from './autoToneSource';
import type { FloatAutoToneOptions, NaturalSemanticColorCandidate } from './floatAutoTone';

const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function maskAt(bytes:Uint8ClampedArray,width:number,height:number,p:[number,number]):number {
 const x=Math.max(0,Math.min(width-1,p[0]*width-.5)),y=Math.max(0,Math.min(height-1,p[1]*height-.5));
 const a=Math.floor(x),b=Math.floor(y),c=Math.min(width-1,a+1),d=Math.min(height-1,b+1),fx=x-a,fy=y-b;
 return ((bytes[b*width+a]*(1-fx)+bytes[b*width+c]*fx)*(1-fy)+
  (bytes[d*width+a]*(1-fx)+bytes[d*width+c]*fx)*fy)/255;
}

/** Uses production color and actual mask pixels; no thumbnail mask or color inference. */
export interface AutoToneEvaluatorSnapshot {
 settings:DevelopSettings;
 source:FloatAutoToneSource;
 masks:{mask:DevelopSettings['masks'][number];bytes:Uint8ClampedArray;width:number;height:number}[];
 semanticCandidate?:NaturalSemanticColorCandidate;
}
export async function createAutoToneEvaluatorSnapshot(settings:DevelopSettings,source:FloatAutoToneSource,
 assets:IAssetManager):Promise<AutoToneEvaluatorSnapshot> {
 const masks=await Promise.all(settings.masks.filter(m=>m.opacity>0).map(async mask=>{
  const handle=assets.getHandle(mask.maskAssetId),bytes=await assets.getMask(mask.maskAssetId);
  if(!handle?.width||!handle.height||!bytes||bytes.length!==handle.width*handle.height)throw new Error('Automatic tone mask source is unavailable');
  return {mask:structuredClone(mask),bytes:bytes.slice(),width:handle.width,height:handle.height};
 }));
 return {settings:structuredClone(settings),source:structuredClone(source),masks};
}
export async function createAutoToneEvaluator(settings:DevelopSettings,source:FloatAutoToneSource,
 assets:IAssetManager):Promise<NonNullable<FloatAutoToneOptions['evaluate']>> {
 return reconstructAutoToneEvaluator(await createAutoToneEvaluatorSnapshot(settings,source,assets));
}
/** Pure reconstruction allows exactly the same retained recipe to run in a dedicated worker. */
export function reconstructAutoToneEvaluator(snapshot:AutoToneEvaluatorSnapshot):NonNullable<FloatAutoToneOptions['evaluate']> {
 const {settings,source,masks}=snapshot;
 const matrix=relativeWhiteBalanceMatrix(settings.whiteBalance),lut=buildDevelopCurveLUT(settings.curves);
 const points=source.samples.map((rgb,i)=>({rgb:applyRelativeWhiteBalance(rgb,matrix),pos:source.positions[i]}));
 const tails=source.tailSamples.map((rgb,i)=>({rgb:applyRelativeWhiteBalance(rgb,matrix),pos:source.tailPositions[i]}));
 return (_rgb,patch,index,tail)=>{
  const point=(tail?tails:points)[index];
  if(!point)throw new Error('Automatic tone source coordinates are unavailable');
  let color=applyBaseTone(point.rgb,{...patch,renderingVersion:settings.renderingVersion});
  color=applyDevelopColor(color,{...settings,...patch},lut);
  for(const item of masks){
   const {mask}=item,value=maskAt(item.bytes,item.width,item.height,point.pos);
   const weight=clamp((mask.inverted?1-value:value)*mask.opacity);
   if(!weight)continue;
   let adjusted=color.map(v=>v*2**(mask.exposure??0)) as RGB;
   const temp=Math.max(-1,Math.min(1,(mask.temperature??0)/100))*.35;
   adjusted=[adjusted[0]*(1+temp),adjusted[1],adjusted[2]*(1-temp)];
   const y=luminance(adjusted),gain=(1+(mask.shadows??0)/100/(1+Math.exp((y-.25)*12))*.75)*
    (1+(mask.highlights??0)/100/(1+Math.exp(-(y-.55)*10))*.75);
   adjusted=adjusted.map(v=>v*gain) as RGB;
   const tone=luminance(adjusted);
   if(mask.contrast&&tone>1e-8)adjusted=adjusted.map(v=>v*(.18*(tone/.18)**(2**(mask.contrast!/100)))/tone) as RGB;
   const gray=luminance(adjusted),sat=Math.max(0,1+(mask.saturation??0)/100);
   adjusted=adjusted.map(v=>gray+(v-gray)*sat) as RGB;
   color=color.map((v,i)=>v+(adjusted[i]-v)*weight) as RGB;
  }
  const amount=settings.optics.vignetteAmount/100;
  if(amount){
   const radius=Math.hypot(point.pos[0]-.5,point.pos[1]-.5)*Math.SQRT2,mid=Math.max(.05,Math.min(.95,settings.optics.vignetteMidpoint/100));
   const t=clamp((radius-mid*.5)/mid),weight=t*t*(3-2*t);
   color=color.map(v=>amount<0?v*(1+amount*weight):v+(1-v)*amount*weight*.6) as RGB;
  }
  return color;
 };
}
