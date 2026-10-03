import { expect, it } from 'vitest';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';
import { applySpatialImage,applySpatialPixel } from './developSpatialMath';
import { applyBaseTone, toneLuminanceV2 } from './developColorMath';
import { DevelopProjectSerializer } from '../project/DevelopProjectSerializer';
import { createDevelopDocument } from '../document/DevelopDocument';
import { AssetManager } from '../assets/AssetManager';
it('round point lights do not add directional dark bands',()=>{
 const n=41,c=20,s=createDefaultDevelopSettings(true);Object.assign(s,{renderingVersion:2,clarity:40});s.detail.sharpenAmount=80;s.detail.sharpenRadius=1.8;
 const p=Float32Array.from(Array.from({length:n*n},(_,i)=>.002+.8*Math.exp(-((i%n-c)**2+(Math.floor(i/n)-c)**2)/2)).flatMap(v=>[v,v,v]));
 const out=applySpatialImage(p,n,n,s);
 let minimum=0;const axis:number[]=[],diagonal:number[]=[];
 for(let y=8;y<33;y++)for(let x=8;x<33;x++){const v=out[(y*n+x)*3],delta=v-p[(y*n+x)*3];minimum=Math.min(minimum,delta);if(y===c&&x>=c+4)axis.push(delta);if(y-c===x-c&&x>=c+3)diagonal.push(delta);}
 expect(minimum).toBeGreaterThan(-.001);
 expect(Math.min(...axis)-Math.min(...diagonal)).toBeGreaterThan(-.0004);
});
it('invalid rendering versions fail at the tone boundary',()=>{
 const s=createDefaultDevelopSettings(true);s.renderingVersion=3 as 2;
 expect(()=>applyBaseTone([.2,.3,.4],s)).toThrow(/rendering version/i);
});
it('new and legacy project versions reopen independently from RAW decode version',async()=>{
 const serializer=new DevelopProjectSerializer(),assets=new AssetManager();
 const doc=createDevelopDocument({sourceUri:'C:/fixtures/fixture.arw',fileName:'fixture.arw',isRaw:true});
 const json=await serializer.serialize(doc,assets),bridge={getRawMetadata:async()=>({width:5,height:5})} as any;
 expect((await serializer.hydrate(json,assets,bridge)).settings.renderingVersion).toBe(2);
 const old=JSON.parse(json);delete old.document.settings.renderingVersion;
 const reopened=await serializer.hydrate(JSON.stringify(old),assets,bridge);
 expect(reopened.settings.renderingVersion).toBe(1);expect(reopened.rawProcessingVersion).toBe(2);
});
it('project serialization rejects unknown snapshot rendering versions',async()=>{
 const doc=createDevelopDocument({sourceUri:'C:/fixtures/fixture.arw',fileName:'fixture.arw',isRaw:true});
 doc.settingsSnapshots=[{id:'s',name:'s',createdAt:0,settings:{...doc.settings,renderingVersion:3 as 2}}];
 await expect(new DevelopProjectSerializer().serialize(doc,new AssetManager())).rejects.toThrow(/rendering version/i);
});
it('single pixel evaluation agrees with batch processing away from and along source borders',()=>{
 const s=createDefaultDevelopSettings(true);s.texture=35;s.clarity=40;s.detail.sharpenAmount=80;
 const w=103,h=101,p=Float32Array.from(Array.from({length:w*h},(_,i)=>{const v=(i*11%37)/100;return [v,-.05+v,1.4+v];}).flat()),batch=applySpatialImage(p,w,h,s);
 for(const [x,y] of [[0,0],[51,50],[102,100],[2,98]])for(let c=0;c<3;c++)expect(applySpatialPixel(p,w,h,x,y,s)[c]).toBeCloseTo(batch[(y*w+x)*3+c],6);
});
it('signed HDR flat fields preserve channels and round fixtures rotate identically',()=>{
 const s=createDefaultDevelopSettings(true);s.texture=55;s.clarity=40;s.detail.sharpenAmount=80;
 const n=41,p=Float32Array.from(Array.from({length:n*n},(_,i)=>{const x=i%n,y=Math.floor(i/n);const v=.002+2*Math.exp(-((x-15.25)**2+(y-21.5)**2)/3);return [-.07+v,v,1.4+v];}).flat());
 const rotate=(a:Float32Array)=>{const b=new Float32Array(a.length);for(let y=0;y<n;y++)for(let x=0;x<n;x++)for(let c=0;c<3;c++)b[(x*n+n-1-y)*3+c]=a[(y*n+x)*3+c];return b;};
 const out=rotate(applySpatialImage(p,n,n,s)),other=applySpatialImage(rotate(p),n,n,s);
 expect(Math.max(...out.map((v,i)=>Math.abs(v-other[i])))).toBeLessThan(2e-6);
 const flat=Float32Array.from(Array.from({length:n*n},()=>[-.2,.4,3.5]).flat());
 const detailed=applySpatialImage(flat,n,n,s);expect(Math.max(...detailed.map((v,i)=>Math.abs(v-flat[i])))).toBeLessThan(2e-6);
});
it('ordinary sharpening meaningfully strengthens an edge without a fixed two-percent cap',()=>{
 const s=createDefaultDevelopSettings(true);s.detail.sharpenAmount=100;
 const w=41,p=Float32Array.from(Array.from({length:w},(_,x)=>[x<20?.1:.4,x<20?.1:.4,x<20?.1:.4]).flat());
 const out=applySpatialImage(p,w,1,s);
 expect(out[20*3]-.4).toBeGreaterThan(.045);
});
it('negative texture meaningfully smooths fine contrast',()=>{
 const s=createDefaultDevelopSettings(true);s.texture=-100;
 const n=41,p=Float32Array.from(Array.from({length:n*n},(_,i)=>[i%2?.02:.04,i%2?.02:.04,i%2?.02:.04]).flat());
 const out=applySpatialImage(p,n,n,s);
 expect(Math.abs(out[(20*n+20)*3]-out[(20*n+21)*3])).toBeLessThan(.012);
});
it('v2 compressed HDR staircase is monotonic with progressively lower gain',()=>{
 const s=createDefaultDevelopSettings(true);Object.assign(s,{renderingVersion:2,highlights:-100});
 const r=[.18,.5,1,2,4,8,16].map(v=>applyBaseTone([v,v,v],s)[0]);
 for(let i=1;i<r.length;i++)expect(r[i]).toBeGreaterThan(r[i-1]);
 expect(r.at(-1)!/16).toBeLessThan(.08);expect(r[4]).toBeLessThan(1.5);
});
it.each([-100,-50,50,100])('contrast %s pivots at middle gray and changes both sides in opposite directions',contrast=>{
 const s=createDefaultDevelopSettings(true);s.contrast=contrast;
 expect(toneLuminanceV2(.18,s)).toBeCloseTo(.18,10);
 expect((toneLuminanceV2(.02,s)-.02)*contrast).toBeLessThan(0);
 expect((toneLuminanceV2(.5,s)-.5)*contrast).toBeGreaterThan(0);
});
it('negative highlights affect diffuse highlights while preserving middle gray and shadows',()=>{
 const s=createDefaultDevelopSettings(true);s.highlights=-100;
 expect(toneLuminanceV2(.18,s)).toBeCloseTo(.18,10);
 expect(toneLuminanceV2(.02,s)).toBeCloseTo(.02,10);
 expect(toneLuminanceV2(.5,s)).toBeLessThan(.43);
});
it('positive highlights preserve shadows and middle gray',()=>{
 const s=createDefaultDevelopSettings(true);s.highlights=100;
 expect(toneLuminanceV2(.02,s)).toBeCloseTo(.02,10);
 expect(toneLuminanceV2(.18,s)).toBeCloseTo(.18,10);
 expect(toneLuminanceV2(.5,s)).toBeGreaterThan(.6);
});
it('shadows lift deep detail with useful strength and negligible highlight spill',()=>{
 const s=createDefaultDevelopSettings(true);s.shadows=100;
 expect(toneLuminanceV2(.01,s)).toBeGreaterThan(.04);
 expect(toneLuminanceV2(1,s)).toBeLessThan(1.025);
 expect(toneLuminanceV2(0,s)).toBe(0);
});
it('every tone control remains monotone and finite across its range and HDR',()=>{
 const ramp=Array.from({length:240},(_,i)=>10**(-9+i*10/239));
 for(const name of ['contrast','highlights','shadows','whites','blacks'] as const)for(const value of [-100,-50,0,50,100]){
  const s=createDefaultDevelopSettings(true);s[name]=value;
  const out=ramp.map(y=>toneLuminanceV2(y,s));
  expect(out.every(Number.isFinite)).toBe(true);
  expect(out.every((y,i)=>i===0||y>out[i-1])).toBe(true);
 }
});
