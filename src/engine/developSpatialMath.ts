import type { DevelopSettings } from '../types/develop';
import { applyDetailV2 } from './developDetailV2';
import { type RGB } from './developColorMath';

/** Detail-only CPU counterpart; wavelet denoise runs before this, global haze after. */
export function applySpatialPixel(
  pixels: Float32Array, width: number, height: number, x: number, y: number,
  settings: DevelopSettings, scale = 1,
): RGB {
  if(settings.renderingVersion===2){
    const radius=(sigma:number)=>Math.ceil(3*Math.max(.35,sigma));
    const halo=(settings.texture?2*radius(scale):0)+(settings.clarity?2*radius(4*scale):0)+(settings.detail.sharpenAmount?radius(Math.max(.5,settings.detail.sharpenRadius)*scale):0);
    const left=Math.max(0,x-halo),top=Math.max(0,y-halo),right=Math.min(width,x+halo+1),bottom=Math.min(height,y+halo+1);
    const w=right-left,h=bottom-top,region=new Float32Array(w*h*3);
    for(let row=0;row<h;row++)region.set(pixels.subarray(((top+row)*width+left)*3,((top+row)*width+right)*3),row*w*3);
    const result=applyDetailV2(region,w,h,settings,scale),i=((y-top)*w+x-left)*3;
    return [result[i],result[i+1],result[i+2]];
  }
  const pixel = (px: number, py: number): RGB => {
    const offset = (py * width + px) * 3;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  };
  let color = pixel(x, y);
  const detail = settings.detail;
  if (!settings.texture && !settings.clarity && !detail.sharpenAmount) return color;
  const sample = (px: number, py: number): RGB => {
    px = Math.max(0, Math.min(width - 1, px)); py = Math.max(0, Math.min(height - 1, py));
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = px - x0, fy = py - y0;
    const a = pixel(x0, y0), b = pixel(x1, y0), c = pixel(x0, y1), d = pixel(x1, y1);
    return [0,1,2].map(i => (a[i] * (1 - fx) + b[i] * fx) * (1 - fy) + (c[i] * (1 - fx) + d[i] * fx) * fy) as RGB;
  };
  const blur = (radius: number, wide = false): RGB => {
    const r = radius * scale;
    const taps = wide ? [[r,0,.15],[-r,0,.15],[0,r,.15],[0,-r,.15],
      [r*2,0,.05],[-r*2,0,.05],[0,r*2,.05],[0,-r*2,.05]] :
      [[r,0,.15],[-r,0,.15],[0,r,.15],[0,-r,.15],[r,r,.0375],[-r,r,.0375],[r,-r,.0375],[-r,-r,.0375]];
    const sum = pixel(x, y).map(v => v * (wide ? .2 : .25)) as RGB;
    for (const [dx,dy,weight] of taps) {
      const value = sample(x + dx, y + dy);
      for (let i = 0; i < 3; i++) sum[i] += value[i] * weight;
    }
    return sum;
  };
  if (settings.texture) {
    const fine = blur(1);
    color = color.map((v,i) => v + (v - fine[i]) * settings.texture / 100 * 1.2) as RGB;
  }
  if (settings.clarity) {
    const middle = blur(4, true);
    color = color.map((v,i) => v + (v - middle[i]) * settings.clarity / 100 * .85) as RGB;
  }
  if (detail.sharpenAmount) {
    const blurred = blur(Math.max(.5, detail.sharpenRadius));
    const diff = color.map((v,i) => v - blurred[i]);
    if (Math.hypot(...diff) > detail.sharpenThreshold / 255) color = color.map((v,i) => v + diff[i] * detail.sharpenAmount / 100) as RGB;
  }
  return color;
}

/** Batch spatial processing avoids repeating image-wide decomposition per pixel. */
export function applySpatialImage(pixels:Float32Array,width:number,height:number,settings:DevelopSettings,scale=1):Float32Array {
 if(settings.renderingVersion===2)return applyDetailV2(pixels,width,height,settings,scale);
 const output=new Float32Array(pixels.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)output.set(applySpatialPixel(pixels,width,height,x,y,settings,scale),(y*width+x)*3);
 return output;
}
