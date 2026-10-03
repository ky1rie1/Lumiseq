import type { DevelopSettings, ResolvedAutoWhiteBalance, ToneCurves, WhiteBalanceSettings } from '../types/develop';
import { buildMonotonicCurveLUT } from './curveLut';
export type RGB = [number, number, number];
export const srgbToLinear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
export const linearToSrgb = (v: number) => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;
export const luminance = (rgb: RGB) => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const identity = [1,0,0,0,1,0,0,0,1];
const bradford = [.8951,.2664,-.1614,-.7502,1.7135,.0367,.0389,-.0685,1.0296];
const inverseBradford = [.9869929,-.1470543,.1599627,.4323053,.5183603,.0492912,-.0085287,.0400428,.9684867];
const rgbToXYZ = [.4124564,.3575761,.1804375,.2126729,.7151522,.072175,.0193339,.119192,.9503041];
const xyzToRGB = [3.2404542,-1.5371385,-.4985314,-.969266,1.8760108,.041556,.0556434,-.2040259,1.0572252];
export function multiplyColorMatrix(m: number[], rgb: RGB): RGB {
 return [0,1,2].map(row => m[row*3]*rgb[0]+m[row*3+1]*rgb[1]+m[row*3+2]*rgb[2]) as RGB;
}
function multiplyMatrices(a: number[], b: number[]): number[] {
 return Array.from({length:9},(_,i)=>[0,1,2].reduce((sum,k)=>sum+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0));
}
// Kang et al. 2002 Planckian approximation, within its 1667–25000 K domain.
function whiteXYZ(temperature: number, tint: number): RGB {
 const t=Math.max(2000,Math.min(12000,temperature));
 const x=t<=4000 ? -.2661239e9/t**3-.2343589e6/t**2+.8776956e3/t+.179910 : -3.0258469e9/t**3+2.1070379e6/t**2+.2226347e3/t+.24039;
 const y=t<=2222 ? -1.1063814*x**3-1.3481102*x*x+2.18555832*x-.20219683 : t<=4000 ? -.9549476*x**3-1.37418593*x*x+2.09137015*x-.16748867 : 3.081758*x**3-5.8733867*x*x+3.75112997*x-.37001483;
 // Tint is a bounded relative offset in CIE 1960 uv, not a measured Duv.
 const denominator=-2*x+12*y+3, u=4*x/denominator, v=6*y/denominator+Math.max(-150,Math.min(150,tint))*.0001;
 const d=2*u-8*v+4, tx=3*u/d, ty=2*v/d;
 return [tx/ty,1,(1-tx-ty)/ty];
}
/** Relative display correction: requested illuminant -> 5500K reference. Input already has camera WB. */
export function relativeWhiteBalanceMatrix(wb: WhiteBalanceSettings): number[] {
 if(wb.mode==='auto') {
  if (!isResolvedAutoWhiteBalance(wb.resolvedAuto)) throw new Error('自动白平衡需要已解析的原始图像校正，请重新选择自动或使用原照。');
  return [...wb.resolvedAuto.matrix];
 }
 if(wb.mode!=='custom'||((wb.temperature??5500)===5500&&(wb.tint??0)===0))return [...identity];
 const source=multiplyColorMatrix(bradford,whiteXYZ(wb.temperature??5500,wb.tint??0));
 const target=multiplyColorMatrix(bradford,whiteXYZ(5500,0));
 const scale=[target[0]/source[0],0,0,0,target[1]/source[1],0,0,0,target[2]/source[2]];
 return multiplyMatrices(xyzToRGB,multiplyMatrices(inverseBradford,multiplyMatrices(scale,multiplyMatrices(bradford,rgbToXYZ))));
}

export function isResolvedAutoWhiteBalance(value: unknown): value is ResolvedAutoWhiteBalance {
 if (!value || typeof value !== 'object') return false;
 const v = value as ResolvedAutoWhiteBalance;
 return v.version === 1 && v.algorithm === 'neutral-candidate-v1' &&
  (v.status === 'resolved' || v.status === 'as-shot-fallback') &&
  Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1 &&
  Number.isInteger(v.sampleCount) && v.sampleCount >= 0 && v.sampleCount <= 16384 &&
  Number.isInteger(v.candidateCount) && v.candidateCount >= 0 && v.candidateCount <= v.sampleCount &&
  Array.isArray(v.matrix) && v.matrix.length === 9 && v.matrix.every((n, i) =>
   Number.isFinite(n) && (i % 4 === 0 ? n >= .6 && n <= 1.67 : n === 0)) &&
  (v.status !== 'as-shot-fallback' || v.matrix.every((n, i) => n === identity[i]));
}

/** Conservative gray-candidate correction on unedited representative linear sRGB pixels.
 * Median log chromaticity resists outliers. Insufficient near-neutral support retains
 * camera WB. Colored objects can still look neutral: confidence describes support only.
 */
export function resolveAutomaticWhiteBalance(samples: readonly (readonly number[])[]): ResolvedAutoWhiteBalance {
 if (samples.length > 16384) throw new RangeError('Automatic white balance sample is too large');
 const candidates = samples.filter(rgb => rgb.length === 3 && rgb.every(Number.isFinite) &&
  Math.min(...rgb) > .01 && Math.max(...rgb) < .98 && luminance(rgb as RGB) > .025 &&
  Math.min(...rgb) / Math.max(...rgb) >= .65);
 const confidence = Math.min(1, candidates.length / 64) * Math.min(1, candidates.length / Math.max(1, samples.length) / .1);
 const supported = candidates.length >= 32 && confidence >= .5;
 let matrix = [...identity];
 if (supported) {
  const median = (values: number[]) => {
   values.sort((a,b)=>a-b); const middle=Math.floor(values.length/2);
   return values.length%2 ? values[middle] : (values[middle-1]+values[middle])/2;
  };
  const red = Math.exp(-median(candidates.map(rgb=>Math.log(rgb[0]/rgb[1]))));
  const blue = Math.exp(-median(candidates.map(rgb=>Math.log(rgb[2]/rgb[1]))));
  matrix = [red,0,0,0,1,0,0,0,blue];
 }
 return { version:1, algorithm:'neutral-candidate-v1', matrix, confidence,
  sampleCount:samples.length, candidateCount:candidates.length,
  status:supported?'resolved':'as-shot-fallback' };
}
export function applyRelativeWhiteBalance(rgb: RGB, matrix: number[]): RGB {
 const adjusted=multiplyColorMatrix(matrix,rgb);
 const before=luminance(rgb),after=luminance(adjusted);
 return adjusted.map(v=>v*(after>1e-8?before/after:1)) as RGB;
}
/** Positive-derivative luminance mapping. Neutral controls preserve working HDR.
 * Exposure precedes endpoints, contrast, shadow toe, and highlight shoulder. */
export function toneLuminanceV2(y: number, s: Pick<DevelopSettings,'contrast'|'shadows'|'highlights'|'whites'|'blacks'>): number {
 y *= Math.exp(s.blacks/100*Math.LN2/(1+y/.18));
 y *= Math.exp(s.whites/100*Math.LN2*y/(y+.5));
 if(s.contrast) y=.18*Math.expm1(Math.log1p(y/.18)*2**(s.contrast/100));
 y *= Math.exp(s.shadows/100*.75/(1+y/.18));
 if(s.highlights<0) {const d=Math.max(0,y-.35);y=Math.min(y,.35)+d/(1-s.highlights/100*1.5*d);}
 else if(s.highlights>0) y*=1+s.highlights/100*.75*y/(y+.55);
 return y;
}
export function applyBaseTone(rgb: RGB, settings: Pick<DevelopSettings,'exposure'|'contrast'|'shadows'|'highlights'|'whites'|'blacks'|'renderingVersion'>): RGB {
 if (settings.renderingVersion!==undefined && settings.renderingVersion!==1 && settings.renderingVersion!==2) throw new Error('Unsupported rendering version');
 let color=rgb.map(v=>v*2**settings.exposure) as RGB;
 if (settings.renderingVersion === 2) {
  const y=luminance(color),m=Math.abs(y);
  const target=toneLuminanceV2(m,settings);
  const gain=m>1e-12 ? target/m : 2**(settings.contrast/100)*Math.exp(settings.blacks/100*Math.LN2+settings.shadows/100*.75);
  return color.map(v=>v*gain) as RGB;
 }
 const y=luminance(color),bounded=Math.max(0,Math.min(1,y));
 let gain=(1+settings.shadows/100/(1+Math.exp((y-.25)*12))*.75)*(1+settings.highlights/100/(1+Math.exp(-(y-.55)*10))*.75);
 gain*=1+settings.whites/100*bounded**2*.6;
 gain*=2**(settings.blacks/100*(1-bounded)**2);
 color=color.map(v=>v*gain) as RGB;
 const toneY=luminance(color);
 if(settings.contrast&&toneY>1e-8){const target=.18*(toneY/.18)**(2**(settings.contrast/100));color=color.map(v=>v*target/toneY) as RGB;}
 return color;
}
export function curvesAreNeutral(curves: ToneCurves): boolean {
 return ([curves.rgb,curves.red,curves.green,curves.blue]).every(points=>!points.length||(points.length>=2&&points[0].x===0&&points.at(-1)!.x===1&&points.every(p=>p.x===p.y)));
}
export function buildDevelopCurveLUT(curves: ToneCurves, size=1024): Float32Array {
 const master=buildMonotonicCurveLUT(curves.rgb,size),channels=[curves.red,curves.green,curves.blue].map(points=>buildMonotonicCurveLUT(points,size));
 const output=new Float32Array(size*4);
 for(let i=0;i<size;i++){const p=master[i]*(size-1),a=Math.floor(p),b=Math.min(size-1,a+1),f=p-a;
  for(let c=0;c<3;c++)output[i*4+c]=channels[c][a]*(1-f)+channels[c][b]*f;output[i*4+3]=1;}
 return output;
}
export function sampleDevelopCurve(value: number, lut: Float32Array, channel: number): number {
 const size=lut.length/4,p=Math.max(0,Math.min(1,value))*(size-1),a=Math.floor(p),b=Math.min(size-1,a+1);
 const mapped=lut[a*4+channel]*(1-(p-a))+lut[b*4+channel]*(p-a);
 // Preserve HDR distance above the endpoint; no premature clipping.
 return mapped+Math.max(0,value-1)+Math.min(0,value);
}
function displayHsv(rgb: RGB): RGB {
 const display=rgb.map(linearToSrgb),max=Math.max(...display),min=Math.min(...display),delta=max-min;
 let hue=0;
 if(delta>1e-10)hue=(max===display[0] ? ((display[1]-display[2])/delta+6)%6 : max===display[1] ? (display[2]-display[0])/delta+2 : (display[0]-display[1])/delta+4)/6;
 return [hue,delta/(max+1e-10),max];
}

/** Circular eight-channel HSL, in the same extended display domain as native/GPU. */
export function applyDevelopHsl(rgb: RGB,hsl:DevelopSettings['hsl']): RGB {
 const names=['red','orange','yellow','green','aqua','blue','purple','magenta'] as const;
 if(!names.some(name=>hsl[name].hue || hsl[name].saturation || hsl[name].luminance))return rgb;
 const hsv=displayHsv(rgb),centers=[0,30,60,120,180,240,285,325],widths=[45,35,40,60,50,50,45,45];
 let total=0,hue=0,saturation=0,value=0;
 for(let i=0;i<8;i++){
  const absolute=Math.abs(hsv[0]*360-centers[i]),distance=Math.min(absolute,360-absolute);
  if(distance>=widths[i])continue;
  const weight=.5*(1+Math.cos(Math.PI*distance/widths[i])),setting=hsl[names[i]];
  total+=weight;hue+=weight*setting.hue*.3;saturation+=weight*(1+setting.saturation/100);value+=weight*setting.luminance/200;
 }
 if(total<=1e-4)return rgb;
 hsv[0]=((hsv[0]+hue/total/360)%1+1)%1;
 hsv[1]=Math.max(0,Math.min(1,hsv[1]*saturation/total));hsv[2]=Math.max(0,hsv[2]*(1+value/total));
 return [1,2/3,1/3].map(offset=>{
  const p=Math.abs(((hsv[0]+offset)%1)*6-3);
  return srgbToLinear(hsv[2]*(1-hsv[1]+hsv[1]*Math.max(0,Math.min(1,p-1))));
 }) as RGB;
}

export function applyDevelopColor(rgb: RGB,settings: DevelopSettings,lut: Float32Array): RGB {
 let color=rgb;
 if(!curvesAreNeutral(settings.curves))color=color.map((v,c)=>srgbToLinear(sampleDevelopCurve(linearToSrgb(v),lut,c))) as RGB;
 color=applyDevelopHsl(color,settings.hsl);
 const max=Math.max(...color),min=Math.min(...color),sat=(max-min)/Math.max(1e-4,max);
 const hue=displayHsv(color)[0];
 if(settings.vibrance){let boost=(1-sat)*settings.vibrance/100;if(hue>=.02&&hue<.12)boost*=.45;const y=luminance(color);color=color.map(v=>y+(v-y)*Math.max(0,Math.min(2.5,1+boost))) as RGB;}
 if(settings.saturation){const y=luminance(color);color=color.map(v=>y+(v-y)*Math.max(0,1+settings.saturation/100)) as RGB;}
 return color;
}
