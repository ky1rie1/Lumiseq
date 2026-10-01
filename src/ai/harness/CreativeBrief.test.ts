import { expect, it } from 'vitest';
import { createEditDocument } from '../../document/EditDocument';
import { createDevelopDocument } from '../../document/DevelopDocument';
import { buildCreativeBrief, prepareCreativeReferences } from './CreativeBrief';
import { AssetManager } from '../../assets/AssetManager';
import { CapabilityRouter } from '../capabilities/CapabilityRouter';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { DocumentManager } from '../../document/DocumentManager';
import { DocumentObservationService } from '../vision/DocumentObservationService';
import { createImageLayer } from '../../document/EditDocument';

it('does not invent missing layout copy or typography from an aesthetic request', () => {
  const doc = createEditDocument({ id: 'poster', width: 900, height: 1200, layers: [] });
  const brief = buildCreativeBrief('Make a premium poster', doc);
  expect(brief.domain).toBe('layout');
  expect(brief.layout?.content).toBeUndefined();
  expect(brief.needsClarification).toBe(true);
  expect(brief.assumptions).toContain('Preserve existing content and hierarchy.');
});

it('uses actual observer region evidence for document reference pixels and preserves provenance', async () => {
  const assets = new AssetManager();
  const source = await assets.registerBlob(new Blob(['asset'], { type: 'image/png' }), 'image', 'source');
  const documents = new DocumentManager();
  const document = createEditDocument({ width: 100, height: 80, layers: [createImageLayer({ name: 'Reference', sourceAssetId: source.id, naturalWidth: 100, naturalHeight: 80 })] });
  documents.openDocument(document);
  const observer = new DocumentObservationService({ documents, assets, renderer: { async render(_doc, geometry) {
    return { data: btoa('actual region'), mimeType: geometry.mimeType, approximate: false };
  } } });
  const router = new CapabilityRouter(new ProviderRegistry()); router.setPrivacyMode('allow');
  const images = await prepareCreativeReferences([{ assetId: source.id, source: 'document', region: { x: 5, y: 6, width: 20, height: 15 } }], assets, router, 'provider', document, observer);
  expect(atob(images[0].data)).toBe('actual region');
  expect(images[0].evidence?.region).toEqual({ x: 5, y: 6, width: 20, height: 15 });
  expect(images[0].evidence?.documentId).toBe(document.id);
  observer.dispose(); assets.releaseAsset(source.id);
});

it('records only stated photography intent and preserves reference provenance', () => {
  const doc = createDevelopDocument({ sourceUri: 'source.jpg', fileName: 'source.jpg', isRaw: false });
  const brief = buildCreativeBrief('Keep skin natural, warm the white balance slightly', doc, {
    references: [{ assetId: 'reference-1', source: 'user-upload', label: 'Warm portrait' }],
  });
  expect(brief.photo?.skin).toBe('natural');
  expect(brief.photo?.whiteBalance).toBe('warm slightly');
  expect(brief.photo?.subject).toBeUndefined();
  expect(brief.references).toEqual([{ assetId: 'reference-1', source: 'user-upload', label: 'Warm portrait' }]);
  expect(brief.needsClarification).toBe(false);
});

it('uses explicit photography policy for an edit document', () => {
  const doc = createEditDocument({ id: 'portrait', width: 900, height: 1200, layers: [] });
  const brief = buildCreativeBrief('Keep skin natural', doc, { taskKind: 'photo' });
  expect(brief.domain).toBe('photo');
  expect(brief.photo?.skin).toBe('natural');
  expect(brief.layout).toBeUndefined();
});

it('routes reference pixels through asset provenance and upload policy', async () => {
  const assets = new AssetManager();
  const source = await assets.registerBlob(new Blob(['picture'], { type: 'image/png' }), 'image', 'reference');
  const router = new CapabilityRouter(new ProviderRegistry());
  router.setPrivacyMode('never');
  const references = [{ assetId: source.id, source: 'user-upload' as const, label: 'Reference' }];
  await expect(prepareCreativeReferences(references, assets, router, 'provider')).rejects.toThrow(/PRIVACY_RESTRICTION/);
  router.setPrivacyMode('allow');
  const images = await prepareCreativeReferences(references, assets, router, 'provider');
  expect(atob(images[0].data)).toBe('picture');
  expect(images[0].observationId).toBe(`reference:${source.id}`);
  expect(assets.hasAsset(source.id)).toBe(true);
  assets.releaseAsset(source.id);
});
