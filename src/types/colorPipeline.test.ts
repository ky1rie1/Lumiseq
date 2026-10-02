import { expect, it } from 'vitest';
import { createDevelopDocument } from '../document/DevelopDocument';
import { createColorPipelineState } from './colorPipeline';
it('describes a calibrated float working source without display encoding',()=>{
 expect(createColorPipelineState({isRaw:true,isWorkingLinear:true})).toMatchObject({
  colorState:'working-linear',whiteBalanceApplied:true,cameraMatrixApplied:true,
  transferFunctionApplied:false,toneMappingApplied:false,colorSpace:'linear-srgb'});
});
it('ready native RAW documents describe their DOM preview rather than claiming sensor RGB',()=>{
 const doc=createDevelopDocument({sourceUri:'sample.raw',fileName:'sample.raw',isRaw:true,rawEngineAttached:true,rawState:'ready',sourceAssetId:'decoded-preview'});
 expect(doc.pipelineState?.colorState).toBe('display-encoded');expect(doc.pipelineState?.whiteBalanceApplied).toBe(true);
 expect(doc.pipelineState?.transferFunctionApplied).toBe(true);
 expect(doc.rawState).toBe('ready');expect(doc.rawProgress).toBe(100);
});
it('starts an unopened RAW without pretending that a display preview exists',()=>{
 const doc=createDevelopDocument({sourceUri:'sample.raw',fileName:'sample.raw',isRaw:true});
 expect(doc.pipelineState?.colorState).toBe('sensor-mosaic');expect(doc.rawState).toBe('unloaded');
});
it('keeps an explicitly requested sensor buffer independent of the browser source contract',()=>{
 expect(createColorPipelineState({isRaw:true,isSensorLinear:true})).toMatchObject({colorState:'sensor-linear-rgb',whiteBalanceApplied:false,transferFunctionApplied:false,colorSpace:'camera'});
});
it('does not infer a decoded linear working buffer merely from a RAW file extension',()=>{
 expect(createColorPipelineState({isRaw:true})).toMatchObject({colorState:'sensor-mosaic',whiteBalanceApplied:false,transferFunctionApplied:false});
});
