import { afterEach, expect, it, vi } from 'vitest';
import { HistogramScheduler } from './HistogramScheduler';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('uses representative bounded readback without upscaling or mutating the source',()=>{
 const ctx={drawImage:vi.fn(),getImageData:vi.fn(()=>({data:new Uint8ClampedArray([0,0,0,255])}))};
 const scratch={width:0,height:0,getContext:()=>ctx};vi.stubGlobal('document',{createElement:()=>scratch});
 const scheduler=new HistogramScheduler(0),callback=vi.fn();const source={width:4000,height:2000} as HTMLCanvasElement;
 scheduler.schedule(source,callback);expect(scratch.width).toBe(512);expect(scratch.height).toBe(256);expect(source.width).toBe(4000);expect(callback).toHaveBeenCalledOnce();
 scheduler.schedule({width:40,height:20} as HTMLCanvasElement,callback);expect(scratch.width).toBe(40);expect(scratch.height).toBe(20);
});
it('cancels a throttled histogram callback',()=>{
 vi.useFakeTimers();const callback=vi.fn(),scheduler=new HistogramScheduler(100000);
 scheduler.schedule({width:100,height:100} as HTMLCanvasElement,callback);scheduler.cancel();vi.runAllTimers();expect(callback).not.toHaveBeenCalled();
});
