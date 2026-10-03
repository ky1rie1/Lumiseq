import {describe,expect,it} from 'vitest';
import type {AdjustmentLayer, DevelopSmartObjectLayer, EditDocument, GeneratedPatchLayer, GroupLayer, ImageLayer, Layer, PaintLayer, RetouchLayer, SmartObjectLayer, TextLayer} from '../../types/edit';
import {FloatEditRenderer} from './renderer';
import type {EditRegion,FloatEditPorts,FloatSource,LinearPixelBuffer} from './types';
import {applyFloatFilterStack} from './filters';
import {createDefaultDevelopSettings} from '../../document/DevelopDocument';
const transform=(width:number,height:number)=>({x:0,y:0,width,height,scaleX:1,scaleY:1,rotation:0});
const image=(id:string,w:number,h:number):ImageLayer=>({id,name:id,type:'image',sourceAssetId:id,naturalWidth:w,naturalHeight:h,visible:true,opacity:1,blendMode:'normal',transform:transform(w,h)});
const doc=(layers:Layer[],width=20,height=10):EditDocument=>({id:'doc',kind:'edit',name:'test',width,height,dpi:72,layers,selectedLayerId:null,selection:null,backgroundColor:'transparent',isDirty:false,updatedAt:0});
function fixture(width:number,height:number,pixel:(x:number,y:number)=>number[]) {
  const data=new Float32Array(width*height*4),requests:EditRegion[]=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(pixel(x,y),(y*width+x)*4);
  const source:FloatSource={width,height,async getRegion(r){requests.push({...r});const out=new Float32Array(r.width*r.height*4);
    for(let y=0;y<r.height;y++)out.set(data.subarray(((r.y+y)*width+r.x)*4,((r.y+y)*width+r.x+r.width)*4),y*r.width*4);
    return {width:r.width,height:r.height,data:out};}};
  return {source,data,requests};
}
function ports(source:FloatSource,mask?:{width:number;height:number;data:Uint8ClampedArray}):FloatEditPorts {
  return {getSource:async()=>source,getRawSource:async()=>source,getTextSource:async()=>source,getMask:async()=>mask!};
}
function crop(buffer:LinearPixelBuffer,r:EditRegion):number[]{const out:number[]=[];for(let y=0;y<r.height;y++)out.push(...buffer.data.slice(((y+r.y)*buffer.width+r.x)*4,((y+r.y)*buffer.width+r.x+r.width)*4));return out;}

describe('bounded float tile compositor',()=>{
  it('normalizes a fractional output axis to its rounded pixel extent', async () => {
    const f = fixture(2, 1, x => [x, x, x, 1]);
    const gamma: AdjustmentLayer = { ...image('gamma', 2, 1), type: 'adjustment', adjustmentType: 'exposure', settings: {type: 'exposure', values: {exposure: 0, gamma: 2}} };
    const out = await new FloatEditRenderer(ports(f.source)).renderRegion(doc([image('source', 2, 1), gamma], 2, 1), {x: 0, y: 0, width: 2, height: 1}, {scale: .5});
    expect([...out.data]).toEqual([.5, .5, .5, 1]);
  });
  it('treats an unpainted raster layer as transparent without requesting a missing asset', async () => {
    const f = fixture(2, 2, () => [.2, .4, .6, 1]);
    const paint: PaintLayer = {...image('blank', 2, 2), type: 'paint', rasterAssetId: ''};
    const p = {...ports(f.source), getSource: async (id: string) => {if (!id) throw Error('Missing original source'); return f.source;}};
    const out = await new FloatEditRenderer(p).renderRegion(doc([image('bottom', 2, 2), paint], 2, 2), {x: 0, y: 0, width: 2, height: 2});
    expect([...out.data]).toEqual([...f.data]);
  });
  it('resamples the final nonlinear adjustment result in linear light', async () => {
    const f = fixture(2, 1, x => [x, x, x, 1]);
    const gamma: AdjustmentLayer = { ...image('gamma', 2, 1), type: 'adjustment', adjustmentType: 'exposure', settings: { type: 'exposure', values: { exposure: 0, gamma: 2 } } };
    const result = await new FloatEditRenderer(ports(f.source)).renderRegion(doc([image('source', 2, 1), gamma], 2, 1), { x: 0, y: 0, width: 2, height: 1 }, { scale: .5, scaleY: 1 });
    expect(result.data[0]).toBeCloseTo(.5, 6);
  });
  it.each(['hidden', 'zero-opacity'])('does not clip to an older layer across a %s foundation', async mode => {
    const blue = fixture(1, 1, () => [0, 0, 1, 1]), red = fixture(1, 1, () => [1, 0, 0, 1]);
    const base = image('hidden', 1, 1), clipped = image('clipped', 1, 1); clipped.clipToBelow = true;
    if (mode === 'hidden') base.visible = false; else base.opacity = 0;
    const p = { ...ports(blue.source), getSource: async (id: string) => id === 'bottom' ? blue.source : red.source };
    const result = await new FloatEditRenderer(p).renderRegion(doc([image('bottom', 1, 1), base, clipped], 1, 1), { x: 0, y: 0, width: 1, height: 1 });
    expect([...result.data]).toEqual([0, 0, 1, 1]);
  });
  it('retains text-source insets beyond the nominal text box', async () => {
    const f = fixture(6, 4, () => [1, 0, 0, 1]);
    const text: TextLayer = { ...image('text', 2, 2), type: 'text', text: 'A', fontSize: 2, fontFamily: 'sans-serif', color: '#fff', align: 'left', letterSpacing: 0 };
    text.transform.x = 2; text.transform.y = 1;
    const p = { ...ports(f.source), getTextSource: async () => ({ ...f.source, originX: -2, originY: -1 }) };
    const out = await new FloatEditRenderer(p).renderRegion(doc([text], 6, 4), { x: 0, y: 0, width: 6, height: 4 });
    expect(out.data[3]).toBe(1); expect(out.data[out.data.length - 1]).toBe(1);
  });
  it('renders actual high bit data and reverses signed HDR adjustments',async()=>{
    const f=fixture(20,10,x=>[.8,-.2,(40000+x)/65535,1]),before=f.data.slice();
    const adjustment=(id:string,exposure:number):AdjustmentLayer=>({...image(id,20,10),type:'adjustment',adjustmentType:'exposure',settings:{type:'exposure',values:{exposure}}});
    const result=await new FloatEditRenderer(ports(f.source)).renderRegion(doc([image('base',20,10),adjustment('up',1),adjustment('down',-1)]),{x:0,y:0,width:20,height:10});
    expect([...result.data]).toEqual([...before]);expect(result.data[6]).toBeGreaterThan(result.data[2]);
    expect([...f.data]).toEqual([...before]);
  });
  it('matches source-space full filters across source tile seams and crop boundaries',async()=>{
    const f=fixture(700,9,(x,y)=>[x%7===0?2:-.1,y/8,.5,x%11===0?.3:1]);
    const filters:SmartObjectLayer['smartFilters']=[{id:'blur',name:'blur',type:'gaussian_blur',enabled:true,opacity:1,settings:{radius:1}},{id:'blur2',name:'blur2',type:'gaussian_blur',enabled:true,opacity:.6,settings:{radius:2}}];
    const layer:SmartObjectLayer={...image('base',700,9),type:'smart-object',originalWidth:700,originalHeight:9,smartFilters:filters};
    const r={x:248,y:2,width:25,height:5};
    const result=await new FloatEditRenderer(ports(f.source)).renderRegion(doc([layer],700,9),r);
    const reference=crop(applyFloatFilterStack({width:700,height:9,data:f.data},filters!),r);
    reference.forEach((v,i)=>expect(result.data[i]).toBeCloseTo(v,6));
    expect(f.requests.every(r=>r.width<=512&&r.height<=512)).toBe(true);
    expect(f.requests.some(r=>r.width===700)).toBe(false);
  });
  it('matches crops under nested group rotation and linked feathered masks',async()=>{
    const f=fixture(16,12,(x,y)=>[x/8,y/6,-.1,1]);
    const mask={width:60,height:40,data:new Uint8ClampedArray(60*40)};for(let y=0;y<40;y++)for(let x=0;x<60;x++)mask.data[y*60+x]=x>=5&&x<18&&y>=4&&y<13?255:0;
    const base=image('base',16,12);base.transform.x=5;base.transform.y=4;base.mask={id:'m',assetId:'m',enabled:true,linked:true,density:.8,feather:1,referenceTransform:[1,0,0,1,5,4],referenceWidth:16,referenceHeight:12};
    const inner:GroupLayer={...image('inner',60,40),type:'group',children:[base],collapsed:false};inner.transform.rotation=20;inner.transform.x=6;
    const outer:GroupLayer={...image('outer',60,40),type:'group',children:[inner],collapsed:false};outer.transform.x=2;outer.opacity=.7;
    const d=doc([outer],60,40),renderer=new FloatEditRenderer(ports(f.source,mask));
    const full=await renderer.renderRegion(d,{x:0,y:0,width:60,height:40});const r={x:10,y:5,width:21,height:23};
    const part=await renderer.renderRegion(d,r);crop(full,r).forEach((v,i)=>expect(part.data[i]).toBeCloseTo(v,6));
    expect(full.data.some((v,i)=>i%4===3&&v>0)).toBe(true);
    expect(Math.max(...full.data.filter((_,i)=>i%4===3))).toBeLessThanOrEqual(.700001);
  });
  it('clips adjustment effects to base alpha and isolates group backdrop',async()=>{
    const f=fixture(4,1,x=>[.4,.4,.4,x<2?1:0]);
    const base=image('base',4,1),adjustment:AdjustmentLayer={...image('a',4,1),type:'adjustment',adjustmentType:'exposure',clipToBelow:true,opacity:.5,settings:{type:'exposure',values:{exposure:1}}};
    const group:GroupLayer={...image('g',4,1),type:'group',children:[base,adjustment],collapsed:false};group.opacity=.5;
    const d=doc([group],4,1);d.backgroundColor='#fff';
    const out=await new FloatEditRenderer(ports(f.source)).renderRegion(d,{x:0,y:0,width:4,height:1});
    expect(out.data[0]).toBeCloseTo(.8,6);expect(out.data[8]).toBe(1);expect(out.data[3]).toBe(1);
  });
  it('samples original pixel centers at scale and aborts without fetching',async()=>{
    const f=fixture(4,2,x=>[x,-x,.2,1]);const renderer=new FloatEditRenderer(ports(f.source));
    const out=await renderer.renderRegion(doc([image('base',4,2)],4,2),{x:1,y:0,width:2,height:2},{scale:2});
    expect(out.width).toBe(4);expect(out.height).toBe(4);expect(out.data[0]).toBeCloseTo(.75);expect(out.data[4]).toBeCloseTo(1.25);
    const c=new AbortController();c.abort();const count=f.requests.length;
    await expect(renderer.renderRegion(doc([],4,2),{x:0,y:0,width:1,height:1},{signal:c.signal})).rejects.toThrow();expect(f.requests.length).toBe(count);
  });
  it('antialiases high-frequency camera data using bounded source regions',async()=>{
    const f=fixture(1020,34,(x,y)=>[(x+y)%2,(x+y)%2,(x+y)%2,1]);
    const out=await new FloatEditRenderer(ports(f.source)).renderRegion(doc([image('camera',1020,34)],1020,34),{x:0,y:0,width:1020,height:34},{scale:1/17});
    expect(out.width).toBe(60);for(let i=0;i<out.data.length;i+=4)expect(Math.abs(out.data[i]-.5)).toBeLessThan(.02);
    expect(f.requests.every(r=>r.width<=256&&r.height<=256)).toBe(true);
  });
  it('maps independent rounded output scales to the same document pixel grid',async()=>{
    const f=fixture(12,8,(x,y)=>[x,y,0,1]);
    const out=await new FloatEditRenderer(ports(f.source)).renderRegion(doc([image('a',12,8)],12,8),{x:2,y:2,width:5,height:4},{scale:2,scaleY:1.5});
    expect(out.width).toBe(10);expect(out.height).toBe(6);expect(out.data[0]).toBeCloseTo(1.75);expect(out.data[1]).toBeCloseTo(2+1/3-.5);
  });
  it('routes highbit paint, retouch, RAW and explicit text ports and preserves overrides',async()=>{
    const f=fixture(2,2,()=>[2,-.2,.4,1]),calls:string[]=[];
    const p:FloatEditPorts={getSource:async id=>{calls.push(id);return f.source;},getRawSource:async()=>{calls.push('raw');return f.source;},getTextSource:async()=>{calls.push('text');return f.source;},getMask:async()=>({width:2,height:2,data:new Uint8ClampedArray(4).fill(255)})};
    const base=image('test',2,2),layers:Layer[]=[{...base,type:'paint',rasterAssetId:'paint',naturalWidth:2,naturalHeight:2} as PaintLayer,{...base,type:'retouch',rasterAssetId:'retouch',retouchType:'clone',naturalWidth:2,naturalHeight:2} as RetouchLayer,{...base,type:'develop-smart-object',sourceRawUri:'raw',cachedRenderAssetId:'cache',developSettings:createDefaultDevelopSettings(true)} as DevelopSmartObjectLayer,{...base,type:'text',text:'Hi',fontSize:2,fontFamily:'sans-serif',color:'#fff',align:'left',letterSpacing:0} as TextLayer];
    for(const layer of layers){const result=await new FloatEditRenderer(p).renderRegion(doc([layer],2,2),{x:0,y:0,width:2,height:2});expect(result.data[0]).toBe(2);}
    expect(calls).toEqual(['paint','retouch','raw','text']);
    const override=fixture(2,2,()=>[4,0,0,1]);const result=await new FloatEditRenderer(p).renderRegion(doc([base],2,2),{x:0,y:0,width:2,height:2},{layerOverrides:new Map([[base.id,override.source]])});expect(result.data[0]).toBe(4);expect(calls.length).toBe(4);
  });
  it('honors generated patch bounds, selection mask, fill and clipping foundation',async()=>{
    const f=fixture(2,2,()=>[2,0,0,1]),base=image('base',6,4);base.opacity=.5;
    const patch:GeneratedPatchLayer={...image('patch',99,99),type:'generated-patch',maskAssetId:'selection',bounds:{x:2,y:1,width:2,height:2},generationMetadata:{provider:'test',model:'test',sourceDocumentId:'doc',timestamp:0}};
    patch.transform.x=2;patch.transform.y=1;patch.fillOpacity=.5;patch.clipToBelow=true;
    const mask={width:6,height:4,data:new Uint8ClampedArray(24)};mask.data.fill(255,6+2,6+4);
    const out=await new FloatEditRenderer(ports(f.source,mask)).renderRegion(doc([base,patch],6,4),{x:0,y:0,width:6,height:4});
    expect(out.data[(1*6+2)*4+3]).toBeCloseTo(.625,6);expect(out.data[(2*6+2)*4+3]).toBe(.5);expect(out.data[3]).toBe(.5);
  });
  it('matches independently requested minified crops with premultiplied alpha',async()=>{
    const f=fixture(510,34,(x,y)=>[2,-.2,(x+y)%3/3,x<260?.4:1]),renderer=new FloatEditRenderer(ports(f.source)),d=doc([image('camera',510,34)],510,34);
    const full=await renderer.renderRegion(d,{x:0,y:0,width:510,height:34},{scale:1/17});
    const part=await renderer.renderRegion(d,{x:238,y:0,width:85,height:34},{scale:1/17});
    crop(full,{x:14,y:0,width:5,height:2}).forEach((v,i)=>expect(part.data[i]).toBeCloseTo(v,6));
    expect(part.data[0]).toBeCloseTo(2,6);expect(part.data[1]).toBeCloseTo(-.2,6);
  });
  it('reduces a procedural camera source without camera-sized float requests',async()=>{
    let maxPixels=0,reads=0;const source:FloatSource={width:2048,height:1536,async getRegion(r){reads++;maxPixels=Math.max(maxPixels,r.width*r.height);const data=new Float32Array(r.width*r.height*4);for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)data.set([1.4,-.2,(r.x+x)/2048,1],(y*r.width+x)*4);return {width:r.width,height:r.height,data};}};
    const out=await new FloatEditRenderer(ports(source)).renderRegion(doc([image('camera',2048,1536)],2048,1536),{x:0,y:0,width:2048,height:1536},{scale:1/32});
    expect(maxPixels).toBeLessThanOrEqual(256*256);expect(reads).toBeGreaterThan(1);expect(out.width).toBe(64);expect(out.data[0]).toBeCloseTo(1.4,6);expect(out.data[1]).toBeCloseTo(-.2,6);
  });
  it('rejects malformed sources, singular transforms and oversized output before allocation',async()=>{
    const f=fixture(2,2,()=>[1,1,1,1]),renderer=new FloatEditRenderer(ports(f.source)),layer=image('base',2,2);layer.transform.scaleX=0;
    await expect(renderer.renderRegion(doc([layer],2,2),{x:0,y:0,width:2,height:2})).rejects.toThrow('inverted');
    await expect(renderer.renderRegion(doc([],5000,5000),{x:0,y:0,width:5000,height:5000})).rejects.toThrow('bounded');
    const invalid:FloatSource={width:2,height:2,getRegion:async()=>({width:2,height:2,data:new Float32Array(16).fill(NaN)})};
    await expect(new FloatEditRenderer(ports(invalid)).renderRegion(doc([image('base',2,2)],2,2),{x:0,y:0,width:2,height:2})).rejects.toThrow('non-finite');
  });
});
