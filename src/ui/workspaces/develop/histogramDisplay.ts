export type HistogramScale = 'linear' | 'log';
export function histogramHeights(bins: number[], scale: HistogramScale, maximum=Math.max(1,...bins)): number[] {
 const normalize=scale==='log'?(v:number)=>Math.log1p(v)/Math.log1p(maximum):(v:number)=>v/maximum;
 return bins.map(v=>Math.min(1,Math.max(0,normalize(v))));
}
