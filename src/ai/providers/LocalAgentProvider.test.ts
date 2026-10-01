import { describe, expect, it, vi } from 'vitest';
import { LocalAgentProvider, type LocalAgentRunner } from './LocalAgentProvider';
import type { ProviderConfig, CanonicalToolSchema } from '../types';
import protocolFixture from './localAgentProtocol.fixture.json';
import { ToolRegistry } from '../tools/ToolRegistry';
import referenceFixture from './localAgentReference.fixture.json';
import { prepareCreativeReferences } from '../harness/CreativeBrief';
import { AssetManager } from '../../assets/AssetManager';
import { DocumentManager } from '../../document/DocumentManager';
import { createEditDocument, createImageLayer } from '../../document/EditDocument';
import { DocumentObservationService } from '../vision/DocumentObservationService';
import { CapabilityRouter } from '../capabilities/CapabilityRouter';
import { ProviderRegistry } from './ProviderRegistry';

const config: ProviderConfig = {
  id: 'codex-desktop', name: 'Codex', type: 'agent-cli', localAgent: 'codex',
  baseUrl: '', model: 'default', enabled: true, isDefault: false,
};
const tool: CanonicalToolSchema = {
  name: 'develop_set_exposure', description: 'Set exposure', workspace: 'develop',
  category: 'develop', riskLevel: 'normal',
  parameters: { type: 'object', properties: { value: { type: 'number', description: 'EV' } }, required: ['value'] },
};

describe('local agent provider', () => {
  it('serializes an actually prepared document reference as the strict native attachment fixture', async () => {
    const assets = new AssetManager(), documents = new DocumentManager();
    const asset = await assets.registerBlob(new Blob(['source'], { type: 'image/png' }), 'image', 'source');
    const document = createEditDocument({ width: 100, height: 80, layers: [createImageLayer({ name: 'Reference', sourceAssetId: asset.id, naturalWidth: 100, naturalHeight: 80 })] });
    documents.openDocument(document);
    const observer = new DocumentObservationService({ documents, assets, renderer: { async render(_document, geometry) {
      return { data: btoa('actual region'), mimeType: geometry.mimeType, approximate: false };
    } } });
    const router = new CapabilityRouter(new ProviderRegistry()); router.setPrivacyMode('allow');
    let attachments: unknown, transcript = '';
    const runner: LocalAgentRunner = { probe: async () => ({ available: true, detail: '', visionSupport: true }), cancel: async () => undefined,
      run: async (_agent, prompt, _id, _timeout, images) => { attachments = images; transcript = prompt; return '{"content":"ok","toolCalls":[]}'; } };
    try {
      const prepared = await prepareCreativeReferences([{ assetId: asset.id, source: 'document', region: { x: 5, y: 6, width: 20, height: 15 } }], assets, router, config.id, document, observer);
      expect(prepared[0].evidence?.region).toEqual({ x: 5, y: 6, width: 20, height: 15 });
      await new LocalAgentProvider(config, runner).chat([{ role: 'user', content: JSON.stringify({ evidence: prepared[0].evidence }), images: prepared }], []);
      expect(attachments).toEqual([{ ...referenceFixture.nativeImages[0], observationId: prepared[0].observationId }]);
      expect(transcript).toContain('pixelToDocument'); expect(transcript).not.toContain(prepared[0].data);
    } finally { observer.dispose(); assets.dispose(); documents.closeAll(); }
  });
  it('accepts the same object arguments produced by native JSON-string normalization',async()=>{
    const runner:LocalAgentRunner={probe:async()=>({available:true,detail:''}),run:async()=>JSON.stringify(protocolFixture.normalized),cancel:async()=>undefined};
    const result=await new LocalAgentProvider(config,runner).chat([{role:'user',content:'inspect'}],[new ToolRegistry().get('inspect_region')!.schema]);
    expect(result.toolCalls![0].arguments).toEqual(protocolFixture.normalized.toolCalls[0].arguments);
  });
  it('routes a structured tool request through the canonical tool name and arguments', async () => {
    const runner: LocalAgentRunner = {
      probe: vi.fn(async () => ({ available: true, detail: 'ready' })),
      run: vi.fn(async () => '{"content":"调整曝光","toolCalls":[{"name":"develop_set_exposure","arguments":{"value":0.5}}]}'),
      cancel: vi.fn(async () => undefined),
    };
    const provider = new LocalAgentProvider(config, runner);
    const result = await provider.chat([{ role: 'user', content: '提亮半档' }], [tool]);
    expect(result.toolCalls).toEqual([{ id: expect.any(String), name: 'develop_set_exposure', arguments: { value: 0.5 } }]);
    expect(vi.mocked(runner.run).mock.calls[0][1]).toContain('develop_set_exposure');
  });

  it('rejects unknown tool names instead of executing them', async () => {
    const runner: LocalAgentRunner = { probe: async () => ({ available: true, detail: '' }), run: async () => '{"toolCalls":[{"name":"shell_exec","arguments":{"cmd":"x"}}]}', cancel: async () => undefined };
    await expect(new LocalAgentProvider(config, runner).chat([{ role: 'user', content: 'x' }], [tool])).rejects.toThrow(/不在 Lumiseq/);
  });

  it('reports unsupported image CLI without dropping images or silently uploading', async () => {
    const runner: LocalAgentRunner = { probe: async () => ({ available: true, detail: '' }), run: vi.fn(async () => '{"content":"ok","toolCalls":[]}'), cancel: async () => undefined };
    await expect(new LocalAgentProvider(config, runner).chat([{ role: 'user', content: 'look', image: { mimeType: 'image/png', data: 'aGVsbG8=' } }], [])).rejects.toThrow(/image.*unsupported/i);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('passes actual images separately to the native runner with ordinal evidence references',async()=>{
    const images=[{mimeType:'image/png',data:'aGVsbG8=',observationId:'obs1'}];
    const runner:LocalAgentRunner={probe:async()=>({available:true,detail:'ready',visionSupport:true}),run:vi.fn(async()=>'{"content":"ok","toolCalls":[]}'),cancel:async()=>undefined};
    await new LocalAgentProvider(config,runner).chat([{role:'tool',toolCallId:'a',content:JSON.stringify({evidence:{observationId:'obs1'},preview:'data:image/png;base64,aGVsbG8='}),images}],[]);
    const call=vi.mocked(runner.run).mock.calls[0];expect(call[4]).toEqual(images);expect(call[1]).not.toContain('aGVsbG8=');expect(call[1]).toContain('obs1');
  });
  it('rejects malformed schema arguments after the native normalization boundary',async()=>{
    for(const args of [{value:'bad'},'{"value":1}',{unknown:1}]){
      const runner:LocalAgentRunner={probe:async()=>({available:true,detail:''}),run:async()=>JSON.stringify({content:'',toolCalls:[{name:tool.name,arguments:args}]}),cancel:async()=>undefined};
      await expect(new LocalAgentProvider(config,runner).chat([{role:'user',content:'x'}],[tool])).rejects.toThrow(/参数/);
    }
  });

  it('cancels the native process when its AbortSignal fires', async () => {
    const controller = new AbortController();
    const runner: LocalAgentRunner = { probe: async () => ({ available: true, detail: '' }), run: () => new Promise(() => undefined), cancel: vi.fn(async () => undefined) };
    const pending = new LocalAgentProvider(config, runner).chat([{ role: 'user', content: 'x' }], [], undefined, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(runner.cancel).toHaveBeenCalledOnce();
  });
});
