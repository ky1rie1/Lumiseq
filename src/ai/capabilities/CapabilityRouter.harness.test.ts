import { expect, it } from 'vitest';
import { CapabilityRouter } from './CapabilityRouter';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import type { IAIProvider } from '../providers/IAIProvider';

it('resolves a configured HTTP vision model even when the default text model lacks vision',async()=>{
  const registry=new ProviderRegistry();
  const cfg=registry.getActiveConfig();registry.saveConfig({...cfg,visionModel:'vision-only'});
  const received:string[]=[];
  registry.getProvider=()=>({capabilities:{vision:false}} as IAIProvider);
  registry.getProviderForModel=(_id,model)=>({capabilities:{vision:true},chat:async()=>{received.push(model);return {role:'assistant',content:'pixels inspected'};}} as unknown as IAIProvider);
  const router=new CapabilityRouter(registry);router.setPrivacyMode('allow');
  expect(await router.resolveVision()!.analyzeImage('data:image/png;base64,aGVsbG8=','look')).toBe('pixels inspected');
  expect(received).toEqual(['vision-only']);
});
