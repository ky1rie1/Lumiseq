import type { BlendMode } from '../../types/edit';
import { decodeEncoded, encodeLinear, finiteFloat, unit } from './adjustments';
type RGB=[number,number,number];
const lum=(c:readonly number[])=>.3*c[0]+.59*c[1]+.11*c[2];
const sat=(c:readonly number[])=>Math.max(...c)-Math.min(...c);
function clipColor(c:RGB,domainLower:number,domainUpper:number):RGB {
  const l=lum(c),n=Math.min(...c),x=Math.max(...c);
  // W3C nonseparable operations are defined on [0,1]; extend their bounds to
  // include signed/HDR colors instead of clipping the working buffer.
  const lower=Math.min(domainLower,l),upper=Math.max(domainUpper,l);
  if(n<lower)c=c.map(v=>l+(v-l)*(l-lower)/(l-n)) as RGB;
  if(x>upper)c=c.map(v=>l+(v-l)*(upper-l)/(x-l)) as RGB;
  return c;
}
function setLum(c:readonly number[],l:number,lower:number,upper:number):RGB {const delta=l-lum(c);return clipColor(c.map(v=>v+delta) as RGB,lower,upper);}
function setSat(c:readonly number[],s:number):RGB {
  const order=[0,1,2].sort((a,b)=>c[a]-c[b]),out:RGB=[0,0,0],min=order[0],mid=order[1],max=order[2];
  if(c[max]>c[min]){out[mid]=(c[mid]-c[min])*s/(c[max]-c[min]);out[max]=s;}
  return out;
}
function channel(b:number,s:number,mode:BlendMode):number {
  switch(mode) {
    case 'multiply':return b*s;
    case 'screen':return b+s-b*s;
    case 'overlay':return b<=.5?2*b*s:1-2*(1-b)*(1-s);
    case 'darken':return Math.min(b,s);
    case 'lighten':return Math.max(b,s);
    // Extend the W3C unit-domain function by preserving encoded endpoint excursions.
    case 'color-dodge': {const bb=unit(b),ss=unit(s);return (bb===0?0:ss===1?1:Math.min(1,bb/(1-ss)))+(b-bb)+(s-ss);}
    case 'color-burn': {const bb=unit(b),ss=unit(s);return (bb===1?1:ss===0?0:1-Math.min(1,(1-bb)/ss))+(b-bb)+(s-ss);}
    case 'hard-light':return s<=.5?2*b*s:1-2*(1-b)*(1-s);
    case 'soft-light':return s<=.5?b-(1-2*s)*b*(1-b):b+(2*s-1)*((b<=.25?((16*b-12)*b+4)*b:Math.sqrt(b))-b);
    case 'difference':return Math.abs(b-s);
    case 'exclusion':return b+s-2*b*s;
    default:return s;
  }
}
function blend(src:ArrayLike<number>,dst:ArrayLike<number>,mode:BlendMode):RGB {
  if(mode==='normal')return [src[0],src[1],src[2]];
  if(mode==='darken'||mode==='lighten')return [0,1,2].map(c=>channel(dst[c],src[c],mode)) as RGB;
  const s=[src[0],src[1],src[2]].map(encodeLinear),b=[dst[0],dst[1],dst[2]].map(encodeLinear);
  const lower=Math.min(0,...s,...b),upper=Math.max(1,...s,...b);
  let encoded:RGB;
  switch(mode) {
    case 'hue':encoded=setLum(setSat(s,sat(b)),lum(b),lower,upper);break;
    case 'saturation':encoded=setLum(setSat(b,sat(s)),lum(b),lower,upper);break;
    case 'color':encoded=setLum(s,lum(b),lower,upper);break;
    case 'luminosity':encoded=setLum(b,lum(s),lower,upper);break;
    default:encoded=[0,1,2].map(c=>channel(b[c],s[c],mode)) as RGB;
  }
  return encoded.map(decodeEncoded) as RGB;
}

/** W3C source-over: blend only in the overlap; retain source color in uncovered pixels. */
export function compositeFloatPixel(src: ArrayLike<number>, dst: ArrayLike<number>, mode: BlendMode, opacity: number): [number,number,number,number] {
  const sa=unit(src[3])*unit(opacity),da=unit(dst[3]),a=sa+da*(1-sa);
  if(a<=0)return [0,0,0,0];
  const mixed=blend(src,dst,mode);
  const out:[number,number,number,number]=[0,0,0,a];
  for(let c=0;c<3;c++)out[c]=finiteFloat((sa*((1-da)*src[c]+da*mixed[c])+da*(1-sa)*dst[c])/a);
  return out;
}
