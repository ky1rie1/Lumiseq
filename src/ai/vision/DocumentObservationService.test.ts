import { afterEach, expect, it, vi } from 'vitest';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { DocumentManager } from '../../document/DocumentManager';
import { createEditDocument, createGroupLayer, createTextLayer } from '../../document/EditDocument';
import { AssetManager } from '../../assets/AssetManager';
import { DocumentObservationService } from './DocumentObservationService';
import type { DocumentObservationRenderPort } from './observationTypes';

afterEach(() => vi.unstubAllGlobals());
function fixture(width = 6000, height = 4000) {
  const documents = new DocumentManager(), assets = new AssetManager();
  const doc = createEditDocument({ width, height }); documents.openDocument(doc);
  let renders = 0;
  // A real Skia pixel drawing port: colored quadrants expose crop/scale errors.
  const renderer: DocumentObservationRenderPort = { async render(_doc, geometry) {
    renders++;
    const canvas = createCanvas(geometry.width, geometry.height), ctx = canvas.getContext('2d');
    ctx.scale(geometry.width / geometry.region.width, geometry.height / geometry.region.height);
    ctx.translate(-geometry.region.x, -geometry.region.y);
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 3000, 2000);
    ctx.fillStyle = '#00ff00'; ctx.fillRect(3000, 0, 3000, 2000);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 2000, 3000, 2000);
    return { data: (geometry.mimeType === 'image/png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg')).toString('base64'),
      mimeType: geometry.mimeType, approximate: false };
  } };
  const service = new DocumentObservationService({ documents, assets, renderer });
  return { service, documents, assets, doc, renderer, renders: () => renders };
}
it('invalidates observations when the edit rendering precision changes', async () => {
  const { service, doc, documents } = fixture(20, 10);
  const before = service.revision(doc.id);
  documents.updateDocument({ ...doc, renderingVersion: 2, bitDepth: 32, workingProfile: 'linear-srgb' });
  expect(service.revision(doc.id)).not.toBe(before);
});
it('maps an exact crop without moving the user viewport', async () => {
  const { service, doc, documents } = fixture();
  const viewport = { panX: 700, zoom: 4 }; const original = { ...viewport };
  const o = await service.observe({ documentId: doc.id, mode: 'region',
    region: { x: 1500, y: 1000, width: 1200, height: 800 }, maxDimension: 600 });
  expect(o.evidence.width).toBe(600); expect(o.evidence.height).toBe(400);
  expect(o.evidence.pixelToDocument).toEqual([2, 0, 0, 2, 1500, 1000]);
  expect(o.image.mimeType).toBe('image/png');
  const image = await loadImage(Buffer.from(o.image.data, 'base64'));
  const canvas = createCanvas(600, 400); canvas.getContext('2d').drawImage(image, 0, 0);
  expect([...canvas.getContext('2d').getImageData(300, 200, 1, 1).data]).toEqual([255, 0, 0, 255]);
  expect(viewport).toEqual(original); expect(documents.getActiveDocument()?.id).toBe(doc.id);
});
it('observes the complete source as an overview JPEG with hand-derived odd-size mapping', async () => {
  const { service, doc } = fixture();
  const o = await service.observe({ documentId: doc.id, mode: 'overview' });
  expect(o.evidence.region).toEqual({ x: 0, y: 0, width: 6000, height: 4000 });
  expect([o.evidence.width, o.evidence.height]).toEqual([1024, 683]);
  expect(o.evidence.pixelToDocument).toEqual([6000 / 1024, 0, 0, 4000 / 683, 0, 0]);
  expect(o.image.mimeType).toBe('image/jpeg');
});
it('rounds region boundaries outward and clips them to the source', async () => {
  const { service, doc } = fixture(17, 11);
  const o = await service.observe({ documentId: doc.id, mode: 'region', maxDimension: 7,
    region: { x: -1.2, y: 2.8, width: 15.4, height: 12.9 } });
  expect(o.evidence.region).toEqual({ x: 0, y: 2, width: 15, height: 9 });
  expect([o.evidence.width, o.evidence.height]).toEqual([7, 4]);
  expect(o.evidence.pixelToDocument).toEqual([15 / 7, 0, 0, 9 / 4, 0, 2]);
});
it('keeps detail pixels at 1:1 and rejects detail that needs explicit tiling', async () => {
  const { service, doc } = fixture();
  const o = await service.observe({ documentId: doc.id, mode: 'detail',
    region: { x: 10, y: 12, width: 321, height: 177 }, maxDimension: 100 });
  expect([o.evidence.width, o.evidence.height]).toEqual([321, 177]);
  expect(o.evidence.pixelToDocument).toEqual([1, 0, 0, 1, 10, 12]);
  await expect(service.observe({ documentId: doc.id, mode: 'detail' })).rejects.toThrow(/tile|region/i);
  await expect(service.observe({ documentId: doc.id, mode: 'overview', maxDimension: 1537 })).rejects.toThrow(/dimension/i);
});
it.each([
  { x: 6000, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 },
  { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: Infinity, height: 1 },
])('rejects invalid or empty regions before rendering: %j', async region => {
  const { service, doc, renders } = fixture();
  await expect(service.observe({ documentId: doc.id, mode: 'region', region })).rejects.toThrow(/region/i);
  expect(renders()).toBe(0);
});
it('rejects nonexistent documents and malformed requests', async () => {
  const { service, doc } = fixture();
  await expect(service.observe({ documentId: 'missing', mode: 'overview' })).rejects.toThrow(/document/i);
  await expect(service.observe({ documentId: doc.id, mode: 'region' })).rejects.toThrow(/region/i);
  await expect(service.observe({ documentId: doc.id, mode: 'bad' as 'overview' })).rejects.toThrow(/mode/i);
});
it('caches by render state, ignores UI/history, and invalidates nested content and assets', async () => {
  const { service, doc, documents, assets, renders } = fixture();
  const child = createTextLayer({ text: 'before' }); doc.layers = [createGroupLayer({ children: [child] })];
  const request = { documentId: doc.id, mode: 'overview' as const };
  const a = await service.observe(request);
  doc.selectedLayerId = child.id; doc.isDirty = true; doc.updatedAt++;
  doc.aiHistory = { usedAI: true, runs: [] }; documents.updateDocument(doc);
  expect((await service.observe(request)).evidence.observationId).toBe(a.evidence.observationId);
  expect(renders()).toBe(1);
  child.text = 'after'; documents.updateDocument(doc);
  const b = await service.observe(request); expect(b.evidence.revision).not.toBe(a.evidence.revision);
  expect(service.get(a.evidence.observationId)).toBeUndefined();
  const mask = await assets.registerMask(new Uint8ClampedArray([255]), 1, 1);
  child.mask = { id: 'm', assetId: mask.id, enabled: true, linked: false, density: 1, feather: 0 };
  const c = await service.observe(request); assets.releaseAsset(mask.id);
  expect(service.revision(doc.id)).not.toBe(c.evidence.revision);
  expect(service.get(c.evidence.observationId)).toBeUndefined();
});
it('rejects expected-revision mismatch and a state change during rendering', async () => {
  const { service, doc, renderer } = fixture();
  await expect(service.observe({ documentId: doc.id, mode: 'overview', expectedRevision: 'old' })).rejects.toThrow(/revision/i);
  const render = renderer.render.bind(renderer);
  renderer.render = async (...args) => { const result = await render(...args); doc.backgroundColor = '#123456'; return result; };
  await expect(service.observe({ documentId: doc.id, mode: 'overview' })).rejects.toThrow(/stale|changed/i);
});
it('honors abort before and during a render, disposal, and sanitizes renderer errors', async () => {
  const { service, doc, renderer, renders } = fixture(); const controller = new AbortController(); controller.abort();
  await expect(service.observe({ documentId: doc.id, mode: 'overview' }, controller.signal)).rejects.toThrow(/abort/i);
  expect(renders()).toBe(0);
  renderer.render = async () => { throw new Error('data:image/png;base64,SECRET_IMAGE_BODY'); };
  await expect(service.observe({ documentId: doc.id, mode: 'overview' })).rejects.toThrow(/^Document observation render failed$/);
  renderer.render = async (_doc, _geometry, _variant, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const later = new AbortController(); const pending = service.observe({ documentId: doc.id, mode: 'overview' }, later.signal);
  later.abort(); await expect(pending).rejects.toThrow(/abort/i);
  const disposing = service.observe({ documentId: doc.id, mode: 'overview' }); service.dispose();
  await expect(disposing).rejects.toThrow(/abort|disposed/i);
  await expect(service.observe({ documentId: doc.id, mode: 'overview' })).rejects.toThrow(/disposed/i);
});
it('bounds retained images by count, bytes and per-image size and releases them', async () => {
  const { documents, assets, doc, renderer } = fixture(20, 20);
  const service = new DocumentObservationService({ documents, assets, renderer, maxImages: 2, maxBytes: 1024, maxImageBytes: 512 });
  const a = await service.observe({ documentId: doc.id, mode: 'detail', region: { x: 0, y: 0, width: 1, height: 1 } });
  const b = await service.observe({ documentId: doc.id, mode: 'detail', region: { x: 1, y: 0, width: 1, height: 1 } });
  const c = await service.observe({ documentId: doc.id, mode: 'detail', region: { x: 2, y: 0, width: 1, height: 1 } });
  expect(service.get(a.evidence.observationId)).toBeUndefined(); expect(service.get(b.evidence.observationId)).toBeDefined();
  service.release(c.evidence.observationId); expect(service.get(c.evidence.observationId)).toBeUndefined();
  renderer.render = async () => ({ mimeType: 'image/png', data: 'A'.repeat(1024), approximate: false });
  await expect(service.observe({ documentId: doc.id, mode: 'detail', region: { x: 3, y: 0, width: 1, height: 1 } })).rejects.toThrow(/size/i);
  service.dispose(); expect(service.get(b.evidence.observationId)).toBeUndefined();
});
it('uses stable content revisions across service instances', async () => {
  const { service, documents, assets, doc, renderer } = fixture();
  const second = new DocumentObservationService({ documents, assets, renderer });
  expect(second.revision(doc.id)).toBe(service.revision(doc.id));
  const before = service.revision(doc.id); doc.backgroundColor = '#fedcba';
  expect(second.revision(doc.id)).toBe(service.revision(doc.id)); expect(service.revision(doc.id)).not.toBe(before);
  second.dispose();
});
it('enforces the default sixteen-image bound and closes a document without retaining observations', async () => {
  const { service, documents, doc } = fixture(20, 20);
  const observations = [];
  for (let x = 0; x < 17; x++) observations.push(await service.observe({ documentId: doc.id, mode: 'detail', region: { x, y: 0, width: 1, height: 1 } }));
  expect(service.get(observations[0].evidence.observationId)).toBeUndefined();
  expect(service.get(observations[1].evidence.observationId)).toBeDefined();
  documents.closeDocument(doc.id);
  expect(service.get(observations[16].evidence.observationId)).toBeUndefined();
  service.dispose();
});
it('evicts by retained byte size even before reaching the count bound', async () => {
  const { documents, assets, doc, renderer } = fixture(20, 20);
  const service = new DocumentObservationService({ documents, assets, renderer, maxImages: 16, maxBytes: 400 });
  const first = await service.observe({ documentId: doc.id, mode: 'detail', region: { x: 0, y: 0, width: 1, height: 1 } });
  const second = await service.observe({ documentId: doc.id, mode: 'detail', region: { x: 1, y: 0, width: 1, height: 1 } });
  expect(service.get(first.evidence.observationId)).toBeUndefined(); expect(service.get(second.evidence.observationId)).toBeDefined();
  service.dispose();
});
