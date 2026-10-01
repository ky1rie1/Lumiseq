import { expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { DocumentManager } from '../../../document/DocumentManager';
import { createEditDocument } from '../../../document/EditDocument';
import { DocumentObservationService } from '../../vision/DocumentObservationService';
import { ToolRegistry } from '../ToolRegistry';
import { StudioMCPServer } from '../../mcp/StudioMCPServer';
import { PermissionGuard } from '../../permissions/PermissionGuard';
import { CommandBus } from '../../../history/CommandBus';
import { VisionInspector } from '../../vision/VisionInspector';
import type { IToolContext } from '../CanonicalTool';
function fixture(){
  const documents=new DocumentManager(),doc=createEditDocument({width:6000,height:4000});documents.openDocument(doc);
  const service=new DocumentObservationService({documents,renderer:{async render(_doc,g){return {data:(g.mimeType==='image/png'?createCanvas(g.width,g.height).toBuffer('image/png'):createCanvas(g.width,g.height).toBuffer('image/jpeg')).toString('base64'),mimeType:g.mimeType,approximate:false};}}});
  const context:IToolContext={documentManager:documents,commandBus:new CommandBus(),currentWorkspace:'edit',observationService:service};
  return {doc,documents,service,context,registry:new ToolRegistry()};
}
it('registers versioned explicit document reads and keeps bytes out of result data',async()=>{
  const {doc,registry,context,service}=fixture();
  const result=await registry.get('inspect_region')!.execute(context,{documentId:doc.id,region:{x:1500,y:1000,width:1200,height:800},mode:'region',maxDimension:600},'a');
  expect(result.success).toBe(true);expect(result.data.evidence.pixelToDocument).toEqual([2,0,0,2,1500,1000]);
  expect(result.images?.[0].observationId).toBe(result.data.evidence.observationId);
  expect(JSON.stringify(result.data)).not.toContain(result.images![0].data);
  const metadata=await registry.get('get_observation')!.execute(context,{id:result.data.evidence.observationId,metadataOnly:true},'b');
  expect(metadata.images).toBeUndefined();expect(metadata.data.evidence.revision).toBe(service.revision(doc.id));service.dispose();
});
it('legacy preview uses current document observation instead of stale canvas snapshot',async()=>{
  const {doc,registry,context,service}=fixture();context.visionSnapshot={preview512:'stale-canvas'};
  const result=await registry.get('get_preview')!.execute(context,{},'p');
  expect(result.data.evidence.documentId).toBe(doc.id);expect(result.data.preview).toMatch(/^data:image\/jpeg;base64,/);expect(result.data.preview).not.toBe('stale-canvas');service.dispose();
});
it('rejects missing documents, stale revisions, malformed arguments and unsupported Edit original reads',async()=>{
  const {doc,registry,context,service}=fixture();const inspect=registry.get('inspect_document')!;
  expect((await inspect.execute(context,{documentId:'missing'},'a')).error?.code).toBe('NO_DOCUMENT');
  expect((await inspect.execute(context,{documentId:doc.id,request:{expectedRevision:'old'}},'b')).error?.code).toBe('STALE_SOURCE');
  expect((await inspect.execute(context,{documentId:doc.id,request:{variant:'original'}},'c')).error?.code).toBe('UNSUPPORTED_OPERATION');
  expect((await inspect.execute(context,{documentId:doc.id,request:{expectedRevision:42}},'d')).error?.code).toBe('INVALID_ARGUMENT');
  service.dispose();
});
it('MCP emits image plus evidence and observation ID resources without base64 text',async()=>{
  const {doc,documents,service,registry}=fixture();
  const server=new StudioMCPServer(registry,new PermissionGuard(),documents,new CommandBus(),new VisionInspector(),{permissionLevel:'readonly',observationService:service});
  const result=await server.dispatch({method:'tools/call',params:{name:'studio_inspect_document',arguments:{documentId:doc.id}}});
  expect(result.isError).toBeFalsy();expect(result.content[1].type).toBe('image');
  const evidence=JSON.parse(result.content[0].text).evidence;
  expect(result.content[0].text).not.toContain(result.content[1].data);
  const resource=await server.dispatch({method:'resources/read',params:{uri:`studio://observation/${evidence.observationId}`}});
  expect(JSON.parse(resource.contents[0].text).evidence).toEqual(evidence);
  service.dispose();await server.close();
});
it('bounds serialized MCP tool results including text data',async()=>{
  const {documents,service,registry}=fixture();
  registry.register({schema:{name:'large_read',description:'test read',workspace:'any',category:'read',riskLevel:'safe',parameters:{type:'object',properties:{},required:[]}},async execute(_ctx,_args,id){return {success:true,toolCallId:id,renderRequired:false,data:{text:'x'.repeat(32*1024*1024)}};}});
  const server=new StudioMCPServer(registry,new PermissionGuard(),documents,new CommandBus(),new VisionInspector(),{permissionLevel:'readonly',observationService:service});
  const result=await server.dispatch({method:'tools/call',params:{name:'studio_large_read',arguments:{}}});
  expect(result.isError).toBe(true);expect(JSON.stringify(result).length).toBeLessThan(1000);service.dispose();await server.close();
});
it('classifies actual render and disposed failures as source unavailable',async()=>{
 const {documents,doc,registry,context,service}=fixture();service.dispose();
 const failed=new DocumentObservationService({documents,renderer:{async render(){throw new Error('device unavailable');}}});context.observationService=failed;
 expect((await registry.get('inspect_document')!.execute(context,{documentId:doc.id},'render')).error?.code).toBe('SOURCE_UNAVAILABLE');failed.dispose();
 expect((await registry.get('inspect_document')!.execute(context,{documentId:doc.id},'disposed')).error?.code).toBe('SOURCE_UNAVAILABLE');
});
it('distinguishes supported-buffer/image resource bounds from malformed geometry',async()=>{
 const {documents,doc,registry,context,service}=fixture();service.dispose();
 const buffer=new DocumentObservationService({documents,renderer:{async render(){throw new Error('Layer exceeds the supported render buffer size.');}}});context.observationService=buffer;
 expect((await registry.get('inspect_document')!.execute(context,{documentId:doc.id},'buffer')).error?.code).toBe('SOURCE_UNAVAILABLE');buffer.dispose();
 const size=new DocumentObservationService({documents,maxImageBytes:1,renderer:{async render(){return {data:'aGVsbG8=',mimeType:'image/jpeg',approximate:false};}}});context.observationService=size;
 expect((await registry.get('inspect_document')!.execute(context,{documentId:doc.id},'size')).error?.code).toBe('SOURCE_UNAVAILABLE');
 expect((await registry.get('inspect_region')!.execute(context,{documentId:doc.id,mode:'region',region:{x:0,y:0,width:-1,height:2}},'geometry')).error?.code).toBe('INVALID_ARGUMENT');size.dispose();
});
