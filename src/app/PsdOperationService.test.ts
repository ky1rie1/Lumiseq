import { describe, expect, it } from 'vitest';
import { initializeCanvas, readPsd } from 'ag-psd';
import { createEditDocument, createImageLayer } from '../document/EditDocument';
import { encodeLayeredPsd, embedStudioProject, extractStudioProject } from './PsdOperationService';
import { AssetManager } from '../assets/AssetManager';
import { ProjectSerializer } from '../project/ProjectSerializer';

describe('editable PSD save', () => {
  initializeCanvas(() => { throw new Error('Canvas was not expected'); }, (width, height) => ({
    width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb',
  } as ImageData));
  it('writes separate named layers in Photoshop order with composite pixels', async () => {
    const bottom = createImageLayer({ name: '底图', sourceAssetId: 'a', naturalWidth: 2, naturalHeight: 2 });
    const top = createImageLayer({ name: '修图', sourceAssetId: 'b', naturalWidth: 2, naturalHeight: 2 });
    const doc = createEditDocument({ name: 'portrait', width: 2, height: 2, layers: [bottom, top] });
    const pixels = (red: number) => ({ width: 2, height: 2, data: new Uint8ClampedArray([red,0,0,255, red,0,0,255, red,0,0,255, red,0,0,255]) });
    const bytes = await encodeLayeredPsd(doc, async layer => pixels(layer?.id === top.id ? 200 : 100));
    const psd = readPsd(bytes, { useImageData: true, skipThumbnail: true });
    expect(psd.children?.map(layer => layer.name)).toEqual(['修图', '底图']);
    expect(psd.children?.[0].imageData?.data[0]).toBe(200);
    expect(psd.children?.[1].imageData?.data[0]).toBe(100);
  });

  it('keeps studio history in a non-layer PSD resource', async () => {
    const doc = createEditDocument({ name: 'portrait', width: 2, height: 2 });
    const empty = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    const bare = await encodeLayeredPsd(doc, async () => empty);
    const project = JSON.stringify({ format: 'aistudio', aiHistory: { usedAI: true, prompt: '移除背景' } });
    const enriched = await embedStudioProject(bare, project);
    expect(await extractStudioProject(enriched)).toBe(project);
    expect(readPsd(enriched, { useImageData: true, skipThumbnail: true }).children?.map(layer => layer.name))
      .toEqual(readPsd(bare, { useImageData: true, skipThumbnail: true }).children?.map(layer => layer.name));
    expect(await extractStudioProject(bare)).toBeNull();
  });

  it('restores studio AI history from the same PSD file', async () => {
    const source = new AssetManager();
    const doc = createEditDocument({ name: 'portrait', width: 2, height: 2 });
    doc.aiHistory = { usedAI: true, runs: [{ runId: 'r1', documentId: doc.id, providerId: 'openai', modelId: 'example',
      prompt: '增加对比度', response: '已调整', startedAt: 1, finishedAt: 2, status: 'completed', actions: [], commandIds: [] }] };
    const empty = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    const psd = await encodeLayeredPsd(doc, async () => empty);
    const json = await new ProjectSerializer().serialize(doc, source);
    const enriched = await embedStudioProject(psd, json);
    const restored = await new ProjectSerializer().hydrate((await extractStudioProject(enriched))!, new AssetManager());
    expect(restored.aiHistory?.runs[0]).toMatchObject({ prompt: '增加对比度', response: '已调整', modelId: 'example' });
  });
});
