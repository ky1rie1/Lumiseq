import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { WebGLImageEngine } from './WebGLImageEngine';
import { createDefaultDevelopSettings } from '../document/DevelopDocument';
import { installPixelCanvas } from './editPixelTestCanvas';
import { afterEach, vi } from 'vitest';

afterEach(()=>vi.unstubAllGlobals());

describe('RAW source precision before exposure', () => {
  it('reduces unclipped float headroom before display conversion',async()=>{
    const create=installPixelCanvas(),source=create(1,1),canvas=create(1,1);
    const engine=new WebGLImageEngine();engine.setLoadedSource('float',source,1,1);
    engine.setRawLinearSource('float',{width:1,height:1,data:new Float32Array([1.5,.5,.000001,1])});
    const settings=createDefaultDevelopSettings(true);settings.exposure=-1;
    await engine.renderDevelop('float',settings,canvas);
    expect([...canvas.getContext('2d')!.getImageData(0,0,1,1).data]).toEqual([225,137,0,255]);
  });
  it('uses attached linear pixels for fallback haze analysis and invalidates the old display cache',async()=>{
    const create=installPixelCanvas(),source=create(4,2);
    source.getContext('2d')!.fillRect(0,0,4,2);
    const engine=new WebGLImageEngine();engine.setLoadedSource('raw',source,4,2);
    const settings=createDefaultDevelopSettings(true);settings.dehaze=10;settings.exposure=8;
    expect((await engine.getDevelopSpatialAnalysis('raw',settings))?.haze.atmosphere).toEqual([0,0,0]);
    engine.setRawLinearSource('raw',{width:4,height:2,data:new Uint16Array(Array.from({length:8},()=>[19,19,19,65535]).flat())});
    const analysis=await engine.getDevelopSpatialAnalysis('raw',settings);
    expect(analysis?.haze.atmosphere[0]).toBeGreaterThan(.05);
  });
  it('raises nonzero 16-bit shadows even when the display source has quantized them to black', async () => {
    const source = createCanvas(4, 1);
    const context = source.getContext('2d');
    context.fillStyle = '#000'; context.fillRect(0, 0, 4, 1);
    const engine = new WebGLImageEngine();
    engine.setLoadedSource('raw', source as unknown as HTMLCanvasElement, 4, 1);
    engine.setRawLinearSource('raw', { width: 4, height: 1,
      data: new Uint16Array([0,0,0,65535, 1,1,1,65535, 10,10,10,65535, 19,19,19,65535]) });
    const settings = createDefaultDevelopSettings(true); settings.exposure = 8;
    const output = createCanvas(4, 1);
    await engine.renderDevelop('raw', settings, output as unknown as HTMLCanvasElement, undefined, { forceCPU: true });
    const pixels = output.getContext('2d').getImageData(0, 0, 4, 1).data;
    expect([pixels[0], pixels[4], pixels[8], pixels[12]]).toEqual([0,13,56,77]);
    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual([255,255,255,255]);
  });

  it('rejects mismatched linear buffers instead of rendering unrelated pixels', () => {
    const engine = new WebGLImageEngine();
    engine.setLoadedSource('raw', createCanvas(2, 1) as unknown as HTMLCanvasElement, 2, 1);
    expect(() => engine.setRawLinearSource('raw', { width: 1, height: 1, data: new Uint16Array(4) })).toThrow();
    expect(() => engine.setRawLinearSource('raw', { width: 2, height: 1, data: new Uint16Array(4) })).toThrow();
    expect(() => engine.setRawLinearSource('raw', { width: 2, height: 1, data: new Float32Array([NaN,0,0,1,0,0,0,1]) })).toThrow();
    expect(() => engine.setRawLinearSource('raw', { width: 2, height: 1, data: new Float32Array([0,0,0,2,0,0,0,1]) })).toThrow();
  });
});
