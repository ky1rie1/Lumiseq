import { describe, it, expect, vi } from 'vitest';
import { DocumentManager } from '../src/document/DocumentManager';
import { AssetManager } from '../src/assets/AssetManager';
import { createEditDocument, createImageLayer, createGroupLayer } from '../src/document/EditDocument';
import { ProjectSerializer } from '../src/project/ProjectSerializer';
import { openSelectedFile } from '../src/app/documentOpening';
import { DevelopProjectSerializer } from '../src/project/DevelopProjectSerializer';
import { createDevelopDocument } from '../src/document/DevelopDocument';

it('uses decoded portrait dimensions on both canvas and image layer', async () => {
  const documents=new DocumentManager(); const assets=new AssetManager();
  const doc=await openSelectedFile({name:'portrait.png',sizeBytes:1,blob:new Blob(['x'])},{documents,assets,decodeImage:async()=>({width:600,height:900})});
  expect(doc.width).toBe(600); expect(doc.height).toBe(900);
  expect(doc.kind==='edit' && doc.layers[0].transform.height).toBe(900);
});
it('failed image decoding leaves the active document and no registered assets',async()=>{
  const documents=new DocumentManager(); const assets=new AssetManager();
  const previous=createEditDocument({name:'previous'});documents.openDocument(previous);
  await expect(openSelectedFile({name:'broken.png',sizeBytes:1,blob:new Blob(['x'])},{documents,assets,decodeImage:async()=>{throw Error('decode failed');}})).rejects.toThrow('decode failed');
  expect(documents.getActiveDocument()).toBe(previous);expect(assets.listAssets()).toHaveLength(0);
});
it('opens a valid text-only project without treating JSON as an image',async()=>{
  const documents=new DocumentManager();const decodeImage=vi.fn();
  const original=createEditDocument({name:'project',width:400,height:800});
  const doc=await openSelectedFile({name:'design.aistudio',sizeBytes:1,blob:new Blob([JSON.stringify({format:'aistudio',version:'1.0',document:original})])},{documents,assets:new AssetManager(),decodeImage});
  expect(doc).toEqual(original);expect(decodeImage).not.toHaveBeenCalled();
});
it('rejects missing assets inside a group',async()=>{
  const documents=new DocumentManager();const previous=createEditDocument({name:'previous'});documents.openDocument(previous);
  const group=createGroupLayer({name:'group',children:[createImageLayer({name:'missing',sourceAssetId:'gone',naturalWidth:20,naturalHeight:30})]});
  const original=createEditDocument({layers:[group]});
  await expect(new ProjectSerializer().deserialize(JSON.stringify({format:'aistudio',version:'1.0',document:original}),documents,new AssetManager())).rejects.toThrow(/资源/);
  expect(documents.getActiveDocument()).toBe(previous);
});
it('rejects invalid RAW metadata before changing the document',async()=>{
  const documents=new DocumentManager();const previous=createEditDocument({name:'previous'});documents.openDocument(previous);
  await expect(openSelectedFile({name:'broken.cr3',path:'C:\\broken.cr3',sizeBytes:1,blob:new Blob(['x'])},{documents,platform:{isDesktop:true,getRawMetadata:async()=>null} as any})).rejects.toThrow(/RAW/);
  expect(documents.getActiveDocument()).toBe(previous);
});
it('opens a saved RAW project with its adjustments and source file reference', async () => {
  const documents = new DocumentManager(); const assets = new AssetManager();
  const original = createDevelopDocument({ sourceUri: 'C:\\photos\\portrait.cr3', fileName: 'portrait.cr3', isRaw: true, width: 600, height: 900 });
  original.settings.exposure = 0.75;
  const json = await new DevelopProjectSerializer().serialize(original, assets);
  const doc = await openSelectedFile({ name: 'portrait.aistudio', sizeBytes: json.length, blob: new Blob([json]) }, {
    documents, assets, platform: { getRawMetadata: async () => ({ width: 600, height: 900 }) } as any,
  });
  expect(doc.kind).toBe('develop');
  if (doc.kind === 'develop') expect(doc.settings.exposure).toBe(0.75);
  expect(documents.getActiveDocument()).toBe(doc);
});

describe('project opening is atomic', () => {
  for (const value of [null, {format:'aistudio',version:'99'}, {format:'aistudio',version:'1.0',document:{kind:'edit'}}]) {
    it(`rejects invalid project ${JSON.stringify(value)}`, async () => {
      const docs = new DocumentManager(); const previous = createEditDocument({name:'previous'}); docs.openDocument(previous);
      await expect(new ProjectSerializer().deserialize(JSON.stringify(value),docs,new AssetManager())).rejects.toThrow();
      expect(docs.getActiveDocument()).toBe(previous);
    });
  }
  it('rejects missing nested image resources without replacing the current document', async () => {
    const docs = new DocumentManager(); const previous = createEditDocument({name:'previous'}); docs.openDocument(previous);
    const doc = createEditDocument({name:'missing',layers:[createImageLayer({name:'image',sourceAssetId:'gone',naturalWidth:100,naturalHeight:200})]});
    await expect(new ProjectSerializer().deserialize(JSON.stringify({format:'aistudio',version:'1.0',document:doc,assets:{}}),docs,new AssetManager())).rejects.toThrow(/资源|resource/i);
    expect(docs.getActiveDocument()).toBe(previous);
  });
});
