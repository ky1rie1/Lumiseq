import { afterEach, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { AgentRuntime, type AgentRunOptions } from './AgentRuntime';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ToolRegistry } from '../tools/ToolRegistry';
import { PermissionGuard } from '../permissions/PermissionGuard';
import { VisionInspector } from '../vision/VisionInspector';
import { DocumentObservationService } from '../vision/DocumentObservationService';
import { CapabilityRouter } from '../capabilities/CapabilityRouter';
import { DocumentManager } from '../../document/DocumentManager';
import { createDevelopDocument } from '../../document/DevelopDocument';
import { createEditDocument, createImageLayer, createGroupLayer, createPaintLayer } from '../../document/EditDocument';
import { CommandBus } from '../../history/CommandBus';
import { BaseCommand } from '../../history/Command';
import { AddGeneratedPatchLayerCommand } from '../../commands/edit/AddGeneratedPatchLayerCommand';
import type { Layer, GeneratedPatchLayer } from '../../types/edit';
import type { IAIProvider } from '../providers/IAIProvider';
import type { AgentMessage, CanonicalToolSchema } from '../types';
import type { DocumentObservationRenderPort } from '../vision/observationTypes';
import { defaultAssetManager } from '../../assets/AssetManager';
import type { PreparedCreativeReference } from '../harness/CreativeBrief';
import { rawRecipeRevision } from '../../smartobject/RawSmartObjectService';

afterEach(() => {vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
const edit = { role: 'assistant', toolCalls: [{ id: 'edit', name: 'develop_set_parameter', arguments: { parameterId: 'exposure', value: 0.3 } }] } satisfies AgentMessage;
it.each([false,true])('invalidates native coverage across a RAW transition; fresh native observation=%s', async fresh => {
  const target = createDevelopDocument({ sourceUri: 'new.arw', fileName: 'New RAW', isRaw: true, width: 100, height: 80 });
  const rawLayer:Layer={...createImageLayer({name:'RAW',sourceAssetId:'original',naturalWidth:100,naturalHeight:80}),type:'develop-smart-object',sourceRawUri:'original.arw',developSettings:structuredClone(target.settings),rawProcessingVersion:1,rawCorrectionMode:'camera'};
  const source=createEditDocument({name:'Source',width:100,height:80,renderingVersion:2,layers:[rawLayer]});
  target.originalRawAssetId='original';target.rawSmartObjectLink={documentId:source.id,layerId:rawLayer.id,sourceRevision:rawRecipeRevision(rawLayer as any)};
  const f = fixture([
    { role: 'assistant', toolCalls: [{ id: 'open', name: 'edit_raw_smart_object', arguments: { action: 'open', documentId:source.id,layerId:rawLayer.id } }] },
    ...(fresh?[{role:'assistant' as const,toolCalls:[{id:'native',name:'inspect_region',arguments:{documentId:target.id,mode:'detail',region:{x:20,y:20,width:20,height:20}}}]}]:[]),
    edit,
  ]);
  f.docs.openDocument(source);target.rawState = 'ready';f.docs.openDocument(target, false);
  f.registry.get('edit_raw_smart_object')!.execute = async (_context, _args, toolCallId) => {
    f.docs.setActiveDocument(target.id);return { success: true, toolCallId, changedDocumentId: target.id, renderRequired: true };
  };
  const run = await f.runtime.run('Check local RAW texture', { taskKind: 'local-detail', targetIds:[rawLayer.id],regions: [{ x: 20, y: 20, width: 20, height: 20 }] });
  expect(run.status, JSON.stringify({stopReason:run.stopReason,pending:run.verification?.pending,actions:run.actions})).toBe(fresh?'completed':'partial');
  if(!fresh)expect(run.stopReason).toBe('detail_coverage_pending');
  expect(f.bus.getHistory()).toHaveLength(fresh?1:0);
  if(fresh)expect(JSON.stringify(f.reviews[0])).toContain('Original source overview before document transition; not current ROI coverage');
  const images = f.seen[1].flatMap(message => message.images ?? []);
  expect(images).toHaveLength(1);
  expect(run.verification!.observations.find(e => e.observationId === images[0].observationId)?.documentId).toBe(target.id);
});
it.each([{}, { geometry: { center: { x: 0.5, y: 0.5 }, radiusX: 0.1, radiusY: 0.1 } }])('blocks inverted local Develop updates before canonical dispatch: %j', async patch => {
  const f = fixture([{ role: 'assistant', toolCalls: [{ id: 'invert', name: 'develop_update_mask', arguments: { maskId: 'mask', inverted: true, ...patch } }] }]);
  f.doc.settings.masks = [{ id: 'mask', name: 'Local', maskAssetId: 'mask-asset', kind: 'radial', inverted: false, opacity: 1, exposure: 1,
    geometry: { center: { x: 0.5, y: 0.5 }, radiusX: 0.1, radiusY: 0.1 } }];
  f.docs.updateDocument(f.doc);
  const run = await f.runtime.run('Retouch local mask', { taskKind: 'local-detail', regions: [{ x: 35, y: 25, width: 30, height: 30 }] });
  expect(run.stopReason).toBe('local_scope_unknown');
  expect(f.bus.getHistory()).toHaveLength(0);
  expect(f.docs.getDevelopDocument(f.doc.id)!.settings.masks[0].inverted).toBe(false);
});

async function referenceFixture(turns: AgentMessage[] = [{ role: 'assistant', content: 'Done' }]) {
  const f = fixture(turns);
  const asset = await defaultAssetManager.registerBlob(new Blob(['reference'], { type: 'image/png' }), 'image', 'reference');
  f.doc.sourceAssetId = asset.id; f.docs.updateDocument(f.doc);
  return { ...f, asset, references: [{ assetId: asset.id, source: 'document' as const, label: 'Target crop', region: { x: 3, y: 4, width: 2, height: 2 } }] };
}
it.each([{ maxImages: 0, includeVision: false }, { maxImages: 1, includeVision: true }])('reserves reference image capacity before rendering/upload: %j', async options => {
  const f = await referenceFixture();
  try {
    const run = await f.runtime.run('Match reference palette', { taskKind: options.includeVision ? 'photo' : 'precise', references: f.references, ...options });
    expect(run.status).toBe('budget_exhausted'); expect(run.stopReason).toBe('maxImages_exhausted');
    expect(f.seen).toHaveLength(0);
    expect(run.budget?.images).toBe(options.maxImages);
  } finally { defaultAssetManager.releaseAsset(f.asset.id); }
});
it('counts retained reference bytes once across planner steps and includes immutable reference pixels in independent review', async () => {
  const f = await referenceFixture([{ role: 'assistant', toolCalls: [{ id: 'read', name: 'get_develop_settings', arguments: {} }] }, { role: 'assistant', content: 'Done' }]);
  try {
    const run = await f.runtime.run('Match reference palette', { taskKind: 'photo', references: f.references });
    expect(run.status).toBe('completed'); expect(run.budget?.images).toBe(3);
    const reference = f.seen[0].flatMap(message => message.images ?? []).find(image => (image as PreparedCreativeReference).evidence?.region.width === 2)!;
    expect(reference).toBeDefined();
    expect(f.seen[1].flatMap(message => message.images ?? []).find(image => image.observationId === reference.observationId)?.data).toBe(reference.data);
    const review = f.reviews[0];
    expect(JSON.stringify(review)).toContain('Target crop');
    expect(review.flatMap(message => message.images ?? []).find(image => image.observationId === reference.observationId)?.data).toBe(reference.data);
    const unique = new Map([...f.seen[0], ...review].flatMap(message => message.images ?? []).map(image => [image.observationId, image]));
    expect(run.budget?.imageBytes).toBe([...unique.values()].reduce((sum, image) => sum + Buffer.from(image.data, 'base64').length, 0));
    expect(JSON.stringify(f.docs.getDocument(f.doc.id)?.aiHistory)).not.toContain(reference.data);
  } finally { defaultAssetManager.releaseAsset(f.asset.id); }
});
it('charges a reference-only task once and leaves its unavailable visual review pending', async () => {
  const f = await referenceFixture();
  try {
    const run = await f.runtime.run('Match reference palette', { taskKind: 'precise', includeVision: false, references: f.references, maxImages: 1, maxToolCalls: 1 });
    const images = f.seen[0].flatMap(message => message.images ?? []);
    expect(images).toHaveLength(1);
    expect(run.budget).toMatchObject({ images: 1, imageBytes: Buffer.from(images[0].data, 'base64').length, toolCalls: 1 });
    expect(run.status).toBe('partial'); expect(run.verification?.pending).toContain('Reference-dependent visual verification unavailable');
  } finally { defaultAssetManager.releaseAsset(f.asset.id); }
});
function fixture(turns: AgentMessage[], vision = true, renderer?:DocumentObservationRenderPort) {
  const docs = new DocumentManager(), doc = createDevelopDocument({ sourceUri: 'test.jpg', fileName: 'test.jpg', isRaw: false });
  doc.width = 100; doc.height = 80; docs.openDocument(doc);
  const bus = new CommandBus(docs), registry = new ToolRegistry(), providers = new ProviderRegistry(), guard = new PermissionGuard();
  guard.setLevel('full');
  const seen: AgentMessage[][] = [], reviews: AgentMessage[][] = [];
  const provider = { capabilities: { vision }, chat: async (messages: AgentMessage[]) => {
    if (messages[0].content?.startsWith('Independent result review')) { reviews.push(structuredClone(messages)); return { role: 'assistant', content: '{"verdict":"pass","pending":[]}' }; }
    seen.push(structuredClone(messages)); return turns.shift() ?? { role: 'assistant', content: 'Done' };
  } } as unknown as IAIProvider;
  providers.getProvider = () => provider;
  const observer = new DocumentObservationService({ documents: docs, maxImages: 1, renderer: renderer??{ async render(document, geometry) {
    const canvas = createCanvas(geometry.width, geometry.height), ctx = canvas.getContext('2d');
    ctx.fillStyle = document.kind === 'develop' && document.settings.exposure > 0 ? '#ffffff' : '#000000';
    ctx.fillRect(0, 0, geometry.width, geometry.height);
    return { data: (geometry.mimeType === 'image/png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg')).toString('base64'), mimeType: geometry.mimeType, approximate: false };
  } } });
  const router = new CapabilityRouter(providers); router.setPrivacyMode('allow');
  const inspector=new VisionInspector();
  const runtime = new AgentRuntime(providers, registry, guard, inspector, bus, docs, { observationService: observer, capabilityRouter: router });
  return { runtime, docs, doc, bus, seen, reviews, observer, router, provider, providers, registry, inspector };
}
it('exhausts model steps while preserving undo and unresolved verification', async () => {
  const f = fixture([edit]); const run = await f.runtime.run('增加曝光0.3EV', { maxSteps: 1, includeVision: false });
  expect(run.status).toBe('budget_exhausted'); expect((run as any).verification.pending.length).toBeGreaterThan(0);
  expect(f.docs.getDevelopDocument(f.doc.id)!.settings.exposure).toBe(0.3); expect(f.runtime.undoRun(run.runId)).toBe(true);
});
it.each(['将海报排版得更均衡，输出宽 1000px','检查整张照片细节，100% 查看'])('observes and reviews mixed visual prompt %s',async(prompt)=>{
  const f=fixture([{role:'assistant',content:'Done'}]);
  const run=await f.runtime.run(prompt,{regions:[{x:20,y:20,width:10,height:10}]});
  expect(run.taskKind).not.toBe('precise');expect(f.seen[0].some(m=>m.images?.length)).toBe(true);expect(f.reviews).toHaveLength(1);
});
it('keeps the configured lower provider timeout binding against a higher caller value',async()=>{
  vi.useFakeTimers();const f=fixture([]);
  const cfg=f.providers.getActiveConfig();f.providers.getActiveConfig=()=>({...cfg,timeoutMs:5});
  f.provider.chat=()=>new Promise(()=>{});
  const pending=f.runtime.run('exposure 0.3',{requestTimeoutMs:100});
  let finished=false;pending.then(()=>{finished=true;});await vi.advanceTimersByTimeAsync(6);
  expect(finished).toBe(true);expect((await pending).stopReason).toBe('provider_timeout');
});
it('aborts timed-out observation work before late pixels can enter the service cache',async()=>{
  vi.useFakeTimers();let renderSignal:AbortSignal|undefined,complete!:(value:{data:string;mimeType:'image/jpeg'|'image/png';approximate:boolean})=>void;
  const f=fixture([],true,{render(_doc,_geometry,_variant,signal){renderSignal=signal;return new Promise(resolve=>{complete=resolve;});}});
  const pending=f.runtime.run('Make photo brighter',{requestTimeoutMs:5});
  await vi.advanceTimersByTimeAsync(6);const run=await pending;
  expect(run.stopReason).toBe('provider_timeout');expect(renderSignal?.aborted).toBe(true);
  const pixels=createCanvas(100,80).toBuffer('image/jpeg').toString('base64');complete({data:pixels,mimeType:'image/jpeg',approximate:false});
  await Promise.resolve();await Promise.resolve();
  expect((f.observer as unknown as {cache:Map<string,unknown>}).cache.size).toBe(0);
});
it('time-bounds model-requested read observations and prevents late cache publication',async()=>{
  vi.useFakeTimers();let renderSignal:AbortSignal|undefined,complete!:(value:{data:string;mimeType:'image/jpeg'|'image/png';approximate:boolean})=>void;
  const call={id:'read',name:'inspect_region',arguments:{documentId:'',mode:'detail',region:{x:20,y:20,width:10,height:10}}};
  const f=fixture([{role:'assistant',toolCalls:[call]}],true,{render(_doc,_geometry,_variant,signal){renderSignal=signal;return new Promise(resolve=>{complete=resolve;});}});call.arguments.documentId=f.doc.id;
  const pending=f.runtime.run('Read exact region',{taskKind:'precise',requestTimeoutMs:5});
  await vi.advanceTimersByTimeAsync(6);const run=await pending;
  expect(run.stopReason).toBe('provider_timeout');expect(renderSignal?.aborted).toBe(true);
  complete({data:createCanvas(10,10).toBuffer('image/png').toString('base64'),mimeType:'image/png',approximate:false});
  await Promise.resolve();await Promise.resolve();expect((f.observer as unknown as {cache:Map<string,unknown>}).cache.size).toBe(0);
});
it('explicit photo uses document evidence and never reads a wrong UI snapshot or viewport histogram',async()=>{
  const f=fixture([edit,{role:'assistant',content:'Done'}]);
  const capture=vi.spyOn(f.inspector,'captureSnapshot').mockReturnValue({preview512:'wrong UI viewport',histogram:{r:[999],g:[999],b:[999],luminance:[999]}});
  const run=await f.runtime.run('Make photo brighter',{taskKind:'photo'});
  expect(run.status).toBe('completed');expect(capture).not.toHaveBeenCalled();
  expect(JSON.stringify(f.seen)).not.toContain('wrong UI viewport');expect(f.seen[0][0].content).toContain('Histogram available: None');
  const attached=f.seen[0].flatMap(m=>m.images??[]);expect(attached).toHaveLength(1);
  const img=await loadImage(Buffer.from(attached[0].data,'base64'));expect(img.width).toBe(100);expect(img.height).toBe(80);
});
it('refreshes configured fallback pixels after editing before the text-only planner continues',async()=>{
  const f=fixture([edit,{role:'assistant',content:'Done'}],false),cfg=f.providers.getActiveConfig();
  f.providers.getConfig=id=>({...cfg,id});
  f.providers.getProvider=id=>id==='fallback'?{capabilities:{vision:true},chat:async(messages:AgentMessage[])=>{
    if(messages[0].content?.startsWith('Independent result review'))return {role:'assistant',content:'{"verdict":"pass","pending":[]}'};
    const input=messages.flatMap(m=>m.images??[])[0],img=await loadImage(Buffer.from(input.data,'base64')),canvas=createCanvas(1,1);
    canvas.getContext('2d').drawImage(img,0,0,1,1);
    return {role:'assistant',content:canvas.getContext('2d').getImageData(0,0,1,1).data[0]>0?'AFTER bright pixels':'BEFORE dark pixels'};
  }} as unknown as IAIProvider:f.provider;
  f.router.saveStackConfig({...f.router.getStackConfig(),visionFallbackId:'fallback'});
  const run=await f.runtime.run('Make photo brighter');
  expect(run.status).toBe('completed');
  expect(f.seen[0].some(m=>m.content?.includes('BEFORE dark pixels'))).toBe(true);
  expect(f.seen[1].some(m=>m.content?.includes('AFTER bright pixels'))).toBe(true);
  expect(f.seen[1].some(m=>m.content?.includes('BEFORE dark pixels'))).toBe(false);
  expect(f.seen[1].flatMap(m=>m.images??[])).toHaveLength(0);
});
it('binds configured fallback timeout before its inspection request',async()=>{
  vi.useFakeTimers();const f=fixture([],false),cfg=f.providers.getActiveConfig();
  f.providers.getConfig=id=>({...cfg,id,timeoutMs:id==='fallback'?5:100});
  f.providers.getProvider=id=>id==='fallback'?{capabilities:{vision:true},chat:()=>new Promise(()=>{})} as unknown as IAIProvider:f.provider;
  f.router.saveStackConfig({...f.router.getStackConfig(),visionFallbackId:'fallback'});
  const pending=f.runtime.run('Make photo brighter',{requestTimeoutMs:100});let finished=false;pending.then(()=>{finished=true;});
  await vi.advanceTimersByTimeAsync(6);expect(finished).toBe(true);expect((await pending).stopReason).toBe('provider_timeout');
});
it('verifies exact state without image or critic calls for precise tasks', async () => {
  const f = fixture([edit, { role: 'assistant', content: 'Done' }]); const run = await f.runtime.run('增加曝光0.3EV');
  expect(run.status).toBe('completed'); expect((run as any).verification.verified).toContain('exposure = 0.3');
  expect(f.seen.flat().some(m => m.images?.length || m.image)).toBe(false); expect(f.reviews).toHaveLength(0);
});
it('starts with relevant schemas and discovers metadata/workflows before explicit schema expansion',async()=>{
  const f=fixture([]),schemas:CanonicalToolSchema[][]=[];
  f.provider.chat=async(messages,tools)=>{
    f.seen.push(structuredClone(messages));schemas.push(structuredClone(tools));
    const calls=[
      {id:'directory',name:'studio_read_guide',arguments:{uri:'studio://guide/operations'}},
      {id:'workflow',name:'studio_read_guide',arguments:{uri:'studio://workflow/precise'}},
      {id:'expand',name:'studio_discover_tools',arguments:{groups:['local'],expand:true}},
    ];return schemas.length<=calls.length?{role:'assistant',toolCalls:[calls[schemas.length-1]]}:{role:'assistant',content:'Done'};
  };
  const run=await f.runtime.run('Set exposure to 0.3 EV',{taskKind:'precise',includeVision:false});
  expect(run.status).toBe('completed');
  expect(schemas[0].some(s=>s.name==='studio_discover_tools')).toBe(true);
  expect(schemas[0].some(s=>s.name==='studio_read_guide')).toBe(true);
  expect(schemas[0].some(s=>s.name==='develop_create_mask')).toBe(false);
  expect(schemas[3].some(s=>s.name==='develop_create_mask')).toBe(true);
  const directory=run.actions[0].result!.data.directory;
  expect(directory.find((t:{name:string})=>t.name==='develop_set_parameter').units).toContain('EV');
  expect(run.actions[1].result!.data.steps).toContain('Verify state and units');
  expect(f.bus.getHistory()).toHaveLength(0);
});
it('sends real overview and immutable complete baseline / changed result to independent review', async () => {
  const f = fixture([edit, { role: 'assistant', content: 'looks fine' }]); const run = await f.runtime.run('让照片更明亮');
  expect(run.status).toBe('completed'); expect(f.seen[0].some(m => m.images?.length)).toBe(true);
  expect(f.reviews).toHaveLength(1); const images = f.reviews[0].flatMap(m => m.images ?? []); expect(images).toHaveLength(2);
  const pixels = await Promise.all(images.map(async image => { const img = await loadImage(Buffer.from(image.data, 'base64')); const c = createCanvas(1, 1); c.getContext('2d').drawImage(img, 0, 0, 1, 1); return [...c.getContext('2d').getImageData(0, 0, 1, 1).data]; }));
  expect(pixels).toEqual([[0, 0, 0, 255], [255, 255, 255, 255]]);
  expect((run as any).journal.map((j: any) => j.phase)).toEqual(expect.arrayContaining(['observation', 'plan', 'tools', 'rendered_result', 'review']));
});
it('requires native relevant detail and neighboring context before completing local detail', async () => {
  const f = fixture([edit, { role: 'assistant', content: 'Done' }]); const run = await f.runtime.run('修复局部边缘', { taskKind: 'local-detail', regions: [{ x: 20, y: 20, width: 10, height: 10 }] } as AgentRunOptions);
  expect(run.status).toBe('completed');
  const evidence = (run as any).verification.observations; expect(evidence.some((e: any) => e.width === 10 && e.height === 10 && e.pixelToDocument[0] === 1)).toBe(true);
  expect(f.reviews[0].flatMap(m => m.images ?? []).length).toBeGreaterThan(2);
});
it('cannot complete a visual edit on an unsupported text-only provider or a no-tool explanation', async () => {
  const f = fixture([{ role: 'assistant', content: 'All checked' }], false); const run = await f.runtime.run('让照片更漂亮');
  expect(run.status).toBe('partial'); expect((run as any).verification.pending.join(' ')).toMatch(/vision|视觉/i); expect(f.bus.getHistory()).toHaveLength(0);
});
it('stops repeated unchanged read calls instead of spending all steps', async () => {
  const read = { role: 'assistant', toolCalls: [{ id: 'read', name: 'get_develop_settings', arguments: {} }] } satisfies AgentMessage;
  const f = fixture([read, read, read]); const run = await f.runtime.run('增加曝光0.3EV', { includeVision: false });
  expect(run.status).toBe('partial'); expect((run as any).stopReason).toBe('no_progress'); expect(f.seen.length).toBeLessThan(4);
});
it('honors lower tool/image budgets before dispatch and reports uncovered detail', async () => {
  const f = fixture([edit]); const run = await f.runtime.run('检查整张照片细节', { taskKind: 'local-detail', wholeImage: true, maxImages: 1, maxToolCalls: 1 } as AgentRunOptions);
  expect(run.status).toBe('budget_exhausted'); expect((run as any).verification.pending.join(' ')).toMatch(/detail|coverage/i);
  expect(f.bus.getHistory()).toHaveLength(0);
});
it('removes nested image bodies from action logs and project history but sends tool images transiently', async () => {
  const f = fixture([{ role: 'assistant', toolCalls: [{ id: 'preview', name: 'get_preview', arguments: {} }] }, { role: 'assistant', content: 'Done' }]);
  const run = await f.runtime.run('Read preview', { taskKind: 'precise' } as AgentRunOptions);
  expect(f.seen[1].some(m => m.role === 'tool' && m.images?.length)).toBe(true);
  const payload = JSON.stringify([run.actions, f.docs.getDocument(f.doc.id)?.aiHistory]);
  expect(payload).not.toContain('data:image/'); expect(payload).not.toContain('/9j/');
});
it('bounds provider requests that ignore cancellation with a timeout stop reason', async () => {
  vi.useFakeTimers(); const f = fixture([]);
  (f.runtime as any).providerRegistry.getProvider = () => ({ chat: () => new Promise(() => {}) });
  const pending = f.runtime.run('增加曝光0.3EV', { includeVision: false, requestTimeoutMs: 25 } as AgentRunOptions);
  await vi.advanceTimersByTimeAsync(26); const run = await pending;
  expect(run.status).toBe('partial'); expect((run as any).stopReason).toBe('provider_timeout');
});
it('blocks image upload and visual writes when privacy never applies to the planner', async () => {
  const f = fixture([edit]); f.router.setPrivacyMode('never');
  const run = await f.runtime.run('让照片更漂亮');
  expect(run.status).toBe('partial'); expect(run.stopReason).toBe('privacy_restriction');
  expect(f.seen).toHaveLength(0); expect(f.bus.getHistory()).toHaveLength(0);
});
it('uses the configured vision fallback for independent multi-image review', async () => {
  const f = fixture([edit, { role: 'assistant', content: 'Done' }], false);
  const fallbackMessages: AgentMessage[][] = [];
  const cfg = f.providers.getActiveConfig();
  f.providers.getConfig = id => ({ ...cfg, id });
  f.providers.getProvider = id => id === 'fallback' ? { capabilities: { vision: true }, chat: async (messages: AgentMessage[]) => {
    fallbackMessages.push(structuredClone(messages)); return {role:'assistant',content:messages[0].content?.startsWith('Independent result review')?'{"verdict":"pass","pending":[]}':'Recorded fallback: dark photograph, unresolved brightness'};
  } } as unknown as IAIProvider : f.provider;
  f.router.saveStackConfig({...f.router.getStackConfig(), visionFallbackId:'fallback'});
  const run = await f.runtime.run('让照片更明亮');
  expect(run.status).toBe('completed');
  expect(fallbackMessages.some(m => m[0].content?.startsWith('Independent result review') && m.some(v => v.images?.length === 2))).toBe(true);
  expect(f.seen.every(messages => messages.every(m => !m.images?.length))).toBe(true);
  expect(f.seen[0].some(m=>m.content?.includes('Recorded fallback: dark photograph'))).toBe(true);
});
it('precise opacity validates a real nested layer without requiring visual observation', async () => {
  const f = fixture([]), layer = createImageLayer({id:'real-layer',name:'real',sourceAssetId:'source',naturalWidth:100,naturalHeight:80});
  const group=createGroupLayer({children:[layer]});group.transform.width=100;group.transform.height=80;
  const doc = createEditDocument({id:'real-edit',layers:[group]});
  f.docs.openDocument(doc);
  f.provider.chat = async (messages: AgentMessage[]) => {
    f.seen.push(structuredClone(messages));
    return f.seen.length === 1 ? {role:'assistant',toolCalls:[{id:'opacity',name:'edit_set_layer_opacity',arguments:{documentId:doc.id,layerId:layer.id,opacity:0.5}}]} : {role:'assistant',content:'Done'};
  };
  const run=await f.runtime.run('Set opacity to 50%',{taskKind:'precise'});
  expect(run.status).toBe('completed');
  const actualGroup=f.docs.getEditDocument(doc.id)!.layers[0];
  expect(actualGroup.type==='group' && actualGroup.children[0].opacity).toBe(0.5);
  expect(f.seen.flat().some(m=>m.images?.length||m.image)).toBe(false);
  expect(f.reviews).toHaveLength(0);
});
it('caller text-only mode strips tool images before the next precise provider request', async () => {
  const f=fixture([{role:'assistant',toolCalls:[{id:'preview',name:'get_preview',arguments:{}}]},{role:'assistant',content:'Done'}]);
  const run=await f.runtime.run('Read state',{taskKind:'precise',includeVision:false});
  expect(run.status).toBe('completed');
  expect(f.seen.flat().some(m=>m.images?.length||m.image)).toBe(false);
});
it('privacy never rejects precise tool-image upload before any image reaches chat', async () => {
  const f=fixture([{role:'assistant',toolCalls:[{id:'preview',name:'get_preview',arguments:{}}]},{role:'assistant',content:'Done'}]);
  f.router.setPrivacyMode('never');
  const run=await f.runtime.run('Read preview',{taskKind:'precise'});
  expect(run.status).toBe('partial');expect(run.stopReason).toBe('privacy_restriction');
  expect(f.seen.flat().some(m=>m.images?.length||m.image)).toBe(false);
});
it('retains only the latest required tool image in the transient planner context',async()=>{
  const f=fixture([]);
  f.provider.chat=async(messages:AgentMessage[])=>{
    f.seen.push(structuredClone(messages));
    return f.seen.length<3?{role:'assistant',toolCalls:[{id:String(f.seen.length),name:'inspect_region',arguments:{documentId:f.doc.id,mode:'region',region:{x:f.seen.length*10,y:0,width:10,height:10}}}]}:{role:'assistant',content:'Done'};
  };
  await f.runtime.run('Read bounded regions',{taskKind:'precise'});
  expect(f.seen[2].flatMap(m=>m.images??[])).toHaveLength(1);
  expect(f.seen[2].filter(m=>m.role==='tool'&&m.images?.length)[0].toolCallId).toBe('2');
});
it('stops targeted repairs at the caller limit while retaining edit undo',async()=>{
  const f=fixture([edit,{role:'assistant',content:'Done'},edit,{role:'assistant',content:'Done'}]);
  const planner=f.provider.chat;
  f.provider.chat=async(messages,tools,onDelta,signal)=>{
    if(messages[0].content?.startsWith('Independent result review')){f.reviews.push(structuredClone(messages));return {role:'assistant',content:'{"verdict":"repair","pending":["visible edge halo"]}'};}
    return planner(messages,tools,onDelta,signal);
  };
  const run=await f.runtime.run('Make photo brighter',{maxRepairRounds:1});
  expect(run.status).toBe('budget_exhausted');expect(run.stopReason).toBe('maxRepairRounds_exhausted');
  expect(run.budget?.repairRounds).toBe(1);expect(f.reviews).toHaveLength(2);
  expect(f.runtime.undoRun(run.runId)).toBe(true);
});
it('cannot write to a vague local claim until native ROI discovery provides evidence',async()=>{
  const f=fixture([edit]);
  const run=await f.runtime.run('Fix local detail',{taskKind:'local-detail'});
  expect(run.status).toBe('partial');expect(run.stopReason).toBe('detail_coverage_pending');expect(f.bus.getHistory()).toHaveLength(0);
});
it.each(['edit_brush_stroke','brush_stroke'])('blocks %s in unobserved ROI B after observing ROI A',async(name)=>{
  const call={id:'outside',name,arguments:{layerId:'paint',points:[{x:70,y:60},{x:75,y:60}],settings:{size:4}}};
  const f=fixture([{role:'assistant',toolCalls:[call]}]);
  const doc=createEditDocument({id:'scoped-edit',width:100,height:80,layers:[createPaintLayer({id:'paint',width:100,height:80,rasterAssetId:'before'})]});f.docs.openDocument(doc);
  const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['paint'],regions:[{x:20,y:20,width:20,height:20}]});
  expect(run.status).toBe('partial');expect(run.stopReason).toBe('roi_mismatch');expect(f.bus.getHistory()).toHaveLength(0);
  expect(f.docs.getEditDocument(doc.id)!.layers[0]).toEqual(doc.layers[0]);
});
it.each(['edit_generative_fill','edit_remove_selected_object'])('constrains implicit actual selected target of %s even when arguments claim a different layer',async(name)=>{
  const f=fixture([{role:'assistant',toolCalls:[{id:'implicit',name,arguments:{layerId:'allowed',prompt:'Remove spot'}}]}]);
  const layer=createPaintLayer({id:'allowed',width:100,height:80,rasterAssetId:'before'});
  const doc=createEditDocument({id:'implicit-edit',width:100,height:80,layers:[layer,{...layer,id:'selected'}]});doc.selectedLayerId='selected';
  doc.selection={id:'selection',documentId:doc.id,width:100,height:80,assetId:'selection-asset',bounds:{x:20,y:20,width:10,height:10},feather:0,inverted:false,active:true};f.docs.openDocument(doc);
  const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['allowed'],regions:[{x:15,y:15,width:30,height:30}]});
  expect(run.status).toBe('partial');expect(run.stopReason).toBe('target_mismatch');expect(f.bus.getHistory()).toHaveLength(0);
});
it('does not reuse native evidence from an earlier revision for the next local write',async()=>{
  const f=fixture([{role:'assistant',toolCalls:[{id:'opacity',name:'edit_set_layer_opacity',arguments:{layerId:'paint',opacity:0.5}}]},{role:'assistant',toolCalls:[{id:'stroke',name:'edit_brush_stroke',arguments:{layerId:'paint',points:[{x:22,y:22}],settings:{size:2}}}]}]);
  const doc=createEditDocument({id:'revision-edit',width:100,height:80,layers:[createPaintLayer({id:'paint',width:20,height:20,rasterAssetId:'before'})]});f.docs.openDocument(doc);
  const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['paint'],regions:[{x:0,y:0,width:40,height:40}]});
  expect(run.status).toBe('partial');expect(run.stopReason).toBe('expired_detail_evidence');expect(f.bus.getHistory()).toHaveLength(1);
});
it('rejects unknown segmentation scope before invoking a canonical write',async()=>{
  const f=fixture([{role:'assistant',toolCalls:[{id:'selection',name:'edit_select_subject',arguments:{target:'active_layer'}}]}]);
  const doc=createEditDocument({id:'unknown-edit',width:100,height:80,layers:[createPaintLayer({id:'paint',width:100,height:80,rasterAssetId:'before'})]});doc.selectedLayerId='paint';f.docs.openDocument(doc);
  const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['paint'],regions:[{x:0,y:0,width:100,height:80}]});
  expect(run.stopReason).toBe('local_scope_unknown');expect(f.bus.getHistory()).toHaveLength(0);
});
it('checks the actual layer mask identity when a local call declares a mask ID',async()=>{
  const f=fixture([{role:'assistant',toolCalls:[{id:'mask',name:'paint_mask',arguments:{layerId:'paint',maskId:'intended-mask',points:[{x:25,y:25}],settings:{size:4}}}]}]);
  const layer=createPaintLayer({id:'paint',width:100,height:80,rasterAssetId:'before'});layer.mask={id:'different-mask',assetId:'original-mask-asset',enabled:true,linked:true,density:1,feather:0};
  const doc=createEditDocument({id:'mask-edit',width:100,height:80,layers:[layer]});f.docs.openDocument(doc);
  const run=await f.runtime.run('Retouch local mask',{taskKind:'local-detail',targetIds:['paint'],regions:[{x:0,y:0,width:100,height:80}]});
  expect(run.stopReason).toBe('mask_mismatch');expect(f.bus.getHistory()).toHaveLength(0);expect(f.docs.getEditDocument(doc.id)!.layers[0].mask).toEqual(layer.mask);
});
it('rolls back an unexpected unrelated layer mutation from a faulty canonical operation',async()=>{
  const f=fixture([{role:'assistant',toolCalls:[{id:'opacity',name:'edit_set_layer_opacity',arguments:{layerId:'paint',opacity:0.5}}]}]);
  const layer=createPaintLayer({id:'paint',width:20,height:20,rasterAssetId:'before'}),other={...layer,id:'neighbor'};
  const doc=createEditDocument({id:'invariant-edit',width:100,height:80,layers:[layer,other]});f.docs.openDocument(doc);
  const tool=f.registry.get('edit_set_layer_opacity')!,execute=tool.execute.bind(tool);
  tool.execute=async(context,args,id)=>{const result=await execute(context,args,id);await execute(context,{...args,layerId:'neighbor'},id+'-bad-neighbor');return result;};
  const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['paint'],regions:[{x:0,y:0,width:40,height:40}]});
  expect(run.status).toBe('failed');expect(run.error).toContain('unrelated_content_changed');
  expect(f.docs.getEditDocument(doc.id)!.layers.map(l=>l.opacity)).toEqual([1,1]);
});
it.each(['root','group child'] as const)('rolls back an unexpected %s insertion from a scoped canonical write',async(position)=>{
  const f=fixture([{role:'assistant',toolCalls:[{id:'opacity',name:'edit_set_layer_opacity',arguments:{layerId:'paint',opacity:0.5}}]}]);
  const paint=createPaintLayer({id:'paint',width:20,height:20,rasterAssetId:'before'});
  const group=createGroupLayer({id:'group',children:[createPaintLayer({id:'neighbor',width:20,height:20,rasterAssetId:'neighbor-before'})]});
  const doc=createEditDocument({id:`invariant-${position}`,width:100,height:80,layers:[paint,group]});doc.selectedLayerId='paint';f.docs.openDocument(doc);
  const tool=f.registry.get('edit_set_layer_opacity')!,execute=tool.execute.bind(tool);
  class UnexpectedInsertion extends BaseCommand {
    private before:Layer[]=[];
    constructor(){super('Fault injection',doc.id);}
    execute(){const current=f.docs.getEditDocument(doc.id)!;this.before=current.layers;
      const inserted=createPaintLayer({id:'unexpected',width:20,height:20,rasterAssetId:'unexpected-asset'});
      const layers=position==='root'?[...current.layers,inserted]:current.layers.map(layer=>layer.id==='group'&&layer.type==='group'?{...layer,children:[...layer.children,inserted]}:layer);
      f.docs.updateDocument({...current,layers},this.name);
    }
    undo(){const current=f.docs.getEditDocument(doc.id)!;f.docs.updateDocument({...current,layers:this.before},`Undo ${this.name}`);}
  }
  tool.execute=async(context,args,id)=>{const result=await execute(context,args,id);await context.commandBus.execute(new UnexpectedInsertion());return result;};
  const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['paint'],regions:[{x:0,y:0,width:40,height:40}]});
  expect(run.status).toBe('failed');expect(run.error).toContain('unrelated_content_changed');
  expect(f.docs.getEditDocument(doc.id)!.layers).toEqual(doc.layers);expect(f.bus.getHistory()).toHaveLength(0);
});
it('keeps a canonical generated patch at its reported root position',async()=>{
  const f=fixture([{role:'assistant',toolCalls:[{id:'patch',name:'edit_generative_fill',arguments:{prompt:'repair texture'}}]},{role:'assistant',content:'Done'}]);
  const paint=createPaintLayer({id:'paint',width:100,height:80,rasterAssetId:'before'});
  const doc=createEditDocument({id:'patch-edit',width:100,height:80,layers:[paint]});doc.selectedLayerId='paint';
  doc.selection={id:'selection',documentId:doc.id,width:100,height:80,assetId:'selection-asset',bounds:{x:20,y:20,width:10,height:10},feather:0,inverted:false,active:true};f.docs.openDocument(doc);
  const patch={...paint,id:'reported-patch',type:'generated-patch',sourceAssetId:'generated-source',maskAssetId:'generated-mask',bounds:{x:20,y:20,width:10,height:10},generationMetadata:{provider:'test',model:'test',sourceDocumentId:doc.id,sourceLayerId:'paint',timestamp:1}} as GeneratedPatchLayer;
  f.registry.get('edit_generative_fill')!.execute=async(context,_args,id)=>{
    const command=new AddGeneratedPatchLayerCommand(doc.id,patch,context.documentManager);await context.commandBus.execute(command);
    return {success:true,toolCallId:id,commandId:command.id,changedDocumentId:doc.id,after:{patchLayerId:patch.id,bounds:patch.bounds},renderRequired:true};
  };
  const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['paint'],regions:[{x:15,y:15,width:20,height:20}]});
  expect(run.status).toBe('partial');expect(run.stopReason).toBe('verification_pending');
  expect(f.docs.getEditDocument(doc.id)!.layers.map(l=>l.id)).toEqual(['paint','reported-patch']);expect(f.bus.getHistory()).toHaveLength(1);
});
it('stops an unmodeled local layer-tree move before writing',async()=>{
  const f=fixture([{role:'assistant',toolCalls:[{id:'move',name:'edit_move_to_group',arguments:{layerId:'paint',targetGroupId:'group'}}]}]);
  const paint=createPaintLayer({id:'paint',width:20,height:20,rasterAssetId:'before'}),group=createGroupLayer({id:'group'});
  const doc=createEditDocument({id:'local-move',width:100,height:80,layers:[paint,group]});doc.selectedLayerId='paint';f.docs.openDocument(doc);
  const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['paint','group'],regions:[{x:0,y:0,width:40,height:40}]});
  expect(run.status).toBe('partial');expect(run.stopReason).toBe('local_scope_unknown');
  expect(f.docs.getEditDocument(doc.id)!.layers).toEqual(doc.layers);expect(f.bus.getHistory()).toHaveLength(0);
});
it('blocks partial ROI brush replacement of an existing nonblank target and preserves source pixels',async()=>{
  const source=createCanvas(100,80);source.getContext('2d').fillStyle='#00ff00';source.getContext('2d').fillRect(0,0,100,80);
  const handle=await defaultAssetManager.registerBlob(new Blob([new Uint8Array(source.toBuffer('image/png'))],{type:'image/png'}),'image','nonblank',{width:100,height:80});
  const f=fixture([{role:'assistant',toolCalls:[{id:'stroke',name:'edit_brush_stroke',arguments:{layerId:'paint',points:[{x:25,y:25}],settings:{size:4,color:'#ff0000'}}}]}]);
  const doc=createEditDocument({id:'replacement-edit',width:100,height:80,layers:[createPaintLayer({id:'paint',width:100,height:80,rasterAssetId:handle.id})]});f.docs.openDocument(doc);
  try {
    const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['paint'],regions:[{x:20,y:20,width:20,height:20}]});
    expect(run.stopReason).toBe('roi_mismatch');expect(f.bus.getHistory()).toHaveLength(0);
    const actual=f.docs.getEditDocument(doc.id)!.layers[0];expect('rasterAssetId' in actual&&actual.rasterAssetId).toBe(handle.id);
    const image=await loadImage(Buffer.from(await (await defaultAssetManager.getBlob(handle.id))!.arrayBuffer())),pixel=createCanvas(1,1);pixel.getContext('2d').drawImage(image,0,0,1,1);
    expect([...pixel.getContext('2d').getImageData(0,0,1,1).data]).toEqual([0,255,0,255]);
  } finally {defaultAssetManager.releaseAsset(handle.id);}
});
it('allows a fully observed canonical raster replacement while an independent pending judgement stays pending',async()=>{
  vi.stubGlobal('document',{createElement:()=>{const canvas=createCanvas(100,80);Object.assign(canvas,{toBlob:(callback:(blob:Blob)=>void)=>callback(new Blob([new Uint8Array(canvas.toBuffer('image/png'))],{type:'image/png'}))});return canvas;}});
  const f=fixture([{role:'assistant',toolCalls:[{id:'stroke',name:'brush_stroke',arguments:{layerId:'paint',points:[{x:25,y:25}],settings:{size:4,color:'#ff0000'}}}]}]);
  const doc=createEditDocument({id:'full-replacement-edit',width:100,height:80,layers:[createPaintLayer({id:'paint',width:100,height:80,rasterAssetId:'before'})]});f.docs.openDocument(doc);
  const chat=f.provider.chat;f.provider.chat=(messages,tools,onDelta,signal)=>messages[0].content?.startsWith('Independent result review')?Promise.resolve({role:'assistant',content:'{"verdict":"pending","pending":["Replacement pixels need aesthetic assessment"]}'}):chat(messages,tools,onDelta,signal);
  const run=await f.runtime.run('Retouch local edge',{taskKind:'local-detail',targetIds:['paint'],regions:[{x:0,y:0,width:100,height:80}]});
  expect(run.status).toBe('partial');expect(run.verification?.pending).toContain('Replacement pixels need aesthetic assessment');expect(run.verification?.verified.join(' ')).toContain('actual stroke asset');
  expect(f.bus.getHistory()).toHaveLength(1);expect(f.runtime.undoRun(run.runId)).toBe(true);
  const id=(f.bus.getHistory()[0]?.command as unknown as {finalAssetId?:string})?.finalAssetId;if(id)defaultAssetManager.releaseAsset(id);
});
it('rejects invalid ROI bounds before edits and preserves deterministic uncovered status',async()=>{
  const f=fixture([edit]);
  const run=await f.runtime.run('Fix local detail',{taskKind:'local-detail',regions:[{x:-1,y:0,width:10,height:10}]});
  expect(run.status).toBe('partial');expect(run.stopReason).toBe('invalid_observation');expect(f.bus.getHistory()).toHaveLength(0);
});
it('does not report aesthetic pass when independent reviewer refuses the requested verdict',async()=>{
  const f=fixture([edit,{role:'assistant',content:'Done'}]),planner=f.provider.chat;
  f.provider.chat=async(messages,tools,onDelta,signal)=>messages[0].content?.startsWith('Independent result review')?{role:'assistant',content:'I cannot verify these pixels'}:planner(messages,tools,onDelta,signal);
  const run=await f.runtime.run('Make photo brighter');
  expect(run.status).toBe('partial');expect(run.verification?.aesthetic).toBe('pending');expect(run.verification?.pending.join(' ')).toContain('supported verdict');
});
it('counts unchanged observation evidence as no progress even with a syntactically different call',async()=>{
  const f=fixture([]);
  f.provider.chat=async(messages:AgentMessage[])=>{
    f.seen.push(structuredClone(messages));
    return {role:'assistant',toolCalls:[{id:String(f.seen.length),name:'inspect_document',arguments:{documentId:f.doc.id,...(f.seen.length===2?{request:{maxDimension:1024}}:{})}}]};
  };
  const run=await f.runtime.run('Read overview',{taskKind:'precise'});
  expect(run.stopReason).toBe('no_progress');expect(run.actions).toHaveLength(2);
  expect(run.budget?.images).toBe(1);
  expect(f.seen).toHaveLength(2);
});
it.each(['missing','locked','wrong-selection'] as const)('keeps precise %s layer mutations constrained by canonical state and selection',async(kind)=>{
  const f=fixture([]),layer=createImageLayer({id:'target',name:'target',sourceAssetId:'source',naturalWidth:100,naturalHeight:80});
  if(kind==='locked')layer.locked=true;
  const doc=createEditDocument({id:'edit',layers:[layer]});f.docs.openDocument(doc);
  f.provider.chat=async(messages:AgentMessage[])=>{
    f.seen.push(structuredClone(messages));
    return f.seen.length===1?{role:'assistant',toolCalls:[{id:'write',name:'edit_set_layer_opacity',arguments:{layerId:kind==='missing'?'missing':layer.id,opacity:0.5,documentId:doc.id}}]}:{role:'assistant',content:'Done'};
  };
  const run=await f.runtime.run('Set opacity to 50%',{taskKind:'precise',...(kind==='wrong-selection'?{targetIds:['other']}: {})});
  expect(run.status).toBe('partial');expect(f.docs.getEditDocument(doc.id)!.layers[0].opacity).toBe(1);expect(f.bus.getHistory()).toHaveLength(0);
  if(kind==='missing')expect(run.stopReason).toBe('invalid_target_id');
  if(kind==='wrong-selection')expect(run.stopReason).toBe('target_mismatch');
  if(kind==='locked')expect(run.actions[0].result?.error?.message).toMatch(/locked|锁定/i);
});
it('requires ask-mode image consent for manually requested precise observations',async()=>{
  const f=fixture([{role:'assistant',toolCalls:[{id:'read',name:'get_preview',arguments:{}}]}]);
  f.router.setPrivacyMode('ask');f.router.setRemoteConfirmationHandler(()=>false);
  const run=await f.runtime.run('Read preview',{taskKind:'precise'});
  expect(run.stopReason).toBe('privacy_restriction');expect(f.seen).toHaveLength(1);
});
it('reviews a real layout mutation after layer discovery with the complete phase trace',async()=>{
  const f=fixture([]),layer=createImageLayer({id:'layout-layer',name:'layout',sourceAssetId:'source',naturalWidth:100,naturalHeight:80});
  const doc=createEditDocument({id:'layout-doc',width:100,height:80,layers:[layer]});f.docs.openDocument(doc);
  const turns:AgentMessage[]=[{role:'assistant',toolCalls:[{id:'layers',name:'get_edit_document',arguments:{}}]},{role:'assistant',toolCalls:[{id:'opacity',name:'edit_set_layer_opacity',arguments:{documentId:doc.id,layerId:layer.id,opacity:0.5}}]},{role:'assistant',content:'Done'}];
  const planner=f.provider.chat;
  f.provider.chat=async(messages,tools,onDelta,signal)=>{
    if(messages[0].content?.startsWith('Independent result review'))return planner(messages,tools,onDelta,signal);
    f.seen.push(structuredClone(messages));return turns.shift()!;
  };
  const run=await f.runtime.run('Balance the composition',{taskKind:'layout'});
  expect(run.status).toBe('completed');expect(run.actions.map(a=>a.toolName)).toEqual(['get_edit_document','edit_set_layer_opacity']);
  expect(run.journal?.map(j=>j.phase)).toEqual(['observation','plan','tools','rendered_result','rendered_result','review']);
  expect(run.budget).toMatchObject({modelSteps:4,toolCalls:5,images:2});
  expect(f.reviews[0].flatMap(m=>m.images??[])).toHaveLength(2);
});
