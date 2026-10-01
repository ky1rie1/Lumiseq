import { describe, it, expect } from 'vitest';
import { blendDevelopPreset, DevelopLookService, createCustomDevelopPreset, saveCustomDevelopPresets, loadCustomDevelopPresets } from './DevelopLookService';
import { createDevelopDocument } from '../document/DevelopDocument';
import { DocumentManager } from '../document/DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { AssetManager } from '../assets/AssetManager';
import { DevelopProjectSerializer } from '../project/DevelopProjectSerializer';
describe('develop looks', () => {
 it('blends strength endpoints and preserves masks and camera white balance', () => {
  const settings = createDevelopDocument({sourceUri:'photo.jpg',fileName:'photo.jpg',isRaw:false}).settings;
  settings.whiteBalance.cameraMultipliers = [2,1,1.4,1];
  settings.masks = [{ id:'m', name:'local', maskAssetId:'a', kind:'linear', geometry:{}, inverted:false, opacity:1 }];
  const look = { id:'test', name:'Test', settings:{ exposure:2, contrast:20, whiteBalance:{mode:'custom' as const,temperature:7000}, curves:{ ...settings.curves, rgb:[{x:0,y:0},{x:0.5,y:0.8},{x:1,y:1}] } } };
  expect(blendDevelopPreset(settings,look,0)).toEqual(settings);
  const full = blendDevelopPreset(settings,look,1);
  expect(full.exposure).toBe(2); expect(full.masks).toEqual(settings.masks); expect(full.whiteBalance).toEqual(settings.whiteBalance);
  expect(blendDevelopPreset(settings,look,0.5).curves.rgb[1].y).toBeCloseTo(0.65);
 });
 it('applies and restores one undoable settings step and persists named snapshots', async () => {
  const docs = new DocumentManager(); const history = new CommandBus(docs); const service = new DevelopLookService(docs,history);
  const doc = createDevelopDocument({sourceUri:'C:\\photo.cr3',fileName:'photo.cr3',isRaw:true}); docs.openDocument(doc);
  const snapshot = service.saveSnapshot(doc.id,'Before');
  service.applyPreset(doc.id,{id:'x',name:'Bright',settings:{exposure:2}},1);
  expect(docs.getDevelopDocument(doc.id)?.settings.exposure).toBe(2);
  history.undo(); expect(docs.getDevelopDocument(doc.id)?.settings.exposure).toBe(0);
  history.redo(); service.restoreSnapshot(doc.id,snapshot.id); expect(docs.getDevelopDocument(doc.id)?.settings.exposure).toBe(0);
  history.undo(); expect(docs.getDevelopDocument(doc.id)?.settings.exposure).toBe(2);
  const serializer = new DevelopProjectSerializer(); const json = await serializer.serialize(docs.getDevelopDocument(doc.id)!,new AssetManager());
  const restored = await serializer.hydrate(json,new AssetManager(),{getRawMetadata:async()=>({width:10,height:10})} as any);
  expect(restored.settingsSnapshots?.[0].name).toBe('Before'); expect(restored.settingsSnapshots?.[0].settings.exposure).toBe(0);
 });
});


it('persists custom globals without local masks or another cameras multipliers', () => {
 const settings = createDevelopDocument({sourceUri:'photo.jpg',fileName:'photo.jpg',isRaw:false}).settings;
 settings.whiteBalance.cameraMultipliers=[2,1,1.5,1]; settings.exposure=1.5;
 const values=new Map<string,string>(); const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 const preset=createCustomDevelopPreset('Personal',settings);saveCustomDevelopPresets([preset],storage);
 const loaded=loadCustomDevelopPresets(storage);expect(loaded[0].settings.exposure).toBe(1.5);expect(loaded[0].settings.masks).toBeUndefined();expect(loaded[0].settings.whiteBalance?.cameraMultipliers).toBeUndefined();
});
it('rejects invalid preset numbers and preserves camera multipliers with WB opt-in', () => {
 const settings=createDevelopDocument({sourceUri:'photo.jpg',fileName:'photo.jpg',isRaw:false}).settings;
 settings.whiteBalance={mode:'as-shot',temperature:5000,tint:0,cameraMultipliers:[2,1,1.5,1]};
 expect(()=>blendDevelopPreset(settings,{id:'bad',name:'Bad',settings:{exposure:100}},1)).toThrow();
 const result=blendDevelopPreset(settings,{id:'wb',name:'WB',settings:{whiteBalance:{mode:'custom',temperature:7000,cameraMultipliers:[9,9,9,9]}}},0.5,true);
 expect(result.whiteBalance.temperature).toBe(6000);expect(result.whiteBalance.cameraMultipliers).toEqual(settings.whiteBalance.cameraMultipliers);
});

it('rebuilds snapshot-only masks and restores them after reopening', async () => {
 const assets=new AssetManager();const docs=new DocumentManager();const history=new CommandBus(docs);const service=new DevelopLookService(docs,history);
 const doc=createDevelopDocument({sourceUri:'C:\\photo.cr3',fileName:'photo.cr3',isRaw:true});
 const mask={id:'local',name:'Gradient',maskAssetId:(await assets.registerMask(new Uint8ClampedArray(512*512),512,512,'Gradient')).id,kind:'linear' as const,geometry:{start:{x:0,y:0},end:{x:1,y:1}},inverted:false,opacity:1,exposure:1};
 doc.settings.masks=[mask];docs.openDocument(doc);const snapshot=service.saveSnapshot(doc.id,'Masked');
 const current=docs.getDevelopDocument(doc.id)!;docs.updateDocument({...current,settings:{...current.settings,masks:[]}},'Remove');
 const serializer=new DevelopProjectSerializer();const json=await serializer.serialize(docs.getDevelopDocument(doc.id)!,assets);expect(json).not.toContain(mask.maskAssetId);
 const reopenedAssets=new AssetManager();const reopened=await serializer.hydrate(json,reopenedAssets,{getRawMetadata:async()=>({width:10,height:10})} as any);
 const snapshotMask=reopened.settingsSnapshots![0].settings.masks[0];expect(reopenedAssets.hasAsset(snapshotMask.maskAssetId)).toBe(true);expect(snapshotMask.maskAssetId).not.toBe(mask.maskAssetId);
 docs.closeDocument(doc.id);docs.openDocument(reopened);service.restoreSnapshot(reopened.id,snapshot.id);expect(docs.getDevelopDocument(doc.id)?.settings.masks[0].maskAssetId).toBe(snapshotMask.maskAssetId);
});

it('rejects corrupt nested preset and white balance values before applying', () => {
 const settings=createDevelopDocument({sourceUri:'photo.jpg',fileName:'photo.jpg',isRaw:false}).settings;
 expect(()=>blendDevelopPreset(settings,{id:'bad',name:'Bad',settings:{detail:{...settings.detail,sharpenAmount:NaN}}},1)).toThrow();
 expect(()=>blendDevelopPreset(settings,{id:'bad',name:'Bad',settings:{whiteBalance:{mode:'custom',temperature:100}}},1,true)).toThrow();
});
