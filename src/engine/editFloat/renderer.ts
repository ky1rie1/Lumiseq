import type { EditDocument, Layer, LayerMask, SmartFilter } from '../../types/edit';
import { IDENTITY, inverseMatrix, layerMatrix, linkedMaskTransform, multiplyMatrix, type Affine } from '../editTransforms';
import { normalizeSmartFilter } from '../../filters/smartFilters';
import type { EditRegion, FloatEditPorts, FloatRenderOptions, FloatSource, LinearPixelBuffer } from './types';
import { applyFloatAdjustment, decodeEncoded, finiteFloat, unit } from './adjustments';
import { applyFloatFilterStack, gaussianKernel } from './filters';
import { compositeFloatPixel } from './compositing';

type Pixel = [number,number,number,number];
const SOURCE_TILE = 256;
const OUTPUT_TILE = 512;
const MAX_PIXELS = 6_000_000;
const point = (m:Affine,x:number,y:number):[number,number] => [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
function checkAbort(signal?:AbortSignal):void {if(signal?.aborted)throw new DOMException('Float rendering aborted.','AbortError');}
function validateBuffer(b:LinearPixelBuffer,w:number,h:number):void {
  if(b.width!==w||b.height!==h||!(b.data instanceof Float32Array)||b.data.length!==w*h*4)throw new Error('Float source returned invalid pixel dimensions.');
  for(const v of b.data)if(!Number.isFinite(v))throw new Error('Float source returned non-finite channels.');
}
function validDimensions(w:number,h:number):boolean {return Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>0&&h>0&&w*h<=150_000_000;}

/** Filter stages have separate bounded halos: a long stack never requires a full source plane. */
class SourceSampler {
  private cache=new Map<string,LinearPixelBuffer|Promise<LinearPixelBuffer>>();
  private filters:SmartFilter[];
  get dimensions():{width:number;height:number;originX:number;originY:number}{return {width:this.source.width,height:this.source.height,originX:this.source.originX??0,originY:this.source.originY??0};}
  constructor(private source:FloatSource,filters:readonly SmartFilter[],private signal?:AbortSignal) {
    if(!validDimensions(source.width,source.height))throw new Error('Invalid float source dimensions.');
    this.filters=filters.map(normalizeSmartFilter).filter(f=>f.enabled&&f.opacity>0&&f.settings.radius>0);
  }
  private memo(key:string,create:()=>Promise<LinearPixelBuffer>):LinearPixelBuffer|Promise<LinearPixelBuffer> {
    checkAbort(this.signal);const hit=this.cache.get(key);
    if(hit){this.cache.delete(key);this.cache.set(key,hit);return hit;}
    const job=create().then(b=>{this.cache.set(key,b);this.trim();return b;},error=>{this.cache.delete(key);throw error;});
    this.cache.set(key,job);this.trim();return job;
  }
  private trim():void {while(this.cache.size>32)this.cache.delete(this.cache.keys().next().value!);}
  private tile(stage:number,tx:number,ty:number):LinearPixelBuffer|Promise<LinearPixelBuffer> {return this.memo(`f:${stage}:${tx}:${ty}`,()=>this.createTile(stage,tx,ty));}
  private async createTile(stage:number,tx:number,ty:number):Promise<LinearPixelBuffer> {
    const x=tx*SOURCE_TILE,y=ty*SOURCE_TILE,w=Math.min(SOURCE_TILE,this.source.width-x),h=Math.min(SOURCE_TILE,this.source.height-y);
    if(stage===0){const b=await this.source.getRegion({x,y,width:w,height:h});checkAbort(this.signal);validateBuffer(b,w,h);return b;}
    const f=this.filters[stage-1],halo=Math.ceil(3*f.settings.radius),left=Math.max(0,x-halo),top=Math.max(0,y-halo);
    const region={x:left,y:top,width:Math.min(this.source.width,x+w+halo)-left,height:Math.min(this.source.height,y+h+halo)-top};
    const input=await this.region(stage-1,region),filtered=applyFloatFilterStack(input,[f]),out=new Float32Array(w*h*4);
    for(let j=0;j<h;j++)out.set(filtered.data.subarray(((j+y-top)*region.width+x-left)*4,((j+y-top)*region.width+x-left+w)*4),j*w*4);
    return {width:w,height:h,data:out};
  }
  private async region(stage:number,r:EditRegion):Promise<LinearPixelBuffer> {
    const data=new Float32Array(r.width*r.height*4);
    for(let ty=Math.floor(r.y/SOURCE_TILE);ty<=Math.floor((r.y+r.height-1)/SOURCE_TILE);ty++)for(let tx=Math.floor(r.x/SOURCE_TILE);tx<=Math.floor((r.x+r.width-1)/SOURCE_TILE);tx++) {
      const tile=await this.tile(stage,tx,ty),left=Math.max(r.x,tx*SOURCE_TILE),top=Math.max(r.y,ty*SOURCE_TILE),right=Math.min(r.x+r.width,tx*SOURCE_TILE+tile.width),bottom=Math.min(r.y+r.height,ty*SOURCE_TILE+tile.height);
      for(let y=top;y<bottom;y++)data.set(tile.data.subarray(((y-ty*SOURCE_TILE)*tile.width+left-tx*SOURCE_TILE)*4,((y-ty*SOURCE_TILE)*tile.width+right-tx*SOURCE_TILE)*4),((y-r.y)*r.width+left-r.x)*4);
    }
    return {width:r.width,height:r.height,data};
  }
  private mipDimensions(lx:number,ly:number):{width:number;height:number} {return {width:Math.ceil(this.source.width/2**lx),height:Math.ceil(this.source.height/2**ly)};}
  private mipTile(lx:number,ly:number,tx:number,ty:number):LinearPixelBuffer|Promise<LinearPixelBuffer> {
    if(!lx&&!ly)return this.tile(this.filters.length,tx,ty);
    return this.memo(`m:${lx}:${ly}:${tx}:${ty}`,async()=>{
      const dims=this.mipDimensions(lx,ly),px=lx>0?lx-1:0,py=lx>0?ly:ly-1,previous=this.mipDimensions(px,py),fx=lx>0?2:1,fy=lx>0?1:2;
      const x=tx*SOURCE_TILE,y=ty*SOURCE_TILE,w=Math.min(SOURCE_TILE,dims.width-x),h=Math.min(SOURCE_TILE,dims.height-y);
      const r={x:x*fx,y:y*fy,width:Math.min(previous.width-x*fx,w*fx),height:Math.min(previous.height-y*fy,h*fy)};
      const data=new Float32Array(r.width*r.height*4);
      for(let sy=Math.floor(r.y/SOURCE_TILE);sy<=Math.floor((r.y+r.height-1)/SOURCE_TILE);sy++)for(let sx=Math.floor(r.x/SOURCE_TILE);sx<=Math.floor((r.x+r.width-1)/SOURCE_TILE);sx++) {
        const tile=await this.mipTile(px,py,sx,sy),left=Math.max(r.x,sx*SOURCE_TILE),top=Math.max(r.y,sy*SOURCE_TILE),right=Math.min(r.x+r.width,sx*SOURCE_TILE+tile.width),bottom=Math.min(r.y+r.height,sy*SOURCE_TILE+tile.height);
        for(let row=top;row<bottom;row++)data.set(tile.data.subarray(((row-sy*SOURCE_TILE)*tile.width+left-sx*SOURCE_TILE)*4,((row-sy*SOURCE_TILE)*tile.width+right-sx*SOURCE_TILE)*4),((row-r.y)*r.width+left-r.x)*4);
      }
      const output=new Float32Array(w*h*4);
      for(let row=0;row<h;row++)for(let col=0;col<w;col++) {
        const i=(row*w+col)*4;let alpha=0,count=0;const sum=[0,0,0];
        for(let dy=0;dy<fy;dy++)for(let dx=0;dx<fx;dx++) {
          const xx=col*fx+dx,yy=row*fy+dy;if(xx>=r.width||yy>=r.height)continue;
          const p=(yy*r.width+xx)*4,a=unit(data[p+3]);alpha+=a;count++;for(let c=0;c<3;c++)sum[c]+=data[p+c]*a;
        }
        output[i+3]=alpha/count;for(let c=0;c<3;c++)output[i+c]=alpha>0?finiteFloat(sum[c]/alpha):0;
      }
      return {width:w,height:h,data:output};
    });
  }
  private pixel(x:number,y:number,lx:number,ly:number):Pixel|Promise<Pixel> {
    const dims=this.mipDimensions(lx,ly);x=Math.max(0,Math.min(dims.width-1,x));y=Math.max(0,Math.min(dims.height-1,y));
    const tx=Math.floor(x/SOURCE_TILE),ty=Math.floor(y/SOURCE_TILE),tile=this.mipTile(lx,ly,tx,ty);
    const read=(b:LinearPixelBuffer):Pixel=>{const i=((y-ty*SOURCE_TILE)*b.width+x-tx*SOURCE_TILE)*4;return [b.data[i],b.data[i+1],b.data[i+2],b.data[i+3]];};
    return tile instanceof Promise?tile.then(read):read(tile);
  }
  sample(x:number,y:number,footprintX=1,footprintY=1):Pixel|Promise<Pixel> {
    const minify=footprintX>1.000001||footprintY>1.000001,lx=Math.max(0,Math.floor(Math.log2(Math.max(1,footprintX)))),ly=Math.max(0,Math.floor(Math.log2(Math.max(1,footprintY))));
    const fx=Math.max(1,footprintX/2**lx),fy=Math.max(1,footprintY/2**ly);
    x=x/2**lx-.5;y=y/2**ly-.5;
    const xs=sampleWeights(x,minify?fx:0),ys=sampleWeights(y,minify?fy:0);
    const samples:(Pixel|Promise<Pixel>)[]=[],weights:number[]=[];
    for(const [sy,wy] of ys)for(const [sx,wx] of xs){weights.push(wx*wy);samples.push(this.pixel(sx,sy,lx,ly));}
    const mix=(pixels:Pixel[]):Pixel=>{
      const out:Pixel=[0,0,0,0];for(let p=0;p<pixels.length;p++){const a=unit(pixels[p][3])*weights[p];out[3]+=a;for(let c=0;c<3;c++)out[c]+=pixels[p][c]*a;}
      const alpha=out[3];for(let c=0;c<3;c++)out[c]=alpha>1e-12?finiteFloat(out[c]/alpha):0;out[3]=unit(alpha);return out;
    };
    return samples.some(p=>p instanceof Promise)?Promise.all(samples).then(mix):mix(samples as Pixel[]);
  }
}

function sampleWeights(center:number,footprint:number):[number,number][] {
  if(!footprint){const i=Math.floor(center),f=center-i;return [[i,1-f],[i+1,f]].filter(([,w])=>w!==0) as [number,number][];}
  const radius=3*footprint,weights:[number,number][]=[],sinc=(v:number)=>Math.abs(v)<1e-12?1:Math.sin(Math.PI*v)/(Math.PI*v);let total=0;
  for(let i=Math.ceil(center-radius);i<=Math.floor(center+radius);i++){const d=(i-center)/footprint,w=Math.abs(d)<3?sinc(d)*sinc(d/3):0;if(Math.abs(w)<1e-12)continue;weights.push([i,w]);total+=w;}
  for(const pair of weights)pair[1]/=total;return weights;
}

type MaskBuffer={width:number;height:number;data:Uint8ClampedArray};
/** Scalar Gaussian mask tiles use a narrow strip; feathering never expands a camera-sized float plane. */
class MaskSampler {
  private cache=new Map<string,{width:number;height:number;data:Float32Array}>();
  private kernel:Float64Array;
  private tileSize:number;
  constructor(private buffer:MaskBuffer,feather:number) {
    if(!validDimensions(buffer.width,buffer.height)||buffer.data.length!==buffer.width*buffer.height)throw new Error('Invalid float layer mask dimensions.');
    if(!Number.isFinite(feather)||feather<0||feather>2048)throw new Error('Invalid layer mask feather.');
    this.kernel=gaussianKernel(feather);this.tileSize=feather>16?32:128;
  }
  private pixel(x:number,y:number):number {
    if(x<0||y<0||x>=this.buffer.width||y>=this.buffer.height)return 0;
    if(this.kernel.length===1)return this.buffer.data[y*this.buffer.width+x]/255;
    const tx=Math.floor(x/this.tileSize),ty=Math.floor(y/this.tileSize),key=`${tx}:${ty}`;
    let tile=this.cache.get(key);
    if(!tile){tile=this.makeTile(tx,ty);this.cache.set(key,tile);while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value!);}
    return tile.data[(y-ty*this.tileSize)*tile.width+x-tx*this.tileSize];
  }
  private makeTile(tx:number,ty:number):{width:number;height:number;data:Float32Array} {
    const x=tx*this.tileSize,y=ty*this.tileSize,w=Math.min(this.tileSize,this.buffer.width-x),h=Math.min(this.tileSize,this.buffer.height-y),r=(this.kernel.length-1)/2;
    const top=Math.max(0,y-r),bottom=Math.min(this.buffer.height,y+h+r),rows=bottom-top;
    const horizontal=new Float32Array(w*rows),out=new Float32Array(w*h),k=this.kernel,b=this.buffer;
    for(let row=0;row<rows;row++)for(let col=0;col<w;col++) {
      let sum=0;for(let j=-r;j<=r;j++){const sx=Math.max(0,Math.min(b.width-1,x+col+j));sum+=b.data[(top+row)*b.width+sx]/255*k[j+r];}horizontal[row*w+col]=sum;
    }
    for(let row=0;row<h;row++)for(let col=0;col<w;col++) {
      let sum=0;for(let j=-r;j<=r;j++){const sy=Math.max(0,Math.min(b.height-1,y+row+j));sum+=horizontal[(sy-top)*w+col]*k[j+r];}out[row*w+col]=sum;
    }
    return {width:w,height:h,data:out};
  }
  sample(x:number,y:number):number {
    if(x<0||y<0||x>=this.buffer.width||y>=this.buffer.height)return 0;
    x-=.5;y-=.5;const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const pixel=(px:number,py:number)=>this.pixel(Math.max(0,Math.min(this.buffer.width-1,px)),Math.max(0,Math.min(this.buffer.height-1,py)));
    return pixel(ix,iy)*(1-fx)*(1-fy)+pixel(ix+1,iy)*fx*(1-fy)+pixel(ix,iy+1)*(1-fx)*fy+pixel(ix+1,iy+1)*fx*fy;
  }
  contains(x:number,y:number):boolean{return x>=0&&y>=0&&x<this.buffer.width&&y<this.buffer.height;}
}

function parseBackground(color:string):Pixel {
  if(!color||color==='transparent')return [0,0,0,0];
  let encoded:number[];
  if(/^#[0-9a-f]{3,4}$/i.test(color))encoded=[...color.slice(1)].map(v=>parseInt(v+v,16)/255);
  else if(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color))encoded=color.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255);
  else {
    const match=/^rgba?\(\s*([\d.]+)(%)?\s*[, ]\s*([\d.]+)(%)?\s*[, ]\s*([\d.]+)(%)?(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/i.exec(color);
    if(!match)throw new Error(`Unsupported document background color: ${color}`);
    encoded=[Number(match[1])/(match[2]?100:255),Number(match[3])/(match[4]?100:255),Number(match[5])/(match[6]?100:255),match[7]===undefined?1:Number(match[7])/(match[8]?100:1)];
  }
  return [decodeEncoded(unit(encoded[0])),decodeEncoded(unit(encoded[1])),decodeEncoded(unit(encoded[2])),unit(encoded[3]??1)];
}

interface RenderContext {
  region:EditRegion; width:number; height:number; scale:number; scaleY:number; options:FloatRenderOptions;
  sources:Map<string,Promise<SourceSampler>>; masks:Map<string,Promise<MaskSampler>>;
}

export class FloatEditRenderer {
  constructor(private ports:FloatEditPorts){}
  async renderRegion(document:EditDocument,region:EditRegion,options:FloatRenderOptions={}):Promise<LinearPixelBuffer> {
    const requestedScale = options.scale ?? 1, requestedScaleY = options.scaleY ?? requestedScale;
    const scale = Math.ceil(region.width * requestedScale - 1e-9) / region.width;
    const scaleY = Math.ceil(region.height * requestedScaleY - 1e-9) / region.height;
    options = {...options, scale, scaleY};
    if (scale !== 1 || scaleY !== 1) {
      const only = document.layers.length === 1 ? document.layers[0] : undefined;
      const t = only?.transform;
      if (only && only.visible && only.opacity === 1 && (only.fillOpacity ?? 1) === 1 && only.blendMode === 'normal' &&
          !only.clipToBelow && !only.mask?.enabled && !options.layerOverrides?.size &&
          (only.type === 'develop-smart-object' || (only.type === 'image' && parseBackground(document.backgroundColor)[3] === 0)) &&
          t?.x === 0 && t.y === 0 && t.width === document.width && t.height === document.height && t.rotation === 0 && t.scaleX === 1 && t.scaleY === 1) {
        const original = only.type === 'develop-smart-object' ? await this.ports.getRawSource(only) : await this.ports.getSource(only.sourceAssetId);
        if (original.width === document.width && original.height === document.height) {
          // A full-frame linear source needs no second original-grid composition pass.
          const direct = new FloatEditRenderer({...this.ports, getSource: async () => original, getRawSource: async () => original});
          return direct.renderDirectRegion(document, region, options);
        }
      }
      // Resize the fully developed/composited original grid, including nonlinear adjustments.
      const source: FloatSource = { width: document.width, height: document.height,
        getRegion: nativeRegion => this.renderDirectRegion(document, nativeRegion, { ...options, scale: 1, scaleY: 1 }) };
      const layer: Layer = { id: 'final-composite', name: 'final-composite', type: 'image', sourceAssetId: 'final-composite', naturalWidth: document.width, naturalHeight: document.height,
        visible: true, opacity: 1, blendMode: 'normal', transform: { x: 0, y: 0, width: document.width, height: document.height, rotation: 0, scaleX: 1, scaleY: 1 } };
      const final = new FloatEditRenderer({ ...this.ports, getSource: async () => source });
      return final.renderDirectRegion({ ...document, layers: [layer], backgroundColor: 'transparent' }, region, { signal: options.signal, scale, scaleY });
    }
    return this.renderDirectRegion(document, region, options);
  }
  private async renderDirectRegion(document:EditDocument,region:EditRegion,options:FloatRenderOptions={}):Promise<LinearPixelBuffer> {
    checkAbort(options.signal);const scale=options.scale??1,scaleY=options.scaleY??scale;
    if(!validDimensions(document.width,document.height)||![region.x,region.y,region.width,region.height,scale,scaleY].every(Number.isFinite)||region.x<0||region.y<0||region.width<=0||region.height<=0||scale<=0||scaleY<=0||region.x+region.width>document.width+1e-7||region.y+region.height>document.height+1e-7)throw new Error('Invalid float render region.');
    const width=Math.ceil(region.width*scale-1e-9),height=Math.ceil(region.height*scaleY-1e-9);
    if(!validDimensions(width,height)||width>4096||height>4096||width*height>MAX_PIXELS)throw new Error('Float render region exceeds bounded pixel limits.');
    const output=new Float32Array(width*height*4),background=parseBackground(document.backgroundColor);
    const sources=new Map<string,Promise<SourceSampler>>(),masks=new Map<string,Promise<MaskSampler>>();
    for(let oy=0;oy<height;oy+=OUTPUT_TILE)for(let ox=0;ox<width;ox+=OUTPUT_TILE) {
      checkAbort(options.signal);const w=Math.min(OUTPUT_TILE,width-ox),h=Math.min(OUTPUT_TILE,height-oy),ctx:RenderContext={region:{x:region.x+ox/scale,y:region.y+oy/scaleY,width:w/scale,height:h/scaleY},width:w,height:h,scale,scaleY,options,sources,masks};
      const tile=new Float32Array(w*h*4);for(let i=0;i<tile.length;i+=4)tile.set(background,i);
      await this.layers(document.layers,IDENTITY,tile,ctx);
      for(let y=0;y<h;y++)output.set(tile.subarray(y*w*4,(y+1)*w*4),((oy+y)*width+ox)*4);
    }
    return {width,height,data:output};
  }
  private source(layer:Layer,ctx:RenderContext):Promise<SourceSampler> {
    const existing=ctx.sources.get(layer.id);if(existing)return existing;
    const job=(async()=>{
      let s=ctx.options.layerOverrides?.get(layer.id);
      if(!s) {
        if(layer.type==='develop-smart-object')s=await this.ports.getRawSource(layer);
        else if(layer.type==='text') {if(!this.ports.getTextSource)throw new Error('Float text source adapter is unavailable.');s=await this.ports.getTextSource(layer);}
        else if(layer.type==='paint'||layer.type==='retouch')s=layer.rasterAssetId ? await this.ports.getSource(layer.rasterAssetId) : {
          width: layer.naturalWidth, height: layer.naturalHeight,
          getRegion: async r => ({width: r.width, height: r.height, data: new Float32Array(r.width * r.height * 4)}),
        };
        else if(layer.type==='image'||layer.type==='smart-object'||layer.type==='generated-patch')s=await this.ports.getSource(layer.sourceAssetId);
        else throw new Error(`Unsupported float source layer: ${layer.type}`);
      }
      checkAbort(ctx.options.signal);return new SourceSampler(s,layer.type==='smart-object'?layer.smartFilters??[]:[],ctx.options.signal);
    })();ctx.sources.set(layer.id,job);return job;
  }
  private async mask(layer:Layer,world:Affine,ctx:RenderContext):Promise<((x:number,y:number)=>number)|undefined> {
    const mask:LayerMask|undefined=layer.mask?.enabled?layer.mask:layer.type==='generated-patch'&&!layer.mask?{id:layer.maskAssetId,assetId:layer.maskAssetId,enabled:true,linked:false,density:1,feather:0}:undefined;
    if(!mask)return undefined;
    if(!Number.isFinite(mask.density)||mask.density<0||mask.density>1)throw new Error('Invalid layer mask density.');
    const key=`${mask.assetId}:${mask.feather}`;let job=ctx.masks.get(key);
    if(!job){job=this.ports.getMask(mask.assetId).then(b=>new MaskSampler(b,mask.feather));ctx.masks.set(key,job);}
    const sampler=await job,inv=inverseMatrix(linkedMaskTransform(world,mask,layer.transform));
    return (x,y)=>{const [mx,my]=point(inv,x,y);if(!sampler.contains(mx,my))return 0;const value=sampler.sample(mx,my);return 1-mask.density+mask.density*(mask.inverted?1-value:value);};
  }
  private async layers(layers:readonly Layer[],parent:Affine,dest:Float32Array,ctx:RenderContext):Promise<void> {
    let clipBase:Float32Array|undefined;
    for(const layer of layers) {
      checkAbort(ctx.options.signal);if(!layer.visible||layer.opacity<=0){if(!layer.clipToBelow&&layer.type!=='adjustment')clipBase=undefined;continue;}
      const world=multiplyMatrix(parent,layerMatrix(layer.transform)),mask=await this.mask(layer,world,ctx),opacity=unit(layer.opacity)*unit(layer.fillOpacity??1);
      if(layer.type==='adjustment') {
        const adjusted=dest.slice();applyFloatAdjustment(adjusted,layer.settings);
        for(let y=0;y<ctx.height;y++)for(let x=0;x<ctx.width;x++) {
          const i=(y*ctx.width+x)*4,dx=ctx.region.x+(x+.5)/ctx.scale,dy=ctx.region.y+(y+.5)/ctx.scaleY;
          const weight=opacity*(mask?mask(dx,dy):1)*(layer.clipToBelow?(clipBase?.[i/4]??0):1);
          const src:Pixel=[adjusted[i],adjusted[i+1],adjusted[i+2],1],dst:Pixel=[dest[i],dest[i+1],dest[i+2],1],result=compositeFloatPixel(src,dst,layer.blendMode,weight);
          for(let c=0;c<3;c++)dest[i+c]=result[c];
        }
        continue;
      }
      const content=new Float32Array(dest.length);
      if(layer.type==='group')await this.layers(layer.children,world,content,ctx);
      else {
        const sampler=await this.source(layer,ctx),inv=inverseMatrix(world),source=ctx.options.layerOverrides?.get(layer.id);
        // Sampler knows source dimensions; natural dimensions are metadata only.
        const sourceDimensions=source??await this.sourceDimensions(layer,ctx);
        const localWidth=layer.type==='generated-patch'?layer.bounds.width:layer.transform.width,localHeight=layer.type==='generated-patch'?layer.bounds.height:layer.transform.height;
        if(!Number.isFinite(localWidth)||!Number.isFinite(localHeight)||localWidth<=0||localHeight<=0)throw new Error('Invalid float layer bounds.');
        const text = layer.type === 'text', originX = sourceDimensions.originX ?? 0, originY = sourceDimensions.originY ?? 0;
        const ratioX = text ? 1 : sourceDimensions.width/localWidth, ratioY = text ? 1 : sourceDimensions.height/localHeight;
        const footprintX=ratioX*Math.hypot(inv[0]/ctx.scale,inv[2]/ctx.scaleY),footprintY=ratioY*Math.hypot(inv[1]/ctx.scale,inv[3]/ctx.scaleY);
        for(let y=0;y<ctx.height;y++) {
          checkAbort(ctx.options.signal);
          for(let x=0;x<ctx.width;x++) {
            const [lx,ly]=point(inv,ctx.region.x+(x+.5)/ctx.scale,ctx.region.y+(y+.5)/ctx.scaleY);
            if(text ? lx < originX || ly < originY || lx >= originX + sourceDimensions.width || ly >= originY + sourceDimensions.height : lx<0||ly<0||lx>=localWidth||ly>=localHeight)continue;
            const result=sampler.sample(text ? lx-originX : lx*ratioX,text ? ly-originY : ly*ratioY,footprintX,footprintY);
            content.set(result instanceof Promise?await result:result,(y*ctx.width+x)*4);
          }
        }
      }
      const ownAlpha=new Float32Array(ctx.width*ctx.height);
      for(let y=0;y<ctx.height;y++)for(let x=0;x<ctx.width;x++) {
        const i=(y*ctx.width+x)*4,dx=ctx.region.x+(x+.5)/ctx.scale,dy=ctx.region.y+(y+.5)/ctx.scaleY;
        content[i+3]=unit(content[i+3])*(mask?mask(dx,dy):1);
        ownAlpha[i/4]=content[i+3]*opacity;
        if(layer.clipToBelow)content[i+3]*=clipBase?.[i/4]??0;
        const p=compositeFloatPixel(content.subarray(i,i+4),dest.subarray(i,i+4),layer.blendMode,opacity);dest.set(p,i);
      }
      if(!layer.clipToBelow)clipBase=ownAlpha;
    }
  }
  private async sourceDimensions(layer:Layer,ctx:RenderContext):Promise<{width:number;height:number;originX?:number;originY?:number}> {
    const sampler=await this.source(layer,ctx);
    return sampler.dimensions;
  }
}
