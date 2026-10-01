/** Development-only: exercise production components in the actual Tauri WebView. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DevelopWorkspace } from '../src/ui/workspaces/develop/DevelopWorkspace';
import { TopMenuBar } from '../src/ui/layout/TopMenuBar';
import type { StudioActionHandlers } from '../src/app/studioActions';
import { ColorPickerModal } from '../src/ui/workspaces/edit/ColorPickerModal';
import { defaultColorState } from '../src/color/colorState';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultAssetManager } from '../src/assets/AssetManager';
import { defaultImageEngine } from '../src/engine/WebGLImageEngine';
import { useDevelopStore } from '../src/stores/useDevelopStore';
import { useAppStore } from '../src/stores/useAppStore';
import { createReferenceColorPattern } from './referenceColorPattern';
import '../src/styles/globals.css';
import '../src/styles/studio.css';
import '../src/styles/workbench-2026.css';
import '../src/styles/efficiency.css';
import '../src/styles/pro-workbench.css';
import '../src/styles/pro-develop.css';
import '../src/styles/unified-theme.css';
import '../src/styles/window-chrome.css';

const report={complete:false,passed:false,cases:[] as Array<{name:string;passed:boolean;detail?:unknown}>,errors:[] as string[]};
const delay=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(test:()=>boolean)=>{for(let i=0;i<100;i++){if(test())return;await delay();}throw new Error('UI verification timed out');};
const check=(name:string,passed:boolean,detail?:unknown)=>{report.cases.push({name,passed,detail});if(!passed)throw new Error(name);};
const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(element=>element.textContent?.trim()===label)!;
// Resolve the live token through the browser rather than duplicating its color.
const tokenColor=(name:string)=>{
  const probe=document.createElement('span');probe.style.backgroundColor=`var(${name})`;
  document.body.append(probe);const color=getComputedStyle(probe).backgroundColor;probe.remove();return color;
};
try{
  // This fixture is outside the release bundle and generates its own original input.
  const blob=await createReferenceColorPattern('image/jpeg');
  const handle=await defaultAssetManager.registerBlob(blob,'image','RAW 解码预览');
  await defaultImageEngine.loadAsset(handle.id,blob);
  const doc=createDevelopDocument({fileName:'工作台验证 · 参考色块预览.jpg',sourceUri:'memory://verification',isRaw:false,
    sourceAssetId:handle.id,width:handle.width,height:handle.height});
  defaultDocumentManager.openDocument(doc);useDevelopStore.getState().loadDocument(doc);useAppStore.getState().setWorkspace('develop');
  const fixture=document.querySelector<HTMLDivElement>('#fixture')!;
  const noop=()=>{};
  const actions:StudioActionHandlers={openFile:noop,createCanvas:noop,openDocument:noop,openRecentProject:noop,saveProject:noop,saveProjectAs:noop,exportImage:noop,closeActiveDocument:noop,closeDocument:noop};
  createRoot(fixture).render(<><TopMenuBar actions={actions}/><div style={{flex:1,minHeight:0,display:'flex'}}><DevelopWorkspace onExport={()=>{}}/></div></>);
  await until(()=>!!document.querySelector<HTMLCanvasElement>('.develop-photo-frame canvas')?.width);
  await delay(500);
  for(const [label,selector] of [
    ['对比原图','.develop-operation-actions button[title^="对比原始图像"]'],
    ['转入图像编辑','.develop-operation-actions button[title^="RAW 使用原始分辨率"]'],
  ]){
    await until(()=>!!document.querySelector(selector));
    const control=document.querySelector(selector)!;const style=getComputedStyle(control);
    check(`${label} shares raised toolbar surface`,style.backgroundColor===tokenColor('--ui-raised'),style.backgroundColor);
    check(`${label} shares toolbar border token`,style.borderColor===tokenColor('--ui-border'),style.borderColor);
  }
  for(const width of [1440,960]){
    fixture.style.width=`${width}px`;await delay(100);
    const viewport=document.querySelector<HTMLElement>('.develop-canvas-viewport')!.getBoundingClientRect();
    const controls=document.querySelector<HTMLElement>('.develop-controls-panel')!.getBoundingClientRect();
    check(`${width}px canvas usable`,viewport.width>=width-330&&viewport.height>600,{viewportWidth:viewport.width,viewportHeight:viewport.height,controlsWidth:controls.width});
    check(`${width}px collapsed information`,document.querySelector<HTMLElement>('#develop-photo-info')!.getBoundingClientRect().width===0);
    const caption=document.querySelector<HTMLElement>('.studio-header')!.getBoundingClientRect();
    const chromeButtons=Array.from(document.querySelectorAll<HTMLButtonElement>('.studio-header button'));
    check(`${width}px caption actions fit`,chromeButtons.every(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.left>=caption.left&&r.right<=caption.right+1;}));
    check(`${width}px caption groups do not overlap`,document.querySelector('.header-start')!.getBoundingClientRect().right<=document.querySelector('.workspace-switch')!.getBoundingClientRect().left&&document.querySelector('.workspace-switch')!.getBoundingClientRect().right<=document.querySelector('.header-end')!.getBoundingClientRect().left);
  }
  fixture.style.width='1440px';await delay(100);
  const exposure=useDevelopStore.getState().settings!.exposure;
  const hoveredRange=document.querySelector<HTMLInputElement>('input[type=range]')!;
  hoveredRange.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
  const tab=document.querySelector<HTMLButtonElement>('.develop-tool-groups [role=tab][aria-selected=true]')!;
  tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  tab.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight',bubbles:true}));await delay();
  check('keyboard group navigation preserves exposure',useDevelopStore.getState().settings!.exposure===exposure);
  check('keyboard group focus moves',document.activeElement?.textContent==='色彩');
  const search=document.querySelector<HTMLInputElement>('[aria-label="搜索调色工具"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'降噪');
  search.dispatchEvent(new Event('input',{bubbles:true}));await delay();
  const visible=Array.from(document.querySelectorAll<HTMLElement>('.develop-tool-section')).filter(el=>!el.hidden);
  check('search finds detail across groups',visible.length===1,visible.map(el=>el.textContent?.slice(0,25)));
  check('search shows detail controls',visible[0].textContent?.includes('细节与降噪')===true);
  button('100%').click();await delay();
  document.querySelector<HTMLButtonElement>('[aria-label="放大图像"]')!.click();await delay();
  const savedZoom=document.querySelector('[aria-label="图像缩放比例"]')!.textContent;
  useAppStore.getState().setWorkspace('edit');await delay();
  useAppStore.getState().setWorkspace('develop');await delay(300);
  check('workspace return preserves tool search',document.querySelector<HTMLInputElement>('[aria-label="搜索调色工具"]')!.value==='降噪');
  check('workspace return preserves zoom',document.querySelector('[aria-label="图像缩放比例"]')!.textContent===savedZoom,savedZoom);
  button('适应').click();await delay();
  button('高光').click();button('阴影').click();await delay(200);
  check('warning overlay uses displayed dimensions',document.querySelector<HTMLCanvasElement>('.develop-clipping-overlay')!.width===document.querySelector<HTMLCanvasElement>('.develop-photo-frame canvas')!.width);
  check('warning scope labelled preview',!!document.querySelector('.develop-clipping-counts')?.textContent?.includes('预览采样'));
  button('色彩评估').click();await delay();
  check('neutral assessment enabled',getComputedStyle(document.querySelector('.develop-canvas-viewport')!).backgroundColor==='rgb(118, 118, 118)');
  button('并排对比').click();await delay(700);
  const reference=document.querySelector<HTMLCanvasElement>('.develop-image-plane > .develop-photo-frame canvas')!;
  const bounds=reference.getBoundingClientRect();
  document.querySelector('.develop-canvas-viewport')!.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:bounds.left+bounds.width/2,clientY:bounds.top+bounds.height/2}));
  await delay();check('reference image color can be inspected',!!document.querySelector('.develop-color-readout')?.textContent?.includes('原图 · sRGB 8 位'));
  button('关闭并排').click();document.querySelector<HTMLButtonElement>('[aria-label="清除工具搜索"]')?.click();
  // Leave a clean visual fixture after verification for a screenshot.
  document.querySelector<HTMLButtonElement>('.develop-tool-groups [role=tab]')!.click();await delay();
  document.querySelector<HTMLButtonElement>('[aria-label="设置"]')!.click();
  await until(()=>!!document.querySelector('[role="dialog"]'));
  check('settings inherits panel token',getComputedStyle(document.querySelector('.settings-center')!).backgroundColor===tokenColor('--ui-panel'));
  button('外观').click();await delay();
  check('settings preview inherits panel token',getComputedStyle(document.querySelector('.settings-preview-inspector')!).backgroundColor===tokenColor('--ui-panel'));
  check('settings preview selected tool shares accent',getComputedStyle(document.querySelector('.settings-preview-toolrail i')!).borderColor===tokenColor('--ui-accent'));
  check('settings preview feedback does not loop',getComputedStyle(document.querySelector('.settings-preview-toolrail i')!).animationName==='none');
  document.documentElement.dataset.motion='reduced';
  const reducedPanel=getComputedStyle(document.querySelector('.settings-center')!);
  check('reduced mode allows a short surface fade',reducedPanel.animationName!=='none'&&parseFloat(reducedPanel.animationDuration)<=.08);
  const reducedAnimations=document.querySelector('.settings-center')!.getAnimations().flatMap(animation=>(animation.effect as KeyframeEffect).getKeyframes());
  check('reduced surface fade keeps geometry fixed',reducedAnimations.every(frame=>!frame.transform||frame.transform==='none'));
  document.documentElement.dataset.motion='off';
  check('off mode stops settings and preview animation',['.settings-center','.settings-main','.settings-preview-toolrail i'].every(selector=>getComputedStyle(document.querySelector(selector)!).animationName==='none'));
  delete document.documentElement.dataset.motion;
  const dialog=document.querySelector('[role="dialog"]')!;
  dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await delay();
  check('settings restores trigger focus',document.activeElement?.getAttribute('aria-label')==='设置');
  const pickerHost=document.createElement('div');pickerHost.className='studio-app';document.body.append(pickerHost);
  const colorBefore=defaultColorState.getState().foreground;
  defaultColorState.setForeground('#d15c37');
  const pickerRoot=createRoot(pickerHost);
  pickerRoot.render(<ColorPickerModal isOpen target="foreground" onClose={()=>{}}/>);
  await until(()=>!!document.querySelector('.color-picker [role=img]'));
  check('unified theme preserves exact picker swatch',getComputedStyle(document.querySelector('.color-picker [role=img]')!).backgroundColor==='rgb(209, 92, 55)');
  check('picker primary shares accent token',getComputedStyle(document.querySelector('.color-picker-apply')!).backgroundColor===tokenColor('--ui-accent'));
  document.documentElement.dataset.motion='reduced';
  check('reduced mode limits control transitions to opacity',getComputedStyle(document.querySelector('.color-picker-apply')!).transitionProperty==='opacity');
  document.documentElement.dataset.motion='off';await delay();
  check('motion off removes button transitions',getComputedStyle(document.querySelector('.color-picker-apply')!).transitionDuration==='0s');
  delete document.documentElement.dataset.motion;
  pickerRoot.unmount();pickerHost.remove();defaultColorState.setForeground(colorBefore);
  report.passed=true;
}catch(error){report.errors.push(String(error));}
report.complete=true;document.querySelector('#report')!.textContent=JSON.stringify(report,null,2);
