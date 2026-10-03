import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { defaultDocumentManager } from '../../document/DocumentManager';
import { isTextEditingTarget } from '../../app/keyboard';
import { executeMenuItem, menuPosition, type ContextMenuItem } from './contextMenuModel';
import './contextMenu.css';
export type { ContextMenuItem } from './contextMenuModel';
interface OpenMenu {x:number;y:number;items:ContextMenuItem[];origin:HTMLElement|null;label:string}
export function useContextMenu(scope: string | undefined, onError?: (message:string)=>void) {
 const [menu,setMenu]=useState<OpenMenu|null>(null);
 const menuRef=useRef(menu);menuRef.current=menu;
 const errors=useRef(onError);errors.current=onError;
 const close=useCallback((restore=true)=>{
  const origin=menuRef.current?.origin;menuRef.current=null;setMenu(null);
  if(restore&&origin?.isConnected)origin.focus({preventScroll:true});
 },[]);
 useEffect(()=>{close(false);},[scope,close]);
 useEffect(()=>{
  if(!menu)return;
  const outside=(event:PointerEvent)=>{if(!(event.target as Element)?.closest?.('[data-context-menu]'))close();};
  const blur=()=>close(false);
  const unsubscribe=defaultDocumentManager.subscribe(event=>{if(event.type==='activated'||event.type==='closed')close(false);});
  window.addEventListener('pointerdown',outside,true);window.addEventListener('blur',blur);window.addEventListener('resize',blur);
  return()=>{unsubscribe();window.removeEventListener('pointerdown',outside,true);window.removeEventListener('blur',blur);window.removeEventListener('resize',blur);};
 },[menu,close]);
 const open=(event:MouseEvent<HTMLElement>|KeyboardEvent<HTMLElement>,items:ContextMenuItem[],label='上下文操作')=>{
  // Range controls have application actions; editable numeric/text fields keep their native menu.
  if(isTextEditingTarget(event.target)&&!(event.target instanceof HTMLInputElement&&event.target.type==='range'))return;
  event.preventDefault();event.stopPropagation();
  const target=event.currentTarget,box=target.getBoundingClientRect();
  const keyboard='key' in event || (!event.clientX&&!event.clientY);
  const active=document.activeElement;
  setMenu({x:keyboard?box.left+Math.min(24,box.width/2):event.clientX,y:keyboard?box.top+Math.min(24,box.height/2):event.clientY,items,
   origin:active instanceof HTMLElement&&active!==document.body?active:target,label});
 };
 const key=(event:KeyboardEvent<HTMLElement>,items:()=>ContextMenuItem[],label?:string)=>{
  if(event.key==='ContextMenu'||(event.key==='F10'&&event.shiftKey))open(event,items(),label);
 };
 const run=async(item:ContextMenuItem)=>{
  close();try{await executeMenuItem(item);}catch(cause){errors.current?.(cause instanceof Error?cause.message:String(cause));}
 };
 return {open,key,close,node:menu?createPortal(<MenuLevel key={`${menu.x}:${menu.y}`} items={menu.items} anchor={{x:menu.x,y:menu.y}} label={menu.label} close={close} run={run}/>,document.body):null};
}
function MenuLevel({items,anchor,label,close,run,submenu=false,onBack}:{items:ContextMenuItem[];anchor:{x:number;y:number;parentLeft?:number};label:string;close:(restore?:boolean)=>void;run:(item:ContextMenuItem)=>void;submenu?:boolean;onBack?:()=>void}) {
 const ref=useRef<HTMLDivElement>(null);
 const buttons=useRef(new Map<number,HTMLButtonElement>());
 const [active,setActive]=useState(()=>Math.max(0,items.findIndex(item=>!item.disabled)));
 const [child,setChild]=useState<{index:number;anchor:{x:number;y:number;parentLeft:number}}|null>(null);
 const [position,setPosition]=useState({left:anchor.x,top:anchor.y});
 useLayoutEffect(()=>{
  const box=ref.current?.getBoundingClientRect();if(box)setPosition(menuPosition(anchor,box,{width:window.innerWidth,height:window.innerHeight},submenu));
  buttons.current.get(active)?.focus({preventScroll:true});
 },[anchor.x,anchor.y,submenu]);
 const focus=(index:number)=>{setActive(index);buttons.current.get(index)?.focus({preventScroll:true});buttons.current.get(index)?.scrollIntoView({block:'nearest'});};
 const enter=(index:number)=>{
  const button=buttons.current.get(index),item=items[index];if(!item||item.disabled||!item.children?.length||!button)return;
  const box=button.getBoundingClientRect();setChild({index,anchor:{x:box.right-2,y:box.top,parentLeft:ref.current?.getBoundingClientRect().left??box.left}});
 };
 const onKey=(event:KeyboardEvent)=>{
  event.stopPropagation();
  if(['Escape','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))event.preventDefault();
  if(event.key==='Escape'||event.key==='Tab'){close();return;}
  if(event.key==='ArrowLeft'&&onBack){onBack();return;}
  if(event.key==='ArrowRight'){enter(active);return;}
  if(event.key==='Enter'||event.key===' '){if(items[active]?.children?.length)enter(active);else if(items[active]&&!items[active].disabled)run(items[active]);return;}
  const enabled=items.map((item,index)=>!item.disabled?index:-1).filter(index=>index>=0);if(!enabled.length)return;
  if(event.key==='Home')focus(enabled[0]);else if(event.key==='End')focus(enabled[enabled.length-1]);
  else if(event.key==='ArrowDown'||event.key==='ArrowUp'){const current=enabled.indexOf(active);focus(enabled[(current+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length]);}
 };
 return <><div ref={ref} data-context-menu role="menu" aria-label={label} className="studio-context-menu" style={position} onKeyDown={onKey} onContextMenu={event=>event.preventDefault()}>
  {items.map((item,index)=><div key={item.id}>{item.separatorBefore&&<div role="separator" className="studio-context-separator"/>}
   <button ref={element=>{if(element)buttons.current.set(index,element);else buttons.current.delete(index);}} type="button" role="menuitem" aria-disabled={item.disabled||undefined} aria-haspopup={item.children?.length?'menu':undefined} aria-expanded={item.children?.length?child?.index===index:undefined} tabIndex={active===index?0:-1} className="studio-context-item" title={item.disabled?item.reason:undefined}
    onFocus={()=>setActive(index)} onPointerEnter={()=>{setActive(index);if(item.children?.length)enter(index);else setChild(null);}}
    onClick={()=>{if(item.disabled)return;if(item.children?.length)enter(index);else run(item);}}>
    <span className="studio-context-icon">{item.icon}</span><span className="studio-context-label">{item.label}{item.disabled&&item.reason&&<small>{item.reason}</small>}</span><span className="studio-context-shortcut">{item.shortcut}</span>{item.children?.length&&<ChevronRight size={12}/>}
   </button></div>)}
 </div>{child&&items[child.index]?.children?.length&&<MenuLevel key={items[child.index].id} items={items[child.index].children!} anchor={child.anchor} label={items[child.index].label} close={close} run={run} submenu onBack={()=>{setChild(null);focus(child.index);}}/>}</>;
}
/** Capture this value when opening a menu, including before asynchronous clipboard reads. */
export const ContextMenuScope = createContext<{id:string;guard:()=>void;disabled?:boolean;reason?:string}|null>(null);
