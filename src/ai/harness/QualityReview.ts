import type { StudioDocument } from '../../types/document';
import type { AgentActionLogEntry } from '../types';
import type { Layer } from '../../types/edit';
import type { ICommand } from '../../types/history';
import { locateLayer } from '../../edit/LayerTree';
import { BrushStrokeCommand, PaintMaskCommand } from '../../brush/BrushCommands';
import { defaultAssetManager } from '../../assets/AssetManager';
import { TransformCommand } from '../../commands/edit/TransformCommand';
import { CreateLayerCommand } from '../../commands/edit/CreateLayerCommand';
export function allLayers(layers: Layer[]): Layer[] { return layers.flatMap(layer => [layer, ...(layer.type === 'group' ? allLayers(layer.children) : [])]); }
function parameter(settings: any, id: string, channel?: string): unknown {
  if (id === 'temperature' || id === 'tint') return settings.whiteBalance[id];
  if (/^sharpen|Denoise$/.test(id)) return settings.detail[id];
  if (/^vignette/.test(id)) return settings.optics[id];
  if (/^hsl/.test(id)) return settings.hsl[channel ?? '']?.[{hslHue:'hue',hslSat:'saturation',hslLum:'luminance'}[id] ?? ''];
  return settings[id];
}
/** Reads engine state; no commands or editor explanations are used as evidence. */
export function technicalReview(activeDocument: StudioDocument | null, actions: AgentActionLogEntry[], getDocument?: (id:string)=>StudioDocument|null, getCommand?:(id:string)=>ICommand|undefined): { verified: string[]; pending: string[] } {
  const verified: string[] = [], pending: string[] = [];
  const latest = new Map<string, AgentActionLogEntry>();
  for (const action of actions) {
    if (action.status !== 'success') { pending.push(`${action.toolName}: ${action.result?.error?.code ?? 'tool failed'}`); continue; }
    if (action.toolName === 'create_document' && action.result?.changedDocumentId) {
      const created=getDocument?.(action.result.changedDocumentId)??activeDocument;
      (created?.id===action.result.changedDocumentId ? verified:pending).push(`created document ${action.result.changedDocumentId}`);
    }
    if (!action.result?.commandId) {
      if(action.result?.renderRequired&&action.toolName!=='create_document')pending.push(`${action.toolName}: canonical mutation did not produce a command`);
      continue;
    }
    const transform=['edit_transform','edit_align_layer','edit_flip_layer'].includes(action.toolName);
    const key = JSON.stringify([action.result.changedDocumentId??action.args.documentId??activeDocument?.id,transform?'transform':action.toolName,action.args.layerId??action.result?.after?.createdLayerId??action.result?.after?.layerId,action.args.maskId,action.args.parameterId,action.args.channel]);
    const previous=latest.get(key);
    if(transform) {
      const command=getCommand?.(action.result.commandId);
      const update=command instanceof TransformCommand?command.targetTransform:action.args.transform??action.args;
      const combined={...(previous?.args.transform??{}),...update};
      latest.set(key,{...action,args:{...action.args,transform:combined}});continue;
    }
    latest.set(key, action);
  }
  for (const action of latest.values()) {
    const document=getDocument?.(action.result?.changedDocumentId??action.args.documentId??activeDocument?.id??'')??activeDocument;
    const args = action.args;
    if (!document || args.documentId && args.documentId !== document.id) {pending.push('target document unavailable');continue;}
    if (document.kind === 'develop' && /^develop_set_(parameter|exposure|contrast|temperature|tint|saturation|highlights|shadows)$/.test(action.toolName)) {
      const id = args.parameterId ?? action.toolName.replace('develop_set_', '');
      (parameter(document.settings,id,args.channel) === args.value ? verified : pending).push(`${id} = ${args.value}`);
    } else if(document.kind==='edit'&&/^edit_create_(image|text|paint|adjustment)_layer$/.test(action.toolName)) {
      const id=action.result?.after?.createdLayerId??action.result?.after?.layerId,layer=allLayers(document.layers).find(l=>l.id===id);
      const type=action.toolName.replace('edit_create_','').replace('_layer','');
      const command=getCommand?.(action.result!.commandId!),created=command instanceof CreateLayerCommand?command.layer:layer;
      const valid=layer?.type===type&&created?.id===id&&(!args.name||created?.name===args.name)&&
        (type!=='image'||layer.type==='image'&&layer.sourceAssetId===args.assetId)&&
        (type!=='text'||layer.type==='text'&&layer.text===String(args.text))&&
        (type!=='adjustment'||layer.type==='adjustment'&&layer.adjustmentType===args.adjustmentType);
      (valid?verified:pending).push(`created layer ${id}: actual ${type}`);
    } else if (document.kind === 'edit' && args.layerId) {
      const layer = allLayers(document.layers).find(l => l.id === args.layerId);
      if (action.toolName === 'edit_delete_layer') {(layer ? pending : verified).push(`layer ${args.layerId} deleted`);continue;}
      if (!layer) {pending.push(`layer ${args.layerId} missing`);continue;}
      if(action.toolName==='edit_move_layer_order') {
        const location=locateLayer(document.layers,args.layerId)!;
        (location.index===Math.max(0,Math.min(args.toIndex,location.siblings.length-1))?verified:pending).push(`layer ${args.layerId}: actual order`);continue;
      }
      if(['edit_transform','edit_align_layer','edit_flip_layer'].includes(action.toolName)) {
        const update=args.transform??args,keys=['x','y','scaleX','scaleY','rotation'].filter(key=>update[key]!==undefined);
        (keys.length&&keys.every(key=>(layer.transform as unknown as Record<string,unknown>)[key]===update[key])?verified:pending).push(`layer ${args.layerId}: actual transform`);continue;
      }
      if(action.toolName==='edit_brush_stroke'||action.toolName==='edit_paint_mask') {
        const command=getCommand?.(action.result!.commandId!);
        const asset=command instanceof BrushStrokeCommand?command.finalAssetId:command instanceof PaintMaskCommand?command.finalMaskAssetId:undefined;
        const current=action.toolName==='edit_paint_mask'?layer.mask?.assetId:'rasterAssetId' in layer?layer.rasterAssetId:undefined;
        const valid=asset&&current===asset&&defaultAssetManager.hasAsset(asset)&&
          (command instanceof BrushStrokeCommand||command instanceof PaintMaskCommand)&&command.stroke.id===action.result?.after?.strokeId&&JSON.stringify(command.stroke.points)===JSON.stringify(args.points);
        (valid?verified:pending).push(`layer ${args.layerId}: actual stroke asset`);continue;
      }
      const patch = action.result?.after;
      const checked = patch && typeof patch === 'object' && Object.keys(patch).length && Object.entries(patch).every(([key,value]) => JSON.stringify((layer as any)[key]) === JSON.stringify(value));
      (checked ? verified : pending).push(`layer ${args.layerId}: actual ${Object.keys(patch ?? {}).join(', ') || 'state requires verification'}`);
    } else if(document.kind==='edit'&&['edit_crop','edit_resize_canvas','edit_resize_image'].includes(action.toolName)) {
      const valid=action.toolName==='edit_crop'?JSON.stringify(document.cropRect)===JSON.stringify({x:args.x,y:args.y,width:args.width,height:args.height}):document.width===args.width&&document.height===args.height;
      (valid?verified:pending).push(`${action.toolName}: actual document geometry`);
    } else if (action.result?.after !== undefined) {
      // A snapshot can be checked only when it is exactly the current engine state.
      const current = document.kind === 'develop' ? document.settings : document;
      (JSON.stringify(current) === JSON.stringify(action.result.after) ? verified : pending).push(`${action.toolName}: actual state`);
    } else pending.push(`${action.toolName}: technical verification unavailable`);
  }
  if (activeDocument?.kind === 'edit') for (const layer of allLayers(activeDocument.layers)) {
    const t=layer.transform;
    if (!Object.values(t).every(Number.isFinite) || (layer.type==='group' ? t.width<0||t.height<0 : t.width<=0||t.height<=0)) pending.push(`layer ${layer.id}: invalid geometry`);
    if (layer.mask && (!layer.mask.assetId || !Number.isFinite(layer.mask.density) || layer.mask.density < 0 || layer.mask.density > 1)) pending.push(`layer ${layer.id}: invalid mask`);
    if (layer.type === 'text') {
      if (typeof layer.text !== 'string' || !Number.isFinite(layer.fontSize) || layer.fontSize <= 0) pending.push(`text ${layer.id}: invalid actual text`);
      const canvas=typeof globalThis.document !== 'undefined' ? globalThis.document.createElement('canvas') : undefined;
      const ctx=canvas?.getContext('2d');
      if (ctx) {
        ctx.font=`${layer.fontStyle ?? 'normal'} ${layer.fontWeight ?? 'normal'} ${layer.fontSize}px ${layer.fontFamily}`;
        const lines=layer.text.split(/\r\n|\r|\n/);
        if (lines.some(line=>ctx.measureText(line).width+Math.max(0,Array.from(line).length-1)*layer.letterSpacing>t.width) || lines.length*layer.fontSize*(layer.lineHeight??1.2)>t.height) pending.push(`text ${layer.id}: actual text overflows bounds`);
        else verified.push(`text ${layer.id}: measured text within bounds`);
      } else pending.push(`text ${layer.id}: font measurement unavailable`);
    }
  }
  return {verified:[...new Set(verified)],pending:[...new Set(pending)]};
}
export function parseVisualReview(answer: string): {verdict: 'pass' | 'repair' | 'pending'; pending: string[]} {
  try {
    const result=JSON.parse(answer);
    if (!result || !['pass','repair','pending'].includes(result.verdict) || !Array.isArray(result.pending) || !result.pending.every((p:unknown)=>typeof p==='string')) throw new Error();
    const pending=result.pending.slice(0,16).map((p:string)=>p.slice(0,500));
    return {verdict:result.verdict==='pass' && pending.length ? 'pending' : result.verdict,pending};
  } catch {return {verdict:'pending',pending:['Independent visual review did not return a supported verdict']};}
}
