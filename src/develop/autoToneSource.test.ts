import { expect, it, vi } from 'vitest';
import { createDevelopDocument } from '../document/DevelopDocument';
import { readFloatAutoToneSource } from './autoToneSource';
import type { IPlatformBridge } from '../platform';
import type { IAssetManager } from '../types/asset';

it('reads native float samples and tail positions without an 8-bit preview',async()=>{
 const doc=createDevelopDocument({sourceUri:'private.arw',fileName:'x',isRaw:true});doc.nativeAssetId='native';doc.rawState='ready';
 const read=vi.fn(async()=>({samples:[[-.1,.3,1.5]],positions:[[.25,.4]],tailSamples:[[2,1,.1]],tailPositions:[[.1,.2]],
  sourcePixels:50,peak:2,headroomPixels:2,negativePixels:1,sampleFormat:'float32'}));
 const source=await readFloatAutoToneSource(doc,{} as IAssetManager,{getRawToneSamples:read} as unknown as IPlatformBridge);
 expect(read).toHaveBeenCalledWith('native');expect(source.samples[0]).toEqual([-.1,.3,1.5]);expect(source.tailSamples[0][0]).toBe(2);
 expect(source.precision).toBe('float32');
});
it('rejects missing decoding, malformed positions, nonfinite source and excessive sample counts',async()=>{
 const doc=createDevelopDocument({sourceUri:'x.arw',fileName:'x',isRaw:true});doc.nativeAssetId='a';
 await expect(readFloatAutoToneSource(doc,{} as IAssetManager,{} as IPlatformBridge)).rejects.toThrow(/decoded/i);
 doc.rawState='ready';
 for(const samples of [{samples:[[NaN,0,0]],positions:[[.2,.2]]},{samples:[[1,1,1]],positions:[[2,.2]]},
  {samples:Array.from({length:65537},()=>[0,0,0]),positions:[]}]){
  const bridge={getRawToneSamples:async()=>({...samples,tailSamples:[],tailPositions:[],sourcePixels:100,peak:2,headroomPixels:0,negativePixels:0,sampleFormat:'float32'})};
  await expect(readFloatAutoToneSource(doc,{} as IAssetManager,bridge as unknown as IPlatformBridge)).rejects.toThrow(/invalid|limit/i);
 }
});
