import {describe,expect,it} from 'vitest';
import {decodeRawLinearPixels,sampleRawLinearPixel} from './rawLinearPixels';

describe('native linear RAW transport',()=>{
  it('preserves scene-float negatives, headroom and sub-16-bit shadows',()=>{
    const bytes=new Uint8Array(28); bytes.set([76,70,51,50]); const view=new DataView(bytes.buffer);
    view.setUint32(4,1,true);view.setUint32(8,1,true);
    [-.125,1.5,.000001,1].forEach((v,i)=>view.setFloat32(12+i*4,v,true));
    const source=decodeRawLinearPixels(bytes);
    expect(source.data).toBeInstanceOf(Float32Array);
    const pixel=sampleRawLinearPixel(source,0,0,1,1);
    expect(pixel[0]).toBe(-.125);expect(pixel[1]).toBe(1.5);expect(pixel[2]).toBeCloseTo(.000001,12);
    view.setFloat32(12,NaN,true);expect(()=>decodeRawLinearPixels(bytes)).toThrow(/finite|invalid/i);
  });
  const packet=()=>{const bytes=new Uint8Array(28);bytes.set([76,82,49,54]);const v=new DataView(bytes.buffer);v.setUint32(4,2,true);v.setUint32(8,1,true);[1,10,19,65535,65535,0,32768,65535].forEach((n,i)=>v.setUint16(12+i*2,n,true));return bytes;};
  it('reads explicit little endian values including sub-display shadows',()=>{
    const source=decodeRawLinearPixels(packet());expect(source.width).toBe(2);expect([...source.data]).toEqual([1,10,19,65535,65535,0,32768,65535]);
    const padded=new Uint8Array(30);padded.set(packet(),1);expect(decodeRawLinearPixels(padded.subarray(1,29)).data).toEqual(source.data);
  });
  it('rejects truncation, wrong signature and oversized dimensions before allocation',()=>{
    expect(()=>decodeRawLinearPixels(packet().subarray(0,26))).toThrow();
    const broken=packet();broken[0]=0;expect(()=>decodeRawLinearPixels(broken)).toThrow();
    const wide=packet();new DataView(wide.buffer).setUint32(4,5000,true);expect(()=>decodeRawLinearPixels(wide)).toThrow();
  });
  it('interpolates linear signal and clamps the outer pixel centers',()=>{
    const s=decodeRawLinearPixels(packet());expect(sampleRawLinearPixel(s,0,0,2,1)[0]).toBe(1/65535);
    expect(sampleRawLinearPixel(s,0,0,1,1)[0]).toBeCloseTo((1+65535)/2/65535,10);
    expect(sampleRawLinearPixel(s,3,0,4,1)[0]).toBe(1);
  });
});
