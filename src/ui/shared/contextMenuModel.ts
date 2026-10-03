import type { ReactNode } from 'react';
export interface ContextMenuItem {
 id: string; label: string; icon?: ReactNode; shortcut?: string; disabled?: boolean; reason?: string;
 separatorBefore?: boolean; children?: ContextMenuItem[]; run?: () => unknown;
}
export function menuPosition(anchor: {x:number;y:number;parentLeft?:number}, size: {width:number;height:number}, viewport: {width:number;height:number}, submenu=false) {
 const margin=6, width=Math.min(size.width,Math.max(0,viewport.width-margin*2)),height=Math.min(size.height,Math.max(0,viewport.height-margin*2));
 return {left:Math.max(margin,Math.min(anchor.x+width>viewport.width-margin ? (submenu?(anchor.parentLeft??anchor.x)-width+2:anchor.x-width):anchor.x,viewport.width-width-margin)),
  top:Math.max(margin,Math.min(anchor.y+height>viewport.height-margin?anchor.y-height:anchor.y,viewport.height-height-margin))};
}
export function parseMenuNumber(text:string,min:number,max:number):number|null {
 if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()))return null;const value=Number(text);
 return Number.isFinite(value)&&value>=min&&value<=max?value:null;
}
export async function executeMenuItem(item:ContextMenuItem) {
 if(!item.disabled&&!item.children?.length)await item.run?.();
}
