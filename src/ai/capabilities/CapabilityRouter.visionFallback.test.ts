import { afterEach, expect, it, vi } from 'vitest';
import { CapabilityRouter } from './CapabilityRouter';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { nativeLocalAgentRunner } from '../providers/LocalAgentProvider';
import { OpenAIProvider } from '../providers/OpenAIProvider';
import type { SecureVault } from '../security/SecureVault';
afterEach(()=>vi.restoreAllMocks());
function fixture(){
 const chat=vi.fn(async()=>({role:'assistant',content:'seen'}));
 const registry={getActiveConfig:()=>({id:'local'}),getConfig:(id:string)=>({id,name:id,model:'test'}),getProvider:(id:string)=>({capabilities:{vision:id==='remote'},chat})} as unknown as ProviderRegistry;
 const router=new CapabilityRouter(registry);router.saveStackConfig({agentProviderId:'local',visionProviderId:'local',visionFallbackId:'remote',segmentationProviderId:'s',imageEditProviderId:'e'});return {router,chat};
}
it('uses configured vision fallback through the existing upload consent and notice gates',async()=>{
 const {router,chat}=fixture();router.setPrivacyMode('ask');const consent=vi.fn(async()=>true),notice=vi.fn();router.setRemoteConfirmationHandler(consent);router.subscribeUploadNotice(notice);
 expect(await router.resolveVision()!.analyzeImage('data:image/png;base64,aGVsbG8=','inspect')).toBe('seen');
 expect(consent).toHaveBeenCalledOnce();expect(chat).toHaveBeenCalledOnce();expect(notice.mock.calls[0][0].providerId).toBe('remote');
});
it('never mode and denied consent prevent fallback uploads',async()=>{
 const {router,chat}=fixture();router.setPrivacyMode('never');expect(()=>router.resolveVision()).toThrow(/PRIVACY/);expect(chat).not.toHaveBeenCalled();
 router.setPrivacyMode('ask');router.setRemoteConfirmationHandler(async()=>false);
 await expect(router.resolveVision()!.analyzeImage('data:image/png;base64,aGVsbG8=','inspect')).rejects.toThrow(/PRIVACY/);expect(chat).not.toHaveBeenCalled();
});
it('reports unsupported vision without a user configured fallback',()=>{
 const {router}=fixture();router.setPrivacyMode('allow');router.saveStackConfig({...router.getStackConfig(),visionFallbackId:undefined});expect(()=>router.resolveVision()).toThrow(/unsupported/i);
});
function realRegistryFixture(primary='codex-desktop',fallback='openai',visionModel?:string){
 const vault={getProviderSecret:vi.fn(async()=>{throw new Error('Credentials must not be read');})} as unknown as SecureVault;
 const registry=new ProviderRegistry(vault);
 registry.saveConfig({...registry.getConfig(primary)!,visionModel});
 const router=new CapabilityRouter(registry);router.setPrivacyMode('allow');router.saveStackConfig({agentProviderId:primary,visionProviderId:primary,visionFallbackId:fallback,segmentationProviderId:'s',imageEditProviderId:'e'});
 const nativeRun=vi.spyOn(nativeLocalAgentRunner,'run').mockResolvedValue('{"content":"native-seen","toolCalls":[]}');
 const probe=vi.spyOn(nativeLocalAgentRunner,'probe').mockImplementation(async agent=>({available:agent==='codex',detail:'installed help only',visionSupport:agent==='codex'}));
 const remoteChat=vi.spyOn(OpenAIProvider.prototype,'chat').mockResolvedValue({role:'assistant',content:'remote-seen'});
 const notice=vi.fn();router.subscribeUploadNotice(notice);
 return {router,registry,probe,nativeRun,remoteChat,notice,vault};
}
it.each([undefined,'first-use-native-vision-model'])('prepares a fresh native primary (%s) on first use instead of choosing the configured remote fallback',async(visionModel)=>{
 const {router,nativeRun,remoteChat,notice,vault}=realRegistryFixture('codex-desktop','openai',visionModel);
 expect(await router.resolveVision()!.analyzeImage('data:image/png;base64,aGVsbG8=','look')).toBe('native-seen');
 expect(nativeRun).toHaveBeenCalledOnce();expect(remoteChat).not.toHaveBeenCalled();expect(notice.mock.calls[0][0].providerId).toBe('codex-desktop');expect(vault.getProviderSecret).not.toHaveBeenCalled();
});
it('selects configured remote fallback only after negative native interface preparation and consent',async()=>{
 const {router,probe,nativeRun,remoteChat,notice}=realRegistryFixture();probe.mockResolvedValue({available:false,detail:'absent',visionSupport:false});
 router.setPrivacyMode('ask');const consent=vi.fn(async()=>true);router.setRemoteConfirmationHandler(consent);
 expect(await router.resolveVision()!.analyzeImage('data:image/png;base64,aGVsbG8=','look')).toBe('remote-seen');
 expect(consent).toHaveBeenCalledOnce();expect(nativeRun).not.toHaveBeenCalled();expect(remoteChat).toHaveBeenCalledOnce();expect(notice.mock.calls[0][0].providerId).toBe('openai');
});
it('prepares fresh model-specific native primary despite a prior successful cached probe',async()=>{
 const {router,registry,nativeRun,remoteChat,notice}=realRegistryFixture('codex-desktop','openai','configured-native-vision-model');
 await registry.getProvider('codex-desktop').testConnection();
 expect(registry.getProviderForModel('codex-desktop','configured-native-vision-model').capabilities.vision).toBe(false);
 expect(await router.resolveVision()!.analyzeImage('data:image/png;base64,aGVsbG8=','look')).toBe('native-seen');
 expect(nativeRun).toHaveBeenCalledOnce();expect(remoteChat).not.toHaveBeenCalled();expect(notice.mock.calls[0][0].providerId).toBe('codex-desktop');
});
it('prepares an initially unprobed native fallback with visionModel before rejecting its capability',async()=>{
 const {router,registry,nativeRun,remoteChat,notice}=realRegistryFixture('claude-desktop','codex-desktop');
 registry.saveConfig({...registry.getConfig('codex-desktop')!,visionModel:'fallback-native-vision-model'});
 expect(await router.resolveVision()!.analyzeImage('data:image/png;base64,aGVsbG8=','look')).toBe('native-seen');
 expect(nativeRun).toHaveBeenCalledOnce();expect(remoteChat).not.toHaveBeenCalled();expect(notice.mock.calls[0][0].providerId).toBe('codex-desktop');
});
it('rechecks native support on each request and respects consent denial and never before upload',async()=>{
 const {router,probe,nativeRun,remoteChat,notice}=realRegistryFixture();
 expect(await router.resolveVision()!.analyzeImage('data:image/png;base64,aGVsbG8=','first')).toBe('native-seen');
 probe.mockResolvedValue({available:false,detail:'removed',visionSupport:false});router.setPrivacyMode('ask');router.setRemoteConfirmationHandler(async()=>false);
 await expect(router.resolveVision()!.analyzeImage('data:image/png;base64,aGVsbG8=','second')).rejects.toThrow(/PRIVACY/);
 expect(nativeRun).toHaveBeenCalledOnce();expect(remoteChat).not.toHaveBeenCalled();expect(notice).toHaveBeenCalledOnce();
 const probes=probe.mock.calls.length;router.setPrivacyMode('never');expect(()=>router.resolveVision()).toThrow(/PRIVACY/);expect(probe.mock.calls.length).toBe(probes);
});
