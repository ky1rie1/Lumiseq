import React, { useState } from 'react';
import type { HistogramData } from '../../../types/engine';
import { histogramHeights, HistogramScale } from './histogramDisplay';
type Channel='rgb'|'lum'|'r'|'g'|'b';
const names:Record<Channel,string>={rgb:'RGB',lum:'亮度',r:'红',g:'绿',b:'蓝'};
const colors={r:'#ef7777',g:'#6ed995',b:'#75a5f5',lum:'#d4d4d8'};
export const HistogramView:React.FC<{data:HistogramData|null;height?:number}>=({data,height=96})=>{
 const [channel,setChannel]=useState<Channel>('rgb');const [scale,setScale]=useState<HistogramScale>('linear');
 const channels=channel==='rgb'?['r','g','b'] as const:[channel] as ('r'|'g'|'b'|'lum')[];
 const maximum=data?Math.max(1,...channels.flatMap(c=>data[c])):1;
 const total=data?.lum.reduce((a,b)=>a+b,0)??0;
 // RGB clipping is the per-channel fraction, not an invented count of unique clipped pixels.
 const endpoints=data?channels.map(c=>`${names[c]} ${(total?data[c][0]/total*100:0).toFixed(1)}% / ${(total?data[c][255]/total*100:0).toFixed(1)}%`).join(' · '):'';
 return <div className="develop-histogram w-full bg-studio-950 border border-studio-800 rounded overflow-hidden">
  <div className="flex items-center justify-between gap-1 px-1 py-1 text-[10px]">
   <select aria-label="直方图通道" value={channel} onChange={e=>setChannel(e.target.value as Channel)} className="bg-transparent text-studio-300 min-w-0">{Object.entries(names).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
   <span className="text-studio-500">预览分布</span>
   <label className="histogram-scale-control" title="线性便于比较像素数量；对数让较少的像素分布更容易看清，不改变照片。">刻度
    <select aria-label="直方图刻度" value={scale} onChange={e=>setScale(e.target.value as HistogramScale)}><option value="linear">线性</option><option value="log">对数</option></select>
   </label>
  </div>
  {!data?<div role="status" className="flex items-center justify-center text-2xs text-studio-500" style={{height}}>正在计算直方图…</div>:<svg viewBox={`0 0 255 ${height}`} style={{height}} className="w-full block" preserveAspectRatio="none" role="img" aria-label={`${names[channel]} 预览直方图，${scale==='linear'?'线性':'对数'}刻度`}>
   <title>{names[channel]} 预览分布；256 个显示亮度区间</title>
   {[64,128,192].map(x=><line key={x} x1={x} x2={x} y1={0} y2={height} stroke="#27272a" strokeWidth=".5"/>)}
   {channels.map(c=>{const path=histogramHeights(data[c],scale,maximum).map((v,i)=>`${i?'L':'M'} ${i},${height-2-v*(height-4)}`).join(' ');return <g key={c}><path d={`${path} L 255,${height} L 0,${height} Z`} fill={colors[c]} fillOpacity={channel==='rgb'?.22:.28}/><path d={path} fill="none" stroke={colors[c]} strokeWidth=".65" vectorEffect="non-scaling-stroke"/></g>;})}
  </svg>}
  <div className="px-1.5 pb-1 text-[9px] text-studio-500 leading-relaxed" title={`实际采样数：${total}；端点为预览显示范围，不代表 RAW 传感器裁切。`}>黑 / 白端点：{endpoints||'—'}</div>
 </div>;
};
