import type { StudioDocument } from '../../types/document';
import type { DocumentRegion } from './TaskPolicy';
import { layerBounds, layerWorldMatrix, locateLayer } from '../../edit/LayerTree';
import { defaultSelectionManager } from '../../selection/SelectionManager';
import { defaultBrushSettings } from '../../brush/BrushSettings';

export interface CanonicalWriteScope {
  targetIds:string[];
  regions:DocumentRegion[];
  local:boolean;
  known:boolean;
  maskIds?:string[];
  changesSelection?:boolean;
  changesMask?:boolean;
}
export function containsRegion(outer:DocumentRegion,inner:DocumentRegion):boolean {
  return inner.x>=outer.x&&inner.y>=outer.y&&inner.x+inner.width<=outer.x+outer.width&&inner.y+inner.height<=outer.y+outer.height;
}
function pointBounds(points:{x:number;y:number}[],radius:number):DocumentRegion|undefined {
  if(!points.length||!Number.isFinite(radius)||radius<=0||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return;
  const x=Math.min(...points.map(p=>p.x))-radius,y=Math.min(...points.map(p=>p.y))-radius;
  return {x,y,width:Math.max(...points.map(p=>p.x))+radius-x,height:Math.max(...points.map(p=>p.y))+radius-y};
}
/** Resolve actual canonical semantics, including tools that ignore an extra layerId argument. */
export function canonicalWriteScope(name:string,args:Record<string,any>,doc:StudioDocument):CanonicalWriteScope {
  const scope:CanonicalWriteScope={targetIds:[],regions:[],local:false,known:false};
  if(doc.kind==='develop') {
    if(!name.includes('mask'))return {...scope,known:name.startsWith('develop_')};
    scope.local=true;
    const mask=doc.settings.masks.find(m=>m.id===args.maskId);
    scope.targetIds=args.maskId?[args.maskId]:[];
    const shapes=[...(mask?[mask]:[]),...(name==='develop_update_mask'||args.geometry||args.strokes?[{...mask,...args}]:[])];
    for(const shape of shapes) {
      if(shape.inverted||shape.kind==='linear')return scope;
      if(shape.kind==='radial'&&shape.geometry?.center) {
        const center=shape.geometry.center,radiusX=shape.geometry.radiusX??0.3,radiusY=shape.geometry.radiusY??0.3;
        if(!Number.isFinite(radiusX)||!Number.isFinite(radiusY))return scope;
        scope.regions.push({x:(center.x-radiusX)*doc.width,y:(center.y-radiusY)*doc.height,width:2*radiusX*doc.width,height:2*radiusY*doc.height});
      } else if(shape.kind==='brush'&&shape.strokes?.length) {
        for(const stroke of shape.strokes){const r=pointBounds(stroke.points.map((p:{x:number;y:number})=>({x:p.x*doc.width,y:p.y*doc.height})),stroke.radius*Math.max(doc.width,doc.height));if(!r)return scope;scope.regions.push(r);}
      } else return scope;
    }
    scope.known=scope.regions.length>0;return scope;
  }
  const implicit=['edit_remove_selected_object','edit_generative_fill','edit_clone_stamp','edit_heal'];
  const actualId=implicit.includes(name)?(doc.selectedLayerId&&locateLayer(doc.layers,doc.selectedLayerId)?.layer.id)||doc.layers[0]?.id:args.layerId;
  if(actualId)scope.targetIds.push(actualId);
  if(Array.isArray(args.memberLayerIds))scope.targetIds.push(...args.memberLayerIds);
  if(args.targetGroupId)scope.targetIds.push(args.targetGroupId);
  const layer=actualId?locateLayer(doc.layers,actualId)?.layer:undefined;
  if(['edit_remove_selected_object','edit_generative_fill'].includes(name)) {
    const selection=doc.selection??defaultSelectionManager.getSelection(doc.id);
    scope.local=true;scope.changesSelection=true;
    if(selection?.active&&selection.documentId===doc.id&&!selection.inverted) {
      const feather=selection.feather;scope.regions=[{x:selection.bounds.x-feather,y:selection.bounds.y-feather,width:selection.bounds.width+2*feather,height:selection.bounds.height+2*feather}];scope.known=true;
    }
  } else if(['edit_brush_stroke','edit_paint_mask'].includes(name)&&layer) {
    scope.local=true;scope.changesMask=name==='edit_paint_mask';
    const r=pointBounds(args.points??[],(args.settings?.size??defaultBrushSettings.size)/2);
    if(r){const m=layerWorldMatrix(doc,layer.id);const corners=[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]}));
      const x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y));scope.regions=[{x,y,width:Math.max(...corners.map(p=>p.x))-x,height:Math.max(...corners.map(p=>p.y))-y}];scope.known=true;}
    // These canonical tools replace the raster/mask with a newly rendered blank canvas.
    // Until they preserve existing pixels, the full replacement target is the actual write scope.
    const b=layerBounds(layer,layerWorldMatrix(doc,layer.id));
    scope.regions.push(layer.mask?.referenceTransform&&scope.changesMask?{x:0,y:0,width:doc.width,height:doc.height}:{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top});
  } else if(name==='edit_clone_stamp'||name==='edit_heal') {
    scope.local=true;
    const r=pointBounds(name==='edit_clone_stamp'?[args.source,args.destination]:[{x:args.x,y:args.y}],args.size??(name==='edit_heal'?25:30));
    if(r){scope.regions=[r];scope.known=true;}
  } else if(/^edit_select_/.test(name)) {
    // Segmentation has no declared result bounds before it runs; an invented detector is unsafe.
    scope.local=true;scope.changesSelection=true;
    scope.targetIds=args.target==='active_layer'&&doc.selectedLayerId?[doc.selectedLayerId]:doc.layers.map(l=>l.id);
  } else if(layer) {
    const b=layerBounds(layer,layerWorldMatrix(doc,layer.id));scope.regions=[{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top}];
    scope.known=true;scope.local=name==='edit_draw_gradient';scope.changesMask=scope.local&&args.isMask===true;
  }
  if(scope.changesMask&&layer?.mask)scope.maskIds=[layer.mask.id];
  return scope;
}
