import { useState, useEffect } from 'react';
import type { DevelopDocument, DevelopSettings } from '../../../types/develop';
import { defaultDevelopLooks, loadCustomDevelopPresets, saveCustomDevelopPresets, createCustomDevelopPreset, defaultNativePresetStore } from '../../../develop/DevelopLookService';
import { AccordionSection } from '../../shared/AccordionSection';

export function DevelopLooksPanel({document:doc,settings,onCompare,onError}:{document:DevelopDocument;settings:DevelopSettings;onCompare:(id:string)=>void;onError:(message:string)=>void}) {
 const [custom,setCustom]=useState(loadCustomDevelopPresets);
 const [presetId,setPresetId]=useState('');
 const [strength,setStrength]=useState(100);
 const [name,setName]=useState('');
 const [includeWB,setIncludeWB]=useState(false);

 useEffect(() => {
   void defaultNativePresetStore.loadPresets().then(loaded => {
     if (loaded.length) setCustom(loaded);
   }).catch(() => {});
 }, []);

 const presets=custom;
 const run=(fn:()=>void|Promise<void>)=>{
   try {
     const res = fn();
     if (res && typeof (res as any).catch === 'function') {
       (res as Promise<void>).catch(error => onError(error instanceof Error ? error.message : String(error)));
     }
   } catch(error) {
     onError(error instanceof Error ? error.message : String(error));
   }
 };

 const input='bg-studio-950 border border-studio-700 rounded px-2 py-1 w-full text-studio-200';
 const button='px-2 py-1 rounded bg-studio-800 border border-studio-700 hover:bg-studio-700 text-xs';

 return <AccordionSection id="dev-sec-looks" title="预设与快照" defaultExpanded={false}>
  <div className="space-y-2">
   <select disabled={!presets.length} aria-label="调色预设" className={input} value={presetId} onChange={e=>setPresetId(e.target.value)}>
     <option value="">{presets.length ? '选择个人预设' : '暂无个人预设'}</option>
     {presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
   </select>
   <label className="flex items-center gap-2 text-xs">强度 {strength}% <input aria-label="预设强度" type="range" min={0} max={100} value={strength} onChange={e=>setStrength(Number(e.target.value))} className="flex-1 min-w-0"/></label>
   <label className="flex items-center gap-2 text-2xs text-studio-400"><input type="checkbox" checked={includeWB} onChange={e=>setIncludeWB(e.target.checked)}/>包括预设白平衡（保留相机倍率）</label>
   <button disabled={!presetId} className={button} onClick={()=>run(()=>{const preset=presets.find(p=>p.id===presetId);if(preset)defaultDevelopLooks.applyPreset(doc.id,preset,strength/100,includeWB);})}>应用预设</button>
   <input aria-label="预设或快照名称" value={name} onChange={e=>setName(e.target.value)} placeholder="预设 / 快照名称" className={input}/>
   <div className="flex gap-2">
     <button className={button} onClick={()=>run(async ()=>{
       if(custom.length>=64)throw new Error('最多保存 64 个自定义预设');
       const preset=createCustomDevelopPreset(name,settings);
       await defaultNativePresetStore.savePreset(preset);
       const next=defaultNativePresetStore.getPresetsSync();
       saveCustomDevelopPresets(next);
       setCustom(next);
       setPresetId(preset.id);
       setName('');
     })}>保存预设</button>
     <button className={button} onClick={()=>run(()=>{defaultDevelopLooks.saveSnapshot(doc.id,name);setName('');})}>保存快照</button>
   </div>
   <div className="flex gap-2">
     <button className={button} onClick={()=>run(async ()=>{
       const imported = await defaultNativePresetStore.importPreset();
       if (imported) {
         const next = defaultNativePresetStore.getPresetsSync();
         setCustom(next);
         setPresetId(imported.id);
       }
     })}>导入预设</button>
     {custom.some(p=>p.id===presetId)&&<button className={button} onClick={()=>run(async ()=>{
       const p = custom.find(item => item.id === presetId);
       if (p) await defaultNativePresetStore.exportPreset(p);
     })}>导出预设</button>}
     {custom.some(p=>p.id===presetId)&&<button className={button} onClick={()=>run(async ()=>{
       await defaultNativePresetStore.deletePreset(presetId);
       const next=custom.filter(p=>p.id!==presetId);
       setCustom(next);
       setPresetId('');
     })}>删除</button>}
   </div>
   <p className="text-2xs text-studio-500">预设文件保存于本地 AppData 目录，支持导入分享。快照随项目保存。</p>
   {(doc.settingsSnapshots??[]).map(s=><div key={s.id} className="flex items-center gap-1"><span className="flex-1 truncate text-xs" title={s.name}>{s.name}</span><button className={button} onClick={()=>onCompare(s.id)}>对比</button><button className={button} onClick={()=>run(()=>defaultDevelopLooks.restoreSnapshot(doc.id,s.id))}>恢复</button><button className={button} aria-label={`删除快照 ${s.name}`} onClick={()=>run(()=>defaultDevelopLooks.deleteSnapshot(doc.id,s.id))}>×</button></div>)}
  </div>
 </AccordionSection>;
}
