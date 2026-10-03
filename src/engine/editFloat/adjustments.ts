import type { AdjustmentSettings, CurvePoint } from '../../types/edit';

const FLOAT_MAX = 3.4028234663852886e38;
export const unit = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
export const finiteFloat = (v: number): number => Number.isNaN(v) ? 0 : Math.max(-FLOAT_MAX, Math.min(FLOAT_MAX, v));
/** IEC sRGB transfer function with odd extension for signed working channels. */
export function encodeLinear(v: number): number {
  const a = Math.abs(v);
  return Math.sign(v) * (a <= .0031308 ? 12.92 * a : 1.055 * Math.pow(a, 1 / 2.4) - .055);
}
export function decodeEncoded(v: number): number {
  const a = Math.abs(v);
  return Math.sign(v) * (a <= .04045 ? a / 12.92 : Math.pow((a + .055) / 1.055, 2.4));
}
const signedPower = (v: number, exponent: number): number => Math.sign(v) * Math.pow(Math.abs(v), exponent);

/** Fritsch-Carlson tangents as in curveLut; evaluated continuously without a byte LUT. */
export function makeFloatCurve(points?: CurvePoint[]): (v: number) => number {
  if (!points?.length) return v => v;
  const sorted = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(p => ({ x: unit(p.x / 255), y: unit(p.y / 255) })).sort((a,b) => a.x-b.x);
  if (!sorted.length) return v => v;
  if (sorted[0].x > 0) sorted.unshift({x:0,y:sorted[0].y});
  if (sorted.at(-1)!.x < 1) sorted.push({x:1,y:sorted.at(-1)!.y});
  const p = sorted.filter((v,i) => !i || v.x > sorted[i-1].x + 1e-7);
  if (p.every(v => v.x === v.y)) return v => v;
  const n=p.length, m:number[]=[], d:number[]=[];
  if(n===1) return v=>p[0].y+(v<0?v:v>1?v-1:0);
  for(let i=0;i<n-1;i++) m[i]=(p[i+1].y-p[i].y)/(p[i+1].x-p[i].x);
  d[0]=m[0];d[n-1]=m[n-2];
  for(let i=1;i<n-1;i++) d[i]=m[i-1]*m[i]<=0?0:(m[i-1]+m[i])/2;
  for(let i=0;i<n-1;i++) {
    if(Math.abs(p[i+1].y-p[i].y)<1e-7) {d[i]=0;d[i+1]=0;}
    else { const a=d[i]/m[i],b=d[i+1]/m[i],norm=a*a+b*b;
      if(norm>9){const t=3/Math.sqrt(norm);d[i]=t*a*m[i];d[i+1]=t*b*m[i];}
    }
  }
  return v=>{
    // Endpoint translation preserves all signed/HDR distance outside the artistic domain.
    if(v<0)return p[0].y+v;
    if(v>1)return p[n-1].y+v-1;
    let j=0;while(j<n-2&&v>p[j+1].x)j++;
    const h=p[j+1].x-p[j].x,t=(v-p[j].x)/h;
    return (1+2*t)*(1-t)*(1-t)*p[j].y+t*(1-t)*(1-t)*h*d[j]+t*t*(3-2*t)*p[j+1].y+t*t*(t-1)*h*d[j+1];
  };
}

export function applyFloatAdjustment(data: Float32Array, settings: AdjustmentSettings): void {
  const curves=settings.type==='curves' ? [makeFloatCurve(settings.values.rgb),makeFloatCurve(settings.values.red),makeFloatCurve(settings.values.green),makeFloatCurve(settings.values.blue)] : undefined;
  for(let i=0;i<data.length;i+=4) {
    const original=[data[i],data[i+1],data[i+2]];
    let rgb=original;
    if(settings.type==='exposure') {
      const s=settings.values,factor=Math.pow(2,Number.isFinite(s.exposure)?s.exposure:0), gamma=Math.max(.01,Number.isFinite(s.gamma)?s.gamma!:1);
      rgb=rgb.map(v=>signedPower(v*factor+(Number.isFinite(s.offset)?s.offset!:0),1/gamma));
    } else {
      rgb=rgb.map(encodeLinear);
      switch(settings.type) {
        case 'brightness_contrast': {
          const {brightness,contrast}=settings.values;
          const c=Math.max(-100,Math.min(100,contrast)),factor=(259*(c+255))/(255*(259-c));
          rgb=rgb.map(v=>factor*(v+brightness/255-128/255)+128/255);break;
        }
        case 'levels': {
          const s=settings.values,range=Math.max(1/255,(s.inputWhite-s.inputBlack)/255);
          rgb=rgb.map(v=>s.outputBlack/255+signedPower((v-s.inputBlack/255)/range,1/Math.max(.01,s.inputGamma))*(s.outputWhite-s.outputBlack)/255);break;
        }
        case 'curves': rgb=rgb.map((v,c)=>curves![c+1](curves![0](v)));break;
        case 'hue_saturation': {
          const s=settings.values,max=Math.max(...rgb),min=Math.min(...rgb),chroma=max-min,mid=(max+min)/2;
          if(chroma>1e-15) {
            let hue=(max===rgb[0]?(rgb[1]-rgb[2])/chroma:max===rgb[1]?(rgb[2]-rgb[0])/chroma+2:(rgb[0]-rgb[1])/chroma+4);
            hue=((hue+s.hue/60)%6+6)%6;
            const c=chroma*(1+s.saturation/100),x=c*(1-Math.abs(hue%2-1));
            const channels=hue<1?[c,x,0]:hue<2?[x,c,0]:hue<3?[0,c,x]:hue<4?[0,x,c]:hue<5?[x,0,c]:[c,0,x];
            rgb=channels.map(v=>v+mid-c/2);
          }
          const l=s.lightness/100;
          rgb=rgb.map(v=>l>=0?v+l*(1-v):v*(1+l));break;
        }
        case 'color_balance': {
          const s=settings.values,lum=.299*rgb[0]+.587*rgb[1]+.114*rgb[2],sw=unit(1-lum/(128/255)),hw=unit((lum-128/255)/(127/255)),mw=1-sw-hw;
          const keys=['cyanRed','magentaGreen','yellowBlue'] as const;
          rgb=rgb.map((v,c)=>v+(s.shadows[keys[c]]*sw+s.midtones[keys[c]]*mw+s.highlights[keys[c]]*hw)/255);
          if(s.preserveLuminosity) { const next=.299*rgb[0]+.587*rgb[1]+.114*rgb[2];rgb=rgb.map(v=>v+lum-next); }break;
        }
        case 'black_and_white': {
          const s=settings.values,total=Math.abs(s.reds)+Math.abs(s.yellows)+Math.abs(s.greens)+Math.abs(s.cyans)+Math.abs(s.blues)+Math.abs(s.magentas),norm=total>0?1/total:1/6;
          const gray=(rgb[0]*(s.reds+.5*s.yellows+.5*s.magentas)+rgb[1]*(s.greens+.5*s.yellows+.5*s.cyans)+rgb[2]*(s.blues+.5*s.cyans+.5*s.magentas))*norm;
          rgb=[gray,gray,gray];break;
        }
      }
      rgb=rgb.map(decodeEncoded);
    }
    for(let c=0;c<3;c++)data[i+c]=finiteFloat(rgb[c]);
  }
}
