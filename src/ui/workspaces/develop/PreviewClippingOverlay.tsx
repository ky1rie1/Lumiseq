import { useEffect, useRef } from 'react';
import { clippingOverlay, type ClippingCounts } from './colorInspection';

export function PreviewClippingOverlay({source,revision,shadows,highlights,onCounts,onError}:{
  source:HTMLCanvasElement|null; revision:unknown; shadows:boolean; highlights:boolean;
  onCounts?:(counts:ClippingCounts|null)=>void; onError?:(message:string)=>void;
}) {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const target=ref.current;
    if (!target) return;
    if (!source || !source.width || !source.height || !(shadows||highlights)) {
      target.width=target.height=0; onCounts?.(null); return;
    }
    try {
      const input=source.getContext('2d'); const output=target.getContext('2d');
      if (!input || !output) throw new Error('预览画布无法读取');
      const result=clippingOverlay(input.getImageData(0,0,source.width,source.height).data,shadows,highlights);
      target.width=source.width; target.height=source.height;
      output.putImageData(new ImageData(result.rgba,source.width,source.height),0,0);
      onCounts?.({shadows:result.shadows,highlights:result.highlights,sampled:result.sampled});
    } catch(error) {
      target.width=target.height=0; onCounts?.(null);
      onError?.(`输出警示不可用：${error instanceof Error?error.message:String(error)}`);
    }
    return ()=>{target.width=target.height=0;};
  },[source,revision,shadows,highlights,onCounts,onError]);
  return <canvas ref={ref} aria-hidden="true" className="develop-clipping-overlay" />;
}
