import type { DevelopDocument } from '../types/develop';
import type { IAssetManager } from '../types/asset';
import { getPlatformBridge, type IPlatformBridge } from '../platform';
import { srgbToLinear, type RGB } from '../engine/developColorMath';

export interface FloatAutoToneSource {
 samples: RGB[];
 positions: [number,number][];
 tailSamples: RGB[];
 tailPositions: [number,number][];
 precision: 'float32' | 'uint16' | 'display8';
 sourcePixels: number;
 sourcePeak: number;
}
function validate(source:FloatAutoToneSource):FloatAutoToneSource {
 if(!source.samples.length || source.samples.length+source.tailSamples.length>65536 || source.tailSamples.length>512 ||
  source.samples.length!==source.positions.length || source.tailSamples.length!==source.tailPositions.length ||
  !Number.isSafeInteger(source.sourcePixels) || source.sourcePixels<1 || !Number.isFinite(source.sourcePeak) ||
  !['float32','uint16','display8'].includes(source.precision) ||
  [...source.samples,...source.tailSamples].some(rgb=>rgb.length!==3||!rgb.every(Number.isFinite)) ||
  [...source.positions,...source.tailPositions].some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1))) {
  throw new Error('Invalid automatic tone samples, coordinates or size limit');
 }
 return source;
}

/** RAW analysis reads unbounded working floats; display images disclose their quantized source. */
export async function readFloatAutoToneSource(doc:DevelopDocument,assets:IAssetManager,
 bridge:IPlatformBridge=getPlatformBridge()):Promise<FloatAutoToneSource> {
 if(doc.isRaw){
  if(doc.rawState!=='ready'||!doc.nativeAssetId)throw new Error('Automatic tone requires a decoded RAW source');
  if(!bridge.getRawToneSamples)throw new Error('Native automatic tone source sampling is unavailable');
  const result=await bridge.getRawToneSamples(doc.nativeAssetId);
  return validate({samples:result.samples as RGB[],positions:result.positions,tailSamples:result.tailSamples as RGB[],
   tailPositions:result.tailPositions,precision:result.sampleFormat,sourcePixels:result.sourcePixels,sourcePeak:result.peak});
 }
 const blob=doc.sourceAssetId?await assets.getBlob(doc.sourceAssetId):null;
 if(!blob || typeof createImageBitmap==='undefined')throw new Error('Automatic tone source pixels are unavailable');
 const bitmap=await createImageBitmap(blob);
 try {
  const scale=Math.min(1,250/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Automatic tone source sampling context is unavailable');
  ctx.imageSmoothingEnabled=false;ctx.drawImage(bitmap,0,0,width,height);
  const rgba=ctx.getImageData(0,0,width,height).data,samples:RGB[]=[],positions:[number,number][]=[];
  for(let i=0;i<rgba.length;i+=4){
   if(rgba[i+3]===0)continue;
   samples.push([srgbToLinear(rgba[i]/255),srgbToLinear(rgba[i+1]/255),srgbToLinear(rgba[i+2]/255)]);
   const pixel=i/4;positions.push([(pixel%width+.5)/width,(Math.floor(pixel/width)+.5)/height]);
  }
  const ordered=samples.map((rgb,index)=>({rgb,index,peak:Math.max(...rgb)})).sort((a,b)=>b.peak-a.peak).slice(0,Math.min(512,samples.length));
  return validate({samples,positions,tailSamples:ordered.map(p=>p.rgb),tailPositions:ordered.map(p=>positions[p.index]),
   precision:'display8',sourcePixels:bitmap.width*bitmap.height,sourcePeak:ordered[0]?.peak??0});
 } finally {bitmap.close();}
}
