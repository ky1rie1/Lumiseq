import { CanonicalTool, type IToolContext } from '../CanonicalTool';
import type { CanonicalToolSchema, JSONSchemaProperty, ToolResult } from '../../types';
import { EDIT_AUTO_COLOR_STRATEGIES, EditAutoColorService, type EditAutoColorStrategy } from '../../../edit/EditAutoColorService';
import { DevelopAutoToneService, developAutoColorRevision, developAutoColorSourceId } from '../../../develop/DevelopAutoToneService';
import { NATURAL_AUTO_COLOR_KEYS, type NaturalAutoColorPatch } from '../../../develop/floatAutoTone';
import type { DocumentObservation } from '../../vision/observationTypes';

function error(toolCallId:string,code:NonNullable<ToolResult['error']>['code'],message:string):ToolResult {
 return {success:false,toolCallId,renderRequired:false,error:{code,message}};
}
function failure(toolCallId:string,cause:unknown):ToolResult {
 const message=cause instanceof Error?cause.message:String(cause);
 if(cause instanceof RangeError)return error(toolCallId,'INVALID_ARGUMENT',message);
 if(/version 2|float precision/i.test(message))return error(toolCallId,'UNSUPPORTED_OPERATION',message);
 if(/closed|not found/i.test(message))return error(toolCallId,'NO_DOCUMENT',message);
 if(/cancel|stale|revision|source changed/i.test(message))return error(toolCallId,'STALE_SOURCE',message);
 return error(toolCallId,'COMMAND_FAILED',message);
}

export class EditAutoColorTool extends CanonicalTool {
 constructor(private service:(context:IToolContext)=>EditAutoColorService=c=>new EditAutoColorService(c.documentManager,c.commandBus)){super();}
 readonly schema:CanonicalToolSchema={name:'edit_auto_color',workspace:'edit',category:'edit',riskLevel:'normal',
  description:'Analyze version 2 float composition and add editable adjustments in one undo. autoContrast uses shared channel anchors; autoTone uses independent channel curves and may change color cast; autoColor corrects supported near-neutral colors and otherwise retains shared-channel contrast. Original source pixels and alpha remain intact.',
  parameters:{type:'object',properties:{documentId:{type:'string',description:'Optional active edit document ID.'},
   strategy:{type:'string',description:'Separate automatic contrast, tone or color strategy.',enum:[...EDIT_AUTO_COLOR_STRATEGIES]}},required:['strategy']}};
 async execute(context:IToolContext,args:Record<string,any>,toolCallId:string):Promise<ToolResult>{
  if(context.currentWorkspace!=='edit')return error(toolCallId,'WRONG_WORKSPACE','Edit automatic color requires the edit workspace');
  if(!EDIT_AUTO_COLOR_STRATEGIES.includes(args.strategy))return error(toolCallId,'INVALID_ARGUMENT','Unknown edit automatic strategy');
  const id=args.documentId??context.documentManager.getActiveDocument()?.id;
  if(typeof id!=='string'||!context.documentManager.getEditDocument(id))return error(toolCallId,'NO_DOCUMENT','No active edit document');
  if(context.signal?.aborted)return error(toolCallId,'STALE_SOURCE','Edit automatic color cancelled');
  try {
   const result=await this.service(context).applyWithResult(id,args.strategy as EditAutoColorStrategy,context.signal);
   if(!result)return error(toolCallId,'STALE_SOURCE','Edit automatic color cancelled because the source or active document changed');
   return {success:true,toolCallId,changedDocumentId:id,commandId:result.commandId,after:result,
    renderRequired:!!result.commandId,...(result.evidence.fallbackReason?{warning:result.evidence.fallbackReason}:{})};
  }catch(cause){return failure(toolCallId,cause);}
 }
}

const candidateBounds:Record<keyof NaturalAutoColorPatch,[number,number]>={exposure:[-3,3],contrast:[-20,20],highlights:[-85,25],
 shadows:[-25,35],whites:[-25,25],blacks:[-20,20],saturation:[-8,5],vibrance:[-8,12]};
const parameterProperties=Object.fromEntries(NATURAL_AUTO_COLOR_KEYS.map(key=>[key,{type:'number',description:`Absolute ${key} value in [${candidateBounds[key].join(', ')}]${key==='exposure'?' EV':''}; automatic WB is independent.`}])) as Record<string,JSONSchemaProperty>;
function parameters(value:unknown,failed:boolean):NaturalAutoColorPatch {
 if(value===undefined&&failed)return {exposure:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,saturation:0,vibrance:0};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==8)throw new RangeError('Semantic parameters must contain exactly eight automatic controls');
 const patch=value as NaturalAutoColorPatch;
 if(NATURAL_AUTO_COLOR_KEYS.some(key=>typeof patch[key]!=='number'||!Number.isFinite(patch[key])||patch[key]<candidateBounds[key][0]||patch[key]>candidateBounds[key][1]))throw new RangeError('Semantic automatic controls are missing, nonfinite or outside conservative bounds');
 return structuredClone(patch);
}
interface SemanticRegion {observationId?:string;x:number;y:number;width:number;height:number}
function currentEvidence(observation:DocumentObservation|undefined,id:string,revision:string):boolean {
 return !!observation&&observation.evidence.documentId===id&&observation.evidence.revision===revision&&observation.evidence.variant==='current';
}

export class DevelopSemanticAutoColorTool extends CanonicalTool {
 constructor(private service:(context:IToolContext)=>DevelopAutoToneService=c=>new DevelopAutoToneService(c.documentManager,c.commandBus)){super();}
 readonly schema:CanonicalToolSchema={name:'develop_semantic_auto_color',workspace:'develop',category:'develop',riskLevel:'normal',
  description:'Explicitly propose eight-control natural RAW color from existing AI observations; this tool never calls a model. First observe current whole-image overview, then native-resolution highlight/skin/noise/texture/subject regions. Supply their observation IDs, current sourceId and documentRevision. Rounded candidate is checked with the same retained-recipe safety evaluator against local and neutral recipes. Missing/failed vision or inferior/unsafe candidate retains verified local color in one undo. Native observations do not certify post-adjustment spatial rendering.',
  parameters:{type:'object',properties:{documentId:{type:'string',description:'Optional active version 2 RAW document ID.'},
   sourceId:{type:'string',description:'Current nativeAssetId (or original source identifier when unavailable).'},
   documentRevision:{type:'string',description:'Current overview observation revision; without an observation service use developAutoColorRevision.'},
   intent:{type:'string',description:'Explicit scene intent; candidate remains subject to natural numerical safety.',enum:['natural','low-key','high-key']},
   parameters:{type:'object',description:'Absolute eight-control recipe; omit only when visionStatus is failed.',properties:parameterProperties,required:[...NATURAL_AUTO_COLOR_KEYS]},
   visionStatus:{type:'string',description:'Set failed to retain verified local color after unavailable/failed vision.',enum:['ready','failed'],default:'ready'},
   overviewObservationId:{type:'string',description:'Cached current whole-image overview observation ID.'},
   regions:{type:'array',description:'Up to eight native pixel regions, each with cached current 1:1 non-approximate observation evidence.',items:{type:'object',description:'Original document pixel coordinates.',properties:{
    observationId:{type:'string',description:'Cached native-resolution observation ID.'},x:{type:'integer',description:'Left source pixel.'},y:{type:'integer',description:'Top source pixel.'},
    width:{type:'integer',description:'Source region width.'},height:{type:'integer',description:'Source region height.'}},required:['observationId','x','y','width','height']}}},required:['sourceId','documentRevision','intent']}};
 async execute(context:IToolContext,args:Record<string,any>,toolCallId:string):Promise<ToolResult>{
  if(context.currentWorkspace!=='develop')return error(toolCallId,'WRONG_WORKSPACE','Semantic automatic color requires the develop workspace');
  const id=args.documentId??context.documentManager.getActiveDocument()?.id,doc=typeof id==='string'?context.documentManager.getDevelopDocument(id):null;
  if(!doc)return error(toolCallId,'NO_DOCUMENT','No active RAW document');
  if(!doc.isRaw||doc.settings.renderingVersion!==2)return error(toolCallId,'UNSUPPORTED_OPERATION','Semantic automatic color requires a version 2 RAW source');
  if(context.signal?.aborted||context.documentManager.getActiveDocument()?.id!==id)return error(toolCallId,'STALE_SOURCE','Semantic automatic color cancelled or document is inactive');
  try {
   const currentRevision=()=>{const current=context.documentManager.getDevelopDocument(doc.id);if(!current)return '';return context.observationService?.revision(doc.id)??developAutoColorRevision(current);};
   if(typeof args.sourceId!=='string'||typeof args.documentRevision!=='string')throw new RangeError('Explicit sourceId and documentRevision are required');
   if(args.sourceId!==developAutoColorSourceId(doc)||args.documentRevision!==currentRevision())return error(toolCallId,'STALE_SOURCE','Semantic source or observation revision changed');
   if(!['natural','low-key','high-key'].includes(args.intent)||args.visionStatus!==undefined&&!['ready','failed'].includes(args.visionStatus))throw new RangeError('Invalid semantic intent or vision status');
   const patch=parameters(args.parameters,args.visionStatus==='failed');
   const regions=(args.regions??[]) as SemanticRegion[];
   if(!Array.isArray(regions)||regions.length>8||regions.some(r=>!r||![r.x,r.y,r.width,r.height].every(Number.isSafeInteger)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>doc.width||r.y+r.height>doc.height))throw new RangeError('Invalid bounded native semantic regions');
   const observations=context.observationService,overview=typeof args.overviewObservationId==='string'?observations?.get(args.overviewObservationId):undefined;
   let visionReady=args.visionStatus!=='failed'&&currentEvidence(overview,doc.id,args.documentRevision)&&
    overview!.evidence.region.x===0&&overview!.evidence.region.y===0&&overview!.evidence.region.width===doc.width&&overview!.evidence.region.height===doc.height&&regions.length>0;
   for(const r of regions){
    const observation=typeof r.observationId==='string'?observations?.get(r.observationId):undefined,e=observation?.evidence;
    if(!currentEvidence(observation,doc.id,args.documentRevision)||!e||e.approximate||e.width!==r.width||e.height!==r.height||
     e.region.x!==r.x||e.region.y!==r.y||e.region.width!==r.width||e.region.height!==r.height||
     e.pixelToDocument.some((v,i)=>v!==[1,0,0,1,r.x,r.y][i]))visionReady=false;
   }
   const result=await this.service(context).applySemanticWithResult(doc.id,{sourceId:args.sourceId,documentRevision:args.documentRevision,currentRevision,
    intent:args.intent,parameters:patch,visionStatus:visionReady?'ready':'failed',
    regions:regions.map(r=>({x:r.x/doc.width,y:r.y/doc.height,width:r.width/doc.width,height:r.height/doc.height}))},context.signal);
   if(!result)return error(toolCallId,'STALE_SOURCE','Semantic automatic color cancelled because the source, revision or task changed');
   return {success:true,toolCallId,changedDocumentId:doc.id,commandId:result.commandId,after:result,renderRequired:!!result.commandId,
    ...(result.evidence?.semantic?.reason?{warning:result.evidence.semantic.reason}:{})};
  }catch(cause){return failure(toolCallId,cause);}
 }
}
