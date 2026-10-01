import { describe, expect, it } from 'vitest';
import { AssetManager } from '../src/assets/AssetManager';
import { DocumentManager } from '../src/document/DocumentManager';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { DevelopOperationService } from '../src/develop/DevelopOperationService';
import { rasterizeDevelopMask } from '../src/develop/maskRaster';
import { CommandBus } from '../src/history/CommandBus';
import { DevelopMask } from '../src/types/develop';

const linear: DevelopMask = {
  id: 'mask-1', name: 'Gradient', maskAssetId: 'asset', kind: 'linear',
  geometry: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  inverted: false, opacity: 1, exposure: 0,
};

describe('Develop local masks', () => {
  it('rasterizes normalized linear and radial masks with spatial variation', () => {
    const horizontal = rasterizeDevelopMask(linear, 8, 8);
    expect(horizontal[0]).toBeLessThan(horizontal[7]);
    const radial = rasterizeDevelopMask({
      ...linear, kind: 'radial', geometry: { center: { x: 0.5, y: 0.5 }, radiusX: 0.3, radiusY: 0.3, feather: 0.5 },
    }, 9, 9);
    expect(radial[4 * 9 + 4]).toBeGreaterThan(radial[0]);
    const brush = rasterizeDevelopMask({
      ...linear, kind: 'brush', geometry: {},
      strokes: [{ points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], radius: 0.08, feather: 0.5 }],
    }, 64, 64);
    expect(brush[32 * 64 + 32]).toBeGreaterThan(brush[3 * 64 + 32]);
  });

  it('creates, edits, and deletes an undoable local mask through the operation service', async () => {
    const documents = new DocumentManager();
    const history = new CommandBus(documents);
    const assets = new AssetManager();
    const operations = new DevelopOperationService(documents, history, assets);
    const doc = createDevelopDocument({ sourceUri: 'test.raw', fileName: 'test.raw', isRaw: true });
    documents.openDocument(doc);
    const maskId = await operations.createMask({ documentId: doc.id, kind: 'linear', name: '天空', geometry: linear.geometry, source: 'manual' });
    const created = documents.getDevelopDocument(doc.id)?.settings.masks[0];
    expect(created?.id).toBe(maskId);
    expect(assets.getHandle(created!.maskAssetId)?.kind).toBe('mask');
    operations.setMaskParameter({ documentId: doc.id, maskId, parameterId: 'exposure', value: 1.5, source: 'ai' });
    expect(documents.getDevelopDocument(doc.id)?.settings.masks[0].exposure).toBe(1.5);
    history.undo();
    expect(documents.getDevelopDocument(doc.id)?.settings.masks[0].exposure).toBe(0);
    operations.deleteMask(doc.id, maskId, 'manual');
    expect(documents.getDevelopDocument(doc.id)?.settings.masks).toHaveLength(0);
    history.undo();
    expect(documents.getDevelopDocument(doc.id)?.settings.masks).toHaveLength(1);
  });

  it('rejects unsupported local parameters and invalid opacity', async () => {
    const documents = new DocumentManager();
    const history = new CommandBus(documents);
    const operations = new DevelopOperationService(documents, history, new AssetManager());
    const doc = createDevelopDocument({ sourceUri: 'test.raw', fileName: 'test.raw', isRaw: true });
    documents.openDocument(doc);
    const maskId = await operations.createMask({ documentId: doc.id, kind: 'linear', name: 'Sky', geometry: linear.geometry, source: 'manual' });
    expect(() => operations.setMaskParameter({ documentId: doc.id, maskId, parameterId: 'sharpenAmount', value: 30, source: 'ai' })).toThrow();
    await expect(operations.updateMask(doc.id, maskId, { opacity: 2 }, 'manual')).rejects.toThrow();
  });
});
