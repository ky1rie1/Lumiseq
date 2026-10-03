import { expect, it } from 'vitest';
import { technicalReview } from './QualityReview';
import { createDevelopDocument } from '../../document/DevelopDocument';
import { createEditDocument, createImageLayer } from '../../document/EditDocument';
import { rawRecipeRevision } from '../../smartobject/RawSmartObjectService';
import type { DevelopSmartObjectLayer } from '../../types/edit';
import type { AgentActionLogEntry } from '../types';

function fixture() {
 const target=createDevelopDocument({sourceUri:'staged.raw',fileName:'RAW',isRaw:true});
 const layer:DevelopSmartObjectLayer={...createImageLayer({name:'RAW',sourceAssetId:'original',naturalWidth:16,naturalHeight:16}),
  type:'develop-smart-object',sourceRawUri:'original.raw',developSettings:structuredClone(target.settings),rawProcessingVersion:1,rawCorrectionMode:'camera'};
 const source=createEditDocument({name:'Source',width:16,height:16,renderingVersion:2,layers:[layer]});
 target.originalRawAssetId='original';target.rawSmartObjectLink={documentId:source.id,layerId:layer.id,sourceRevision:rawRecipeRevision(layer)};
 const action:AgentActionLogEntry={id:'action',runId:'run',stepIndex:0,timestamp:0,status:'success',toolName:'edit_raw_smart_object',
  args:{action:'open',documentId:source.id,layerId:layer.id},result:{success:true,toolCallId:'open',changedDocumentId:target.id,renderRequired:true}};
 const get=(id:string)=>id===source.id?source:id===target.id?target:null;
 return {target,source,layer,action,get};
}
it('verifies linked RAW navigation without an undo command',()=>{
 const c=fixture(),result=technicalReview(c.target,[c.action],c.get);
 expect(result.pending).toEqual([]);expect(result.verified).toContain(`RAW recipe navigation ${c.target.id}`);
});
it.each(['active','source','recipe','apply'])('does not whitelist invalid RAW navigation: %s',kind=>{
 const c=fixture();if(kind==='source')c.target.originalRawAssetId='wrong';
 if(kind==='recipe')c.layer.developSettings.exposure=1;
 if(kind==='apply')c.action.args.action='apply';
 const result=technicalReview(kind==='active'?c.source:c.target,[c.action],c.get);
 expect(result.pending.length).toBeGreaterThan(0);
 if(kind==='apply')expect(result.pending[0]).toContain('canonical mutation did not produce a command');
});
