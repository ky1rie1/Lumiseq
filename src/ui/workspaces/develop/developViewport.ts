import { isTextEditingTarget } from '../../../app/keyboard';
export interface DevelopView { scale: number; x: number; y: number }
export function shouldResetDevelopView(documentId: string | undefined, lastDocumentId: string | undefined): boolean {
  return !!documentId && documentId !== lastDocumentId;
}
export function shouldIgnoreDevelopNavigation(event: Pick<KeyboardEvent,'defaultPrevented'|'isComposing'|'code'|'target'>, modalOpen: boolean, active = true): boolean {
  const target=event.target as Element|null;
  return !active||event.defaultPrevented||event.isComposing||modalOpen||isTextEditingTarget(event.target)||!!(event.code==='Space'&&target?.closest?.('button, [role="button"], a[href], summary'));
}
export type ViewAction = 'in' | 'out' | 'fit' | 'actual' | 'zoom' | 'hand';
export function fitDevelopScale(width: number, height: number, viewportWidth: number, viewportHeight: number): number {
  if (![width,height,viewportWidth,viewportHeight].every(v=>Number.isFinite(v)&&v>0)) return 1;
  return Math.max(.001, Math.min(1,Math.max(1,viewportWidth-48)/width,Math.max(1,viewportHeight-48)/height));
}
export function zoomDevelopAt(view: DevelopView, scale: number, point: {x:number;y:number}): DevelopView {
  if (!Number.isFinite(scale) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return view;
  const nextScale=Math.max(.001,Math.min(16,scale));
  const ratio=nextScale/view.scale;
  return {scale:nextScale,x:point.x-(point.x-view.x)*ratio,y:point.y-(point.y-view.y)*ratio};
}
export function developViewShortcut(event: Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'>): ViewAction | null {
  if (event.altKey) return null;
  if (event.ctrlKey||event.metaKey) {
    if (event.key==='+'||event.key==='=') return 'in';
    if (event.key==='-'||event.key==='_') return 'out';
    if (!event.shiftKey&&event.key==='0') return 'fit';
    if (!event.shiftKey&&event.key==='1') return 'actual';
    return null;
  }
  if (event.shiftKey) return null;
  if (event.key.toLowerCase()==='z') return 'zoom';
  if (event.key.toLowerCase()==='h') return 'hand';
  return null;
}
