import { afterEach, expect, it, vi } from 'vitest';
import { loadImage, createCanvas, type Canvas } from '@napi-rs/canvas';
import { AssetManager } from '../../assets/AssetManager';
import { DocumentManager } from '../../document/DocumentManager';
import { createEditDocument, createImageLayer, createGroupLayer, createAdjustmentLayer } from '../../document/EditDocument';
import { createDevelopDocument } from '../../document/DevelopDocument';
import { WebGLImageEngine } from '../../engine/WebGLImageEngine';
import { installPixelCanvas } from '../../engine/editPixelTestCanvas';
import { DocumentObservationService } from './DocumentObservationService';
import { createDocumentObservationRenderer } from './documentObservationRenderer';
import type { RawSpatialAnalysis } from '../../app/rawSpatialAnalysis';

afterEach(() => vi.unstubAllGlobals());
function installObservationCanvas() {
  const create = installPixelCanvas();
  return (w = 1, h = 1) => {
    const canvas = create(w, h);
    Object.assign(canvas, { toBlob: (done: (blob: Blob) => void, type = 'image/png') => {
      const native = canvas as unknown as Canvas;
      done(new Blob([new Uint8Array(type === 'image/jpeg' ? native.toBuffer('image/jpeg') : native.toBuffer('image/png'))], { type }));
    } });
    return canvas;
  };
}
async function pixels(data: string) {
  const image = await loadImage(Buffer.from(data, 'base64')), canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return [...canvas.getContext('2d').getImageData(0, 0, image.width, image.height).data];
}
it('renders exact nested Edit crop/adjustment pixels through the production engine on a separate surface', async () => {
  const create = installPixelCanvas(), assets = new AssetManager(), documents = new DocumentManager();
  const source = create(4, 1), ctx = source.getContext('2d')!;
  ctx.fillStyle = '#646464'; ctx.fillRect(0, 0, 2, 1); ctx.fillStyle = '#202020'; ctx.fillRect(2, 0, 2, 1);
  const blob = await new Promise<Blob>(resolve => source.toBlob(b => resolve(b!), 'image/png'));
  const asset = await assets.registerBlob(blob, 'image', 'crop', { width: 4, height: 1 });
  const image = createImageLayer({ name: 'crop', sourceAssetId: asset.id, naturalWidth: 4, naturalHeight: 1 });
  const adjustment = createAdjustmentLayer({ adjustmentType: 'exposure', settings: { type: 'exposure', values: { exposure: 1 } } });
  const group = createGroupLayer({ children: [image, adjustment] }); group.transform.x = 1;
  const doc = createEditDocument({ width: 6, height: 1, backgroundColor: 'transparent', layers: [group] }); documents.openDocument(doc);
  const userCanvas = create(3, 2); userCanvas.getContext('2d')!.fillStyle = '#ff0000'; userCanvas.getContext('2d')!.fillRect(0, 0, 3, 2);
  const renderer = createDocumentObservationRenderer({ assets, createCanvas: create });
  const service = new DocumentObservationService({ documents, assets, renderer });
  const o = await service.observe({ documentId: doc.id, mode: 'region', region: { x: 2, y: 0, width: 2, height: 1 } });
  expect(await pixels(o.image.data)).toEqual([200, 200, 200, 255, 64, 64, 64, 255]);
  expect([...userCanvas.getContext('2d')!.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255]);
  expect(assets.hasAsset(asset.id)).toBe(true); expect(assets.listAssets()).toHaveLength(1);
  await expect(service.observe({ documentId: doc.id, mode: 'overview', variant: 'original' })).rejects.toThrow(/original.*Edit|Edit.*original/i);
  service.dispose(); expect(assets.hasAsset(asset.id)).toBe(true);
});
it('matches odd-size per-axis evidence in production Edit pixels', async () => {
  const create = installPixelCanvas(), assets = new AssetManager(), documents = new DocumentManager();
  const source = create(7, 5), ctx = source.getContext('2d')!;
  ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 7, 5);
  const asset = await assets.registerBlob(await new Promise<Blob>(resolve => source.toBlob(b => resolve(b!))), 'image', 'odd', { width: 7, height: 5 });
  const doc = createEditDocument({ width: 9, height: 9, backgroundColor: '#ff0000', layers: [createImageLayer({ name: 'odd', sourceAssetId: asset.id, naturalWidth: 7, naturalHeight: 5, x: 1, y: 2 })] });
  documents.openDocument(doc);
  const service = new DocumentObservationService({ documents, assets, renderer: createDocumentObservationRenderer({ assets, createCanvas: create }) });
  const o = await service.observe({ documentId: doc.id, mode: 'region', region: { x: 1, y: 2, width: 7, height: 5 }, maxDimension: 4 });
  expect(o.evidence.pixelToDocument).toEqual([7 / 4, 0, 0, 5 / 3, 1, 2]);
  const data = await pixels(o.image.data);
  expect(data.filter((_v, i) => i % 4 === 1)).toEqual(Array(12).fill(255));
  service.dispose();
});
it('reads real native-size tile pixels with halo, whole-source analysis, and original/current recipe', async () => {
  const create = installPixelCanvas(), assets = new AssetManager(), documents = new DocumentManager();
  const width = 80, height = 40, source = create(width, height), ctx = source.getContext('2d')!;
  ctx.fillStyle = '#646464'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#202020'; ctx.fillRect(40, 0, 40, height);
  const analysis: RawSpatialAnalysis = { version: 1, source_width: width, source_height: height, noise: [0, 0, 0],
    haze: { version: 1, width: 1, height: 1, atmosphere: [1, 1, 1], coefficients: [1, 0] } };
  const reads: number[][] = [], surfaces: HTMLCanvasElement[] = [];
  const bridge = { async getRawDisplayTile(_id: string, x: number, y: number, w: number, h: number) {
    reads.push([x, y, w, h]); const tile = create(w, h); tile.getContext('2d')!.drawImage(source, x, y, w, h, 0, 0, w, h);
    return new Uint8Array(await (await new Promise<Blob>(resolve => tile.toBlob(b => resolve(b!)))).arrayBuffer());
  }, async getRawSpatialAnalysis() { return analysis; } };
  const doc = createDevelopDocument({ sourceUri: 'test.raw', fileName: 'test.raw', width, height, isRaw: true, rawState: 'ready', rawEngineAttached: true });
  doc.nativeAssetId = 'raw-native'; doc.settings.exposure = 1; doc.settings.clarity = 10; doc.settings.dehaze = 1;
  documents.openDocument(doc);
  const renderer = createDocumentObservationRenderer({ assets, bridge, createCanvas: (w, h) => { const c = create(w, h); surfaces.push(c); return c; },
    engineFactory: () => new WebGLImageEngine(assets) });
  const service = new DocumentObservationService({ documents, assets, renderer });
  const current = await service.observe({ documentId: doc.id, mode: 'detail', region: { x: 30, y: 10, width: 20, height: 10 } });
  expect(reads).toEqual([[21, 1, 38, 28]]); expect(current.evidence.pixelToDocument).toEqual([1, 0, 0, 1, 30, 10]);
  expect(current.evidence.approximate).toBe(false);
  const currentPixels = await pixels(current.image.data); expect(currentPixels[0]).toBeGreaterThan(125);
  const original = await service.observe({ documentId: doc.id, mode: 'detail', variant: 'original', region: { x: 30, y: 10, width: 20, height: 10 } });
  const originalPixels = await pixels(original.image.data);
  expect(originalPixels.slice(0, 4)).toEqual([100, 100, 100, 255]);
  expect(originalPixels.slice(40, 44)).toEqual([32, 32, 32, 255]);
  expect(assets.listAssets()).toHaveLength(0); expect(surfaces.every(c => c.width <= 1 && c.height <= 1)).toBe(true);
  service.dispose();
});
it('uses the decoded whole-source RAW preview with current recipe and marks scale approximation', async () => {
  const create = installObservationCanvas(), assets = new AssetManager(), documents = new DocumentManager();
  const source = create(8, 4); source.getContext('2d')!.fillStyle = '#646464'; source.getContext('2d')!.fillRect(0, 0, 8, 4);
  const asset = await assets.registerBlob(await new Promise<Blob>(resolve => source.toBlob(b => resolve(b!))), 'image', 'overview', { width: 8, height: 4 });
  const doc = createDevelopDocument({ sourceUri: 'overview.raw', fileName: 'overview.raw', width: 80, height: 40,
    isRaw: true, rawState: 'ready', previewAssetId: asset.id }); doc.settings.exposure = 1; doc.nativeAssetId = 'overview-native'; documents.openDocument(doc);
  const service = new DocumentObservationService({ documents, assets, renderer: createDocumentObservationRenderer({ assets, createCanvas: create }) });
  const current = await service.observe({ documentId: doc.id, mode: 'overview', maxDimension: 8 });
  expect(current.evidence.approximate).toBe(true); expect(current.image.mimeType).toBe('image/jpeg');
  expect(current.evidence.pixelToDocument).toEqual([10, 0, 0, 10, 0, 0]); expect((await pixels(current.image.data))[0]).toBeGreaterThan(125);
  const revision = service.revision(doc.id); doc.settings.exposure = 0;
  const changed = await service.observe({ documentId: doc.id, mode: 'overview', maxDimension: 8 });
  expect(changed.evidence.revision).not.toBe(revision); expect((await pixels(changed.image.data))[0]).toBeLessThan(110);
  expect(service.get(current.evidence.observationId)).toBeUndefined();
  const unscaled = await service.observe({ documentId: doc.id, mode: 'overview', maxDimension: 80 });
  expect(unscaled.evidence.approximate).toBe(true); // still originates from the 8x4 decoded overview
  service.dispose(); expect(assets.hasAsset(asset.id)).toBe(true);
});
it('preserves a linked nested Edit mask in document coordinates across the exact crop', async () => {
  const create = installPixelCanvas(), assets = new AssetManager(), documents = new DocumentManager();
  const source = create(4, 1); source.getContext('2d')!.fillStyle = '#646464'; source.getContext('2d')!.fillRect(0, 0, 4, 1);
  const asset = await assets.registerBlob(await new Promise<Blob>(resolve => source.toBlob(b => resolve(b!))), 'image', 'masked', { width: 4, height: 1 });
  const mask = await assets.registerMask(new Uint8ClampedArray([255, 255, 0, 0, 0, 0]), 6, 1);
  const image = createImageLayer({ name: 'masked', sourceAssetId: asset.id, naturalWidth: 4, naturalHeight: 1 });
  image.mask = { id: 'm', assetId: mask.id, enabled: true, linked: true, density: 1, feather: 0,
    referenceTransform: [1, 0, 0, 1, 0, 0], referenceWidth: 4, referenceHeight: 1 };
  const group = createGroupLayer({ children: [image] }); group.transform.x = 1;
  const doc = createEditDocument({ width: 6, height: 1, backgroundColor: 'transparent', layers: [group] }); documents.openDocument(doc);
  const service = new DocumentObservationService({ documents, assets, renderer: createDocumentObservationRenderer({ assets, createCanvas: create }) });
  const o = await service.observe({ documentId: doc.id, mode: 'detail', region: { x: 2, y: 0, width: 2, height: 1 } });
  expect(await pixels(o.image.data)).toEqual([100, 100, 100, 255, 0, 0, 0, 0]); service.dispose();
  expect(assets.listAssets()).toHaveLength(2);
});
it('rejects a failed or aborted native read and frees every observer surface', async () => {
  const create = installPixelCanvas(), assets = new AssetManager(), documents = new DocumentManager(), surfaces: HTMLCanvasElement[] = [];
  const doc = createDevelopDocument({ sourceUri: 'pending.raw', fileName: 'pending.raw', width: 20, height: 20, isRaw: true, rawState: 'ready' });
  doc.nativeAssetId = 'pending-native'; documents.openDocument(doc);
  let fail = true;
  const bridge = { async getRawDisplayTile() {
    if (fail) throw new Error('data:image/png;base64,PRIVATE');
    await Promise.resolve(); return new Uint8Array([1, 2]);
  } };
  const renderer = createDocumentObservationRenderer({ assets, bridge, createCanvas: (w, h) => { const c = create(w, h); surfaces.push(c); return c; } });
  const service = new DocumentObservationService({ documents, assets, renderer });
  const request = { documentId: doc.id, mode: 'detail' as const, region: { x: 0, y: 0, width: 2, height: 2 } };
  await expect(service.observe(request)).rejects.toThrow(/^Document observation render failed$/);
  fail = false; const controller = new AbortController(); const pending = service.observe(request, controller.signal); controller.abort();
  await expect(pending).rejects.toThrow(/abort/i);
  expect(surfaces.every(c => c.width === 1 && c.height === 1)).toBe(true); expect(assets.listAssets()).toHaveLength(0);
  service.dispose();
});
it('rejects a native tile of the wrong dimensions instead of scaling it into false 1:1 evidence', async () => {
  const create = installPixelCanvas(), assets = new AssetManager(), documents = new DocumentManager();
  const wrong = create(1, 1), blob = await new Promise<Blob>(resolve => wrong.toBlob(b => resolve(b!)));
  const doc = createDevelopDocument({ sourceUri: 'wrong.raw', fileName: 'wrong.raw', width: 20, height: 20, isRaw: true, rawState: 'ready' });
  doc.nativeAssetId = 'wrong-native'; documents.openDocument(doc);
  const renderer = createDocumentObservationRenderer({ assets, createCanvas: create,
    bridge: { async getRawDisplayTile() { return new Uint8Array(await blob.arrayBuffer()); } } });
  const service = new DocumentObservationService({ documents, assets, renderer });
  await expect(service.observe({ documentId: doc.id, mode: 'detail', region: { x: 0, y: 0, width: 2, height: 2 } })).rejects.toThrow(/render failed/i);
  expect(assets.listAssets()).toHaveLength(0); service.dispose();
});
it('explicitly rejects Edit intermediates larger than the existing render buffer limit', async () => {
  const create = installPixelCanvas(), assets = new AssetManager(), documents = new DocumentManager();
  const doc = createEditDocument({ width: 9000, height: 9000, layers: [createAdjustmentLayer({ adjustmentType: 'exposure' })] });
  documents.openDocument(doc);
  const service = new DocumentObservationService({ documents, assets, renderer: createDocumentObservationRenderer({ assets, createCanvas: create }) });
  await expect(service.observe({ documentId: doc.id, mode: 'overview' })).rejects.toThrow(/supported render buffer size/i);
  service.dispose();
});
