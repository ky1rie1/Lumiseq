import { expect, it } from 'vitest';
import { computeHistogramFromImageData } from './histogram';
import { histogramHeights } from '../ui/workspaces/develop/histogramDisplay';
it('retains real endpoint counts, ignores transparent pixels and incomplete data', () => {
 const h=computeHistogramFromImageData(new Uint8ClampedArray([0,0,0,255,255,255,255,255,255,0,0,0,1]),13);
 expect(h.r[0]).toBe(1); expect(h.r[255]).toBe(1); expect(h.r.reduce((a,b)=>a+b,0)).toBe(2);
});
it('linear and logarithmic display never alter the actual bins', () => {
 const bins=[0,1,100]; expect(histogramHeights(bins,'linear')).toEqual([0,.01,1]);
 expect(histogramHeights(bins,'log')[1]).toBeGreaterThan(.01); expect(bins).toEqual([0,1,100]);
});
it('bounds samples at 262144 and covers both halves of large buffers', () => {
 const data=new Uint8ClampedArray(600000*4); for(let i=0;i<600000;i++){data[i*4]=i<300000?20:230;data[i*4+3]=255;}
 const h=computeHistogramFromImageData(data,data.length);const count=h.r.reduce((a,b)=>a+b,0);
 expect(count).toBeLessThanOrEqual(262144);expect(h.r[20]).toBeGreaterThan(100000);expect(h.r[230]).toBeGreaterThan(100000);
});
