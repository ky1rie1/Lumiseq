import type { SmartFilter } from '../../types/edit';
import type { LinearPixelBuffer } from './types';
import { normalizeSmartFilter } from '../../filters/smartFilters';
import { finiteFloat, unit } from './adjustments';

export function gaussianKernel(sigma: number): Float64Array {
  if(!Number.isFinite(sigma)||sigma<=0)return new Float64Array([1]);
  const r=Math.ceil(3*sigma),k=new Float64Array(2*r+1);let sum=0;
  for(let i=-r;i<=r;i++){k[i+r]=Math.exp(-i*i/(2*sigma*sigma));sum+=k[i+r];}
  for(let i=0;i<k.length;i++)k[i]/=sum;
  return k;
}

function convolve(data:Float32Array,width:number,height:number,k:Float64Array,horizontal:boolean):Float32Array {
  const out=new Float32Array(data.length),r=(k.length-1)/2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++) {
    let sum=0;
    for(let j=-r;j<=r;j++) {
      const xx=horizontal?Math.max(0,Math.min(width-1,x+j)):x,yy=horizontal?y:Math.max(0,Math.min(height-1,y+j));
      sum+=data[(yy*width+xx)*4+c]*k[j+r];
    }
    out[(y*width+x)*4+c]=finiteFloat(sum);
  }
  return out;
}

export function gaussianBlurFloat(buffer:LinearPixelBuffer,sigma:number):LinearPixelBuffer {
  const {width,height,data}=buffer,k=gaussianKernel(sigma);
  if(k.length===1)return {width,height,data:data.slice()};
  const premult=new Float32Array(data.length);
  for(let i=0;i<data.length;i+=4){const a=unit(data[i+3]);premult[i+3]=a;for(let c=0;c<3;c++)premult[i+c]=finiteFloat(data[i+c]*a);}
  const result=convolve(convolve(premult,width,height,k,true),width,height,k,false);
  for(let i=0;i<result.length;i+=4){const a=result[i+3];for(let c=0;c<3;c++)result[i+c]=a>0?finiteFloat(result[i+c]/a):0;}
  return {width,height,data:result};
}

const luma=(d:Float32Array,i:number)=>.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];

/** Two normalized bilateral neighborhoods, sigmaSpatial=radius, sigmaRange=.25*(1-preserveEdges)+.005. */
function bilateral(buffer:LinearPixelBuffer,sigma:number,preserve:number):LinearPixelBuffer {
  if(preserve<=0)return gaussianBlurFloat(buffer,sigma);
  const {width,height}=buffer,k=gaussianKernel(sigma),r=(k.length-1)/2,range=.25*(1-preserve)+.005;
  let data=buffer.data;
  for(const horizontal of [true,false]) {
    const out=new Float32Array(data.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const i=(y*width+x)*4,reference=luma(data,i);let total=0;const sums=[0,0,0];
      for(let j=-r;j<=r;j++) {
        const xx=horizontal?Math.max(0,Math.min(width-1,x+j)):x,yy=horizontal?y:Math.max(0,Math.min(height-1,y+j)),p=(yy*width+xx)*4;
        const delta=luma(data,p)-reference,w=k[j+r]*Math.exp(-delta*delta/(2*range*range))*unit(data[p+3]);
        total+=w;for(let c=0;c<3;c++)sums[c]+=w*data[p+c];
      }
      out[i+3]=data[i+3];for(let c=0;c<3;c++)out[i+c]=total>0?finiteFloat(sums[c]/total):data[i+c];
    }
    data=out;
  }
  return {width,height,data};
}

export function filterStackHalo(filters:readonly SmartFilter[]):number {
  return filters.reduce((sum,candidate)=>{const f=normalizeSmartFilter(candidate);return sum+(f.enabled&&f.opacity>0?Math.ceil(3*f.settings.radius):0);},0);
}

export function applyFloatFilterStack(buffer: LinearPixelBuffer, filters: readonly SmartFilter[]): LinearPixelBuffer {
  const {width,height}=buffer;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||buffer.data.length!==width*height*4)throw new Error('Invalid float filter buffer.');
  let current:LinearPixelBuffer={width,height,data:buffer.data.slice()};
  for(const candidate of filters) {
    const f=normalizeSmartFilter(candidate);if(!f.enabled||f.opacity<=0||f.settings.radius===0)continue;
    let after:LinearPixelBuffer;
    if(f.type==='gaussian_blur')after=gaussianBlurFloat(current,f.settings.radius);
    else if(f.type==='unsharp_mask') {
      const s=f.settings as {radius:number;amount:number;threshold:number},blur=gaussianBlurFloat(current,s.radius),d=current.data.slice();
      for(let i=0;i<d.length;i+=4) {
        const delta=luma(current.data,i)-luma(blur.data,i);
        if(Math.abs(delta)<s.threshold/255||current.data[i+3]<=0)continue;
        // Luminance-only USM avoids changing chromatic ratios on isolated color noise.
        for(let c=0;c<3;c++)d[i+c]=finiteFloat(d[i+c]+s.amount*delta);
      }
      after={width,height,data:d};
    } else {
      const s=f.settings as {radius:number;strength:number;preserveEdges:number},smooth=bilateral(current,s.radius,s.preserveEdges),d=current.data.slice();
      for(let i=0;i<d.length;i+=4)for(let c=0;c<3;c++)d[i+c]=finiteFloat(d[i+c]+s.strength*(smooth.data[i+c]-d[i+c]));
      after={width,height,data:d};
    }
    if(f.opacity>=1){current=after;continue;}
    const d=new Float32Array(current.data.length);
    for(let i=0;i<d.length;i+=4) {
      const beforeWeight=unit(current.data[i+3])*(1-f.opacity),afterWeight=unit(after.data[i+3])*f.opacity,a=beforeWeight+afterWeight;
      d[i+3]=a;for(let c=0;c<3;c++)d[i+c]=a>0?finiteFloat((current.data[i+c]*beforeWeight+after.data[i+c]*afterWeight)/a):0;
    }
    current={width,height,data:d};
  }
  return current;
}
