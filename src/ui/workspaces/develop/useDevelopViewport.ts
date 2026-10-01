import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { developViewShortcut, fitDevelopScale, zoomDevelopAt, shouldIgnoreDevelopNavigation, shouldResetDevelopView, type DevelopView, type ViewAction } from './developViewport';
import { useAppStore } from '../../../stores/useAppStore';

/** Navigation is a CSS transform; panning never re-renders image pixels. */
export function useDevelopViewport(documentId: string | undefined, width: number, height: number, comparison: boolean, drawing: boolean) {
  const active = useAppStore(state => state.currentWorkspace === 'develop');
  const ref=useRef<HTMLElement|null>(null);
  const [size,setSize]=useState({width:1,height:1});
  const [view,setView]=useState<DevelopView>({scale:1,x:0,y:0});
  const [fitted,setFitted]=useState(true);
  const [tool,setTool]=useState<'hand'|'zoom'>('hand');
  const [space,setSpace]=useState(false);
  const [temporaryZoom,setTemporaryZoom]=useState<'in'|'out'|null>(null);
  const [dragging,setDragging]=useState(false);
  const drag=useRef<{id:number;startX:number;startY:number;x:number;y:number}|null>(null);
  const lastDocumentId=useRef<string|undefined>(undefined);
  const fit=fitDevelopScale(width,height,comparison?(size.width-12)/2:size.width,size.height);
  useEffect(()=>{
    const element=ref.current;if(!element)return;
    const measure=()=>{if(element.clientWidth>0 && element.clientHeight>0)setSize({width:element.clientWidth,height:element.clientHeight});};
    measure();const observer=new ResizeObserver(measure);observer.observe(element);
    return()=>observer.disconnect();
  },[documentId]);
  useEffect(()=>{
    if(shouldResetDevelopView(documentId,lastDocumentId.current)){
      setFitted(true);setView({scale:fit,x:0,y:0});setTool('hand');
    }
    if(documentId)lastDocumentId.current=documentId;
    drag.current=null;setDragging(false);setSpace(false);setTemporaryZoom(null);
  },[documentId]);
  useEffect(()=>{if(fitted)setView({scale:fit,x:0,y:0});},[fit,fitted]);
  const zoom=useCallback((scale:number,point={x:0,y:0})=>{setFitted(false);setView(current=>zoomDevelopAt(current,scale,point));},[]);
  const action=useCallback((value:ViewAction)=>{
    if(value==='fit'){setFitted(true);setView({scale:fit,x:0,y:0});}
    else if(value==='actual'){setFitted(false);setView({scale:1,x:0,y:0});}
    else if(value==='zoom'||value==='hand')setTool(value);
    else zoom(view.scale*(value==='in'?1.25:.8));
  },[fit,view.scale,zoom]);
  const blocked=()=>!!document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
  useEffect(()=>{
    const down=(event:KeyboardEvent)=>{
      if(shouldIgnoreDevelopNavigation(event,blocked(),active))return;
      if(event.code==='Space') {
        if(event.ctrlKey||event.metaKey){event.preventDefault();setTemporaryZoom(event.altKey?'out':'in');return;}
        if(!event.altKey){event.preventDefault();setSpace(true);return;}
      }
      const value=developViewShortcut(event);if(value){event.preventDefault();action(value);}
    };
    const up=(event:KeyboardEvent)=>{if(event.code==='Space'){setSpace(false);setTemporaryZoom(null);}};
    const blur=()=>{setSpace(false);setTemporaryZoom(null);drag.current=null;setDragging(false);};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);};
  },[action,active]);
  useEffect(()=>{
    const element=ref.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{
      if(blocked()||(!(event.ctrlKey||event.metaKey||event.altKey)&&tool!=='zoom'))return;
      event.preventDefault();const rect=element.getBoundingClientRect();
      zoom(view.scale*Math.exp(-Math.max(-200,Math.min(200,event.deltaY))*.003),{x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2});
    };
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[documentId,tool,view.scale,zoom]);
  const pointerDown=(event:ReactPointerEvent<HTMLElement>)=>{
    if(event.target instanceof Element && event.target.closest('button, select, input'))return;
    if(event.button!==0&&event.button!==1)return;
    const pan=!temporaryZoom&&(space||event.button===1||(!drawing&&tool==='hand'));
    if(!pan&&drawing&&!temporaryZoom)return;
    event.preventDefault();event.stopPropagation();
    if(pan){event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,startX:event.clientX,startY:event.clientY,x:view.x,y:view.y};setDragging(true);}
    else {const rect=event.currentTarget.getBoundingClientRect();zoom(view.scale*(event.altKey||temporaryZoom==='out'?.8:1.25),{x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2});}
  };
  const pointerMove=(event:ReactPointerEvent<HTMLElement>)=>{
    const current=drag.current;if(!current||event.pointerId!==current.id)return;
    event.preventDefault();setFitted(false);
    const limitX=Math.max(size.width/2,width*view.scale/2),limitY=Math.max(size.height/2,height*view.scale/2);
    setView(v=>({...v,x:Math.max(-limitX,Math.min(limitX,current.x+event.clientX-current.startX)),y:Math.max(-limitY,Math.min(limitY,current.y+event.clientY-current.startY))}));
  };
  const pointerUp=(event:ReactPointerEvent<HTMLElement>)=>{if(drag.current?.id===event.pointerId){drag.current=null;setDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}};
  return {ref,size,view,tool,action,space,dragging,cursor:temporaryZoom?(temporaryZoom==='out'?'zoom-out':'zoom-in'):space||tool==='hand'?(dragging?'grabbing':'grab'):'zoom-in',pointerDown,pointerMove,pointerUp};
}
