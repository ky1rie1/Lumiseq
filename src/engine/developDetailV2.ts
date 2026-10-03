import type { DevelopSettings } from '../types/develop';
import { luminance } from './developColorMath';
export const perceptualLuma = (v:number) => Math.sign(v)*Math.log1p(16*Math.abs(v))/16;
const inverseLuma = (v:number) => Math.sign(v)*Math.expm1(16*Math.abs(v))/16;
const smooth = (a:number,b:number,v:number) => {const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};

/** Complete, normalized separable Gaussian; clamp coordinates only at actual image edges. */
export function gaussianField(input:Float32Array,width:number,height:number,sigma:number):Float32Array {
 sigma=Math.max(.35,sigma);const radius=Math.ceil(3*sigma),kernel=new Float32Array(radius*2+1);
 let sum=0;for(let i=-radius;i<=radius;i++){const w=Math.exp(-.5*(i/sigma)**2);kernel[i+radius]=w;sum+=w;}
 for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
 const temp=new Float32Array(input.length),output=new Float32Array(input.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let v=0;for(let k=-radius;k<=radius;k++)v+=input[y*width+Math.max(0,Math.min(width-1,x+k))]*kernel[k+radius];temp[y*width+x]=v;
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let v=0;for(let k=-radius;k<=radius;k++)v+=temp[Math.max(0,Math.min(height-1,y+k))*width+x]*kernel[k+radius];output[y*width+x]=v;
 }return output;
}

/** Gaussian guided filter with self guidance (He et al., ECCV 2010 equations 5–8).
 * Gaussian averaging replaces box averaging consistently on all backends. */
function guidedField(p:Float32Array,width:number,height:number,sigma:number):{low:Float32Array;mean:Float32Array} {
 const mean=gaussianField(p,width,height,sigma),square=gaussianField(p.map(v=>v*v),width,height,sigma);
 const a=new Float32Array(p.length),b=new Float32Array(p.length);
 for(let i=0;i<p.length;i++){const variance=Math.max(0,square[i]-mean[i]*mean[i]);a[i]=variance/(variance+.0004);b[i]=(1-a[i])*mean[i];}
 const ma=gaussianField(a,width,height,sigma),mb=gaussianField(b,width,height,sigma);
 return {low:p.map((v,i)=>ma[i]*v+mb[i]),mean};
}

/** Sequential brightness stages, preserving RGB chroma, signed values and HDR headroom. */
export function applyDetailV2(pixels:Float32Array,width:number,height:number,settings:DevelopSettings,scale=1):Float32Array {
 let output=pixels.slice();
 const stages=[{amount:settings.texture/100*1.2,sigma:scale,guided:true,threshold:0},
  {amount:settings.clarity/100*.85,sigma:4*scale,guided:true,threshold:0},
  {amount:settings.detail.sharpenAmount/100,sigma:Math.max(.5,settings.detail.sharpenRadius)*scale,guided:false,threshold:settings.detail.sharpenThreshold/255}];
 for(const stage of stages){
  if(!stage.amount)continue;
  const p=new Float32Array(width*height);for(let i=0;i<p.length;i++)p[i]=perceptualLuma(luminance([output[i*3],output[i*3+1],output[i*3+2]]));
  const gaussian=stage.guided ? null : gaussianField(p,width,height,stage.sigma);
  const filtered=stage.guided ? guidedField(p,width,height,stage.sigma) : {low:gaussian!,mean:gaussian!};
  for(let i=0;i<p.length;i++){
   const y=luminance([output[i*3],output[i*3+1],output[i*3+2]]),diff=p[i]-filtered.low[i];
   const noiseWeight=smooth(.0002,.002,Math.abs(diff)),thresholdWeight=stage.threshold ? smooth(stage.threshold*.5,stage.threshold*1.5+1e-6,Math.abs(diff)):1;
   // Bright isolated peaks receive less added shape change; original optical rays survive.
   const ratio=Math.abs(p[i])/(Math.abs(filtered.mean[i])+.0001),pointWeight=1-.85*smooth(1.5,3,ratio);
   const target=inverseLuma(p[i]+diff*stage.amount*noiseWeight*thresholdWeight*pointWeight);
   let delta=target-y;
   // Bound only the new increment; no clamp on working RGB or source HDR.
   const enhancementLimit=stage.amount>0 ? (delta*y<0 ? .02 : .35-.33*smooth(1.3,1.6,ratio)) : .35;
   const limit=.0002+enhancementLimit*Math.abs(y);delta=Math.max(-limit,Math.min(limit,delta));
   const stability=smooth(0,1e-5,Math.abs(y));
   const gain=Math.abs(y)>1e-12 ? 1+delta/y*stability : 1;
   for(let c=0;c<3;c++)output[i*3+c]*=gain;
  }
 }return output;
}
