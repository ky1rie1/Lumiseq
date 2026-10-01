import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../src/document/DocumentManager';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { CommandBus } from '../src/history/CommandBus';
import { DevelopOperationService } from '../src/develop/DevelopOperationService';
import { resolveAutomaticWhiteBalance } from '../src/engine/developColorMath';
import { DevelopSettingsClipboard } from '../src/develop/DevelopSettingsClipboard';
import { AssetManager } from '../src/assets/AssetManager';
import { buildNativeDevelopPayload } from '../src/app/nativeDevelopPayload';
import { DevelopProjectSerializer } from '../src/project/DevelopProjectSerializer';

function setup(reader?: () => Promise<number[][]>) {
  const documents = new DocumentManager();
  const history = new CommandBus(documents);
  const source = createDevelopDocument({ sourceUri: 'source.raw', fileName: 'source.raw', isRaw: true });
  source.settings.exposure = 1.25;
  source.settings.contrast = 12;
  source.settings.whiteBalance = { mode: 'custom', temperature: 5000, tint: 12, cameraMultipliers: [2, 1, 3, 1] };
  const target = createDevelopDocument({ sourceUri: 'target.raw', fileName: 'target.raw', isRaw: true });
  target.settings.whiteBalance = { mode: 'custom', temperature: 6500, tint: -8, cameraMultipliers: [4, 1, 5, 1] };
  documents.openDocument(source);
  documents.openDocument(target, true);
  const operations = new DevelopOperationService(documents, history, undefined, reader, new DevelopSettingsClipboard());
  return { documents, history, operations, source, target };
}

describe('RAW curve transactions and settings transfer', () => {
  it('previews a drag with no history, commits once and undo/redo restore complete curves', () => {
    const { documents, history, operations, target } = setup();
    const original = structuredClone(target.settings.curves);
    operations.beginCurveChange(target.id);
    for (const y of [.6, .7, .8]) operations.previewCurves(target.id, { ...original, rgb: [{ x: 0, y: 0 }, { x: .5, y }, { x: 1, y: 1 }] });
    expect(history.getHistory()).toHaveLength(0);
    operations.commitCurveChange();
    expect(history.getHistory()).toHaveLength(1);
    expect(documents.getDevelopDocument(target.id)!.settings.curves.rgb[1].y).toBe(.8);
    history.undo();
    expect(documents.getDevelopDocument(target.id)!.settings.curves).toEqual(original);
    history.redo();
    expect(documents.getDevelopDocument(target.id)!.settings.curves.rgb[1].y).toBe(.8);
  });

  it('aborts previews on Escape or photo switching without history', () => {
    const { documents, history, operations, source, target } = setup();
    const original = structuredClone(target.settings.curves);
    for (const abort of [() => operations.abortCurveChange(), () => documents.setActiveDocument(source.id)]) {
      documents.setActiveDocument(target.id);
      operations.beginCurveChange(target.id);
      operations.previewCurves(target.id, { ...original, rgb: [{ x: 0, y: .2 }, { x: 1, y: .8 }] });
      abort();
      expect(documents.getDevelopDocument(target.id)!.settings.curves).toEqual(original);
      expect(history.getHistory()).toHaveLength(0);
    }
  });

  it('copies read-only whitelisted bounded data without camera, masks or resources', () => {
    const { history, operations, source } = setup();
    source.nativeAssetId = 'native-secret';
    source.settings.masks = [{ id: 'mask-secret', name: 'local', maskAssetId: 'asset-secret', kind: 'brush', geometry: {}, inverted: false, opacity: 1 }];
    const before = structuredClone(source);
    const snapshot = operations.copySettings(source.id);
    expect(snapshot).toMatchObject({ version: 1, sourceDocumentId: source.id, sourceName: 'source.raw' });
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ['cameraMultipliers', 'resolvedAuto', 'mask-secret', 'native-secret', 'asset-secret', 'sourceUri']) expect(serialized).not.toContain(forbidden);
    expect(source).toEqual(before);
    expect(history.canUndo()).toBe(false);
    source.settings.exposure = 4;
    expect(snapshot.groups.basic.exposure).toBe(1.25);
  });

  it('pastes selected groups atomically and excludes WB by default', async () => {
    const { documents, history, operations, source, target } = setup();
    const before = structuredClone(target.settings);
    operations.copySettings(source.id);
    await operations.pasteSettings(target.id, ['basic', 'curves']);
    expect(documents.getDevelopDocument(target.id)!.settings).toMatchObject({ exposure: 1.25, contrast: 12, whiteBalance: before.whiteBalance });
    expect(history.getHistory()).toHaveLength(1);
    history.undo();
    expect(documents.getDevelopDocument(target.id)!.settings).toEqual(before);
    history.redo();
    expect(documents.getDevelopDocument(target.id)!.settings.exposure).toBe(1.25);
  });

  it('explicit custom WB transfers only temperature/tint and retains target camera data', async () => {
    const { documents, operations, source, target } = setup();
    operations.copySettings(source.id);
    await operations.pasteSettings(target.id, ['color'], true);
    expect(documents.getDevelopDocument(target.id)!.settings.whiteBalance).toEqual({ mode: 'custom', temperature: 5000, tint: 12, cameraMultipliers: [4, 1, 5, 1] });
  });

  it('resolves explicit automatic WB from target pixels, never the source matrix', async () => {
    const { documents, history, operations, source, target } = setup(async () => Array.from({ length: 100 }, () => [.24, .2, .17]));
    source.settings.whiteBalance = { mode: 'auto', resolvedAuto: resolveAutomaticWhiteBalance(Array.from({ length: 100 }, () => [.1, .2, .3])) };
    operations.copySettings(source.id);
    await operations.pasteSettings(target.id, ['basic'], true);
    const wb = documents.getDevelopDocument(target.id)!.settings.whiteBalance;
    expect(wb.resolvedAuto?.matrix).toEqual([.2/.24, 0, 0, 0, 1, 0, 0, 0, .2/.17]);
    expect(wb.cameraMultipliers).toEqual([4, 1, 5, 1]);
    expect(history.getHistory()).toHaveLength(1);
  });

  it('rejects missing source/invalid groups/unresolved WB with zero partial writes', async () => {
    const { documents, history, operations, source, target } = setup(async () => { throw new Error('missing pixels'); });
    await expect(operations.pasteSettings(target.id, ['basic'])).rejects.toThrow();
    expect(() => operations.copySettings('missing')).toThrow();
    operations.copySettings(source.id);
    await expect(operations.pasteSettings(target.id, ['masks'] as never)).rejects.toThrow();
    source.settings.whiteBalance = { mode: 'auto', resolvedAuto: resolveAutomaticWhiteBalance(Array.from({ length: 100 }, () => [.1, .2, .3])) };
    operations.copySettings(source.id);
    await expect(operations.pasteSettings(target.id, ['basic'], true)).rejects.toThrow('missing pixels');
    expect(documents.getDevelopDocument(target.id)!.settings.exposure).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it('rejects new curve writes with missing endpoints while preserving loaded legacy curves', () => {
    const { documents, history, operations, target } = setup();
    const legacy = { ...target.settings.curves, rgb: [{ x: .1, y: .2 }, { x: .9, y: .8 }] };
    documents.updateDocument({ ...target, settings: { ...target.settings, curves: legacy } });
    expect(documents.getDevelopDocument(target.id)!.settings.curves).toEqual(legacy);
    expect(() => operations.setCurves(target.id, legacy, 'ai')).toThrow(/endpoint/);
    operations.beginCurveChange(target.id);
    expect(() => operations.previewCurves(target.id, legacy)).toThrow(/endpoint/);
    operations.abortCurveChange();
    expect(documents.getDevelopDocument(target.id)!.settings.curves).toEqual(legacy);
    expect(history.getHistory()).toHaveLength(0);
  });

  it('copies unresolved auto as mode only and resolves only when WB is explicitly included', async () => {
    const { documents, history, operations, source, target } = setup(async () => { throw new Error('missing target source'); });
    source.settings.whiteBalance = { mode: 'auto' };
    expect(operations.copySettings(source.id).whiteBalance).toEqual({ mode: 'auto' });
    await operations.pasteSettings(target.id, ['basic']);
    expect(documents.getDevelopDocument(target.id)!.settings.exposure).toBe(1.25);
    history.undo();
    await expect(operations.pasteSettings(target.id, ['basic'], true)).rejects.toThrow('missing target source');
    expect(documents.getDevelopDocument(target.id)!.settings.exposure).toBe(0);
  });

  it('rejects oversized recipes and incomplete custom WB without overwriting a valid clipboard', () => {
    const { operations, source, target } = setup();
    operations.copySettings(source.id);
    target.settings.curves.rgb = Array.from({ length: 129 }, (_, i) => ({ x: i / 128, y: i / 128 }));
    expect(() => operations.copySettings(target.id)).toThrow();
    target.settings.curves = structuredClone(source.settings.curves);
    target.settings.whiteBalance = { mode: 'custom', temperature: 5000 };
    expect(() => operations.copySettings(target.id)).toThrow();
    expect(operations.clipboard.getSnapshot()?.sourceDocumentId).toBe(source.id);
  });

  it('uses target camera WB for as-shot and fails atomically if target camera data is missing', async () => {
    const { documents, history, operations, source, target } = setup();
    source.settings.whiteBalance = { mode: 'as-shot', cameraMultipliers: [2, 1, 3, 1] };
    operations.copySettings(source.id);
    await operations.pasteSettings(target.id, ['basic'], true);
    expect(documents.getDevelopDocument(target.id)!.settings.whiteBalance).toMatchObject({ mode: 'as-shot', temperature: 5500, tint: 0, cameraMultipliers: [4, 1, 5, 1] });
    history.undo();
    const fresh = documents.getDevelopDocument(target.id)!;
    documents.updateDocument({ ...fresh, settings: { ...fresh.settings, whiteBalance: { mode: 'custom', temperature: 6500, tint: -8 } } });
    await expect(operations.pasteSettings(target.id, ['basic'], true)).rejects.toThrow(/target/i);
    expect(documents.getDevelopDocument(target.id)!.settings.exposure).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it('strips unrecognized nested curve properties and returns detached clipboard snapshots', () => {
    const { operations, source } = setup();
    Object.assign(source.settings.curves.rgb[0], { nativeAssetId: 'hidden-resource', masks: ['hidden-mask'] });
    const snapshot = operations.copySettings(source.id);
    expect(snapshot.groups.curves.rgb[0]).toEqual({ x: 0, y: 0 });
    snapshot.groups.basic.exposure = 99;
    expect(operations.clipboard.getSnapshot()!.groups.basic.exposure).toBe(1.25);
  });

  it('cancels pending atomic auto paste on target changes or switch-away-and-back', async () => {
    for (const change of ['settings', 'switch-back']) {
      let finish!: (samples: number[][]) => void;
      const { documents, history, operations, source, target } = setup(() => new Promise(resolve => { finish = resolve; }));
      source.settings.whiteBalance = { mode: 'auto' };
      operations.copySettings(source.id);
      const pending = operations.pasteSettings(target.id, ['basic'], true);
      if (change === 'settings') operations.setParameter({ documentId: target.id, parameterId: 'contrast', value: 20, source: 'manual' });
      else { documents.setActiveDocument(source.id); documents.setActiveDocument(target.id); }
      finish(Array.from({ length: 100 }, () => [.24, .2, .17]));
      await expect(pending).rejects.toThrow(/cancelled/);
      expect(documents.getDevelopDocument(target.id)!.settings.exposure).toBe(0);
      expect(history.getHistory()).toHaveLength(change === 'settings' ? 1 : 0);
    }
  });

  it('does not abort an unrelated transaction when a new gesture replaced the curve gesture', () => {
    const { documents, history, operations, target } = setup();
    operations.beginCurveChange(target.id);
    operations.previewCurves(target.id, { ...target.settings.curves, rgb: [{ x: 0, y: .1 }, { x: 1, y: 1 }] });
    operations.beginParameterChange(target.id, 'contrast');
    operations.previewParameterChange(target.id, 'contrast', 20);
    operations.abortCurveChange();
    expect(documents.getDevelopDocument(target.id)!.settings.contrast).toBe(20);
    operations.commitParameterChange();
    expect(history.getHistory()).toHaveLength(2);
  });

  it('transfers every selected group through project reopening and native export without source metadata', async () => {
    const { documents, history, operations, source, target } = setup();
    Object.assign(source.settings, { texture: 17, clarity: -12, dehaze: 5, vibrance: 20, saturation: -10 });
    source.settings.hsl.blue = { hue: 25, saturation: -20, luminance: 15 };
    source.settings.curves.rgb = [{ x: 0, y: 0 }, { x: .5, y: .7 }, { x: 1, y: 1 }];
    source.settings.detail = { sharpenAmount: 30, sharpenRadius: 1.5, sharpenThreshold: 3, lumaDenoise: 12, chromaDenoise: 18 };
    source.settings.optics = { vignetteAmount: -25, vignetteMidpoint: 65 };
    target.nativeAssetId = 'target-resource';
    target.sourceUri = 'C:/photos/target.raw';
    target.exif.cameraModel = 'target-camera';
    operations.copySettings(source.id);
    await operations.pasteSettings(target.id, ['basic', 'color', 'curves', 'detail', 'optics']);
    const pasted = documents.getDevelopDocument(target.id)!;
    expect(pasted.settings).toMatchObject({ exposure: 1.25, texture: 17, clarity: -12, dehaze: 5, vibrance: 20, saturation: -10,
      hsl: { blue: { hue: 25, saturation: -20, luminance: 15 } }, detail: source.settings.detail, optics: source.settings.optics, curves: source.settings.curves });
    expect(pasted.nativeAssetId).toBe('target-resource');
    expect(pasted.exif.cameraModel).toBe('target-camera');
    const assets = new AssetManager();
    const payload = await buildNativeDevelopPayload(pasted.settings, assets);
    expect(payload).toMatchObject({ exposure: 1.25, contrast: 12, texture: 17, sharpen_amount: 30, sharpen_radius: 1.5, luma_denoise: 12, vignette_amount: -25, vignette_midpoint: 65 });
    expect(payload.curve_lut[512 * 4]).toBeGreaterThan(.6);
    const serializer = new DevelopProjectSerializer();
    const json = await serializer.serialize(pasted, assets);
    expect(json).not.toContain('copiedAt');
    expect(json).not.toContain('sourceDocumentId');
    const reopened = await serializer.hydrate(json, new AssetManager(), { getRawMetadata: async () => ({ width: 100, height: 100 }) } as never);
    const reopenedPayload = await buildNativeDevelopPayload(reopened.settings, new AssetManager());
    expect(reopenedPayload).toEqual(payload);
    history.undo();
    expect(documents.getDevelopDocument(target.id)!.settings.exposure).toBe(0);
  });

  it.each(['empty-replaced', 'empty-committed', 'explicit-abort'].flatMap(finish => ['preview', 'commit', 'abort'].map(action => ({ finish, action }))))('stale curve $action cannot mutate another service transaction after $finish', ({ finish, action }) => {
    const { documents, history, operations, target } = setup();
    const other = new DevelopOperationService(documents, history);
    operations.beginCurveChange(target.id);
    if (finish === 'empty-committed') history.commitTransaction();
    if (finish === 'explicit-abort') {
      operations.previewCurves(target.id, { ...target.settings.curves, rgb: [{ x: 0, y: .1 }, { x: 1, y: 1 }] });
      history.abortTransaction();
    }
    other.beginParameterChange(target.id, 'contrast');
    other.previewParameterChange(target.id, 'contrast', 20);
    if (action === 'preview') expect(() => operations.previewCurves(target.id, { ...target.settings.curves, rgb: [{ x: 0, y: .2 }, { x: 1, y: 1 }] })).toThrow(/transaction/i);
    if (action === 'commit') operations.commitCurveChange();
    if (action === 'abort') operations.abortCurveChange();
    expect(history.getHistory()).toHaveLength(0);
    expect(documents.getDevelopDocument(target.id)!.settings.contrast).toBe(20);
    expect(documents.getDevelopDocument(target.id)!.settings.curves.rgb[0].y).toBe(0);
    other.previewParameterChange(target.id, 'contrast', 30);
    other.commitParameterChange();
    expect(history.getHistory()).toHaveLength(1);
    history.undo();
    expect(documents.getDevelopDocument(target.id)!.settings.contrast).toBe(0);
  });

  it('accepts the native DC-S5M2 three-channel tuple and preserves the unused fourth multiplier', async () => {
    const { documents, history, operations, source, target } = setup();
    source.settings.whiteBalance = { mode: 'as-shot', cameraMultipliers: [2, 1, 3, 1] };
    target.settings.whiteBalance.cameraMultipliers = [525, 256, 499, 0];
    operations.copySettings(source.id);
    await operations.pasteSettings(target.id, ['basic'], true);
    expect(documents.getDevelopDocument(target.id)!.settings.whiteBalance).toMatchObject({ mode: 'as-shot', cameraMultipliers: [525, 256, 499, 0] });
    history.undo();
    expect(documents.getDevelopDocument(target.id)!.settings.whiteBalance.cameraMultipliers).toEqual([525, 256, 499, 0]);
    history.redo();
    expect(documents.getDevelopDocument(target.id)!.settings.whiteBalance.cameraMultipliers).toEqual([525, 256, 499, 0]);
  });

  it.each([[0, 256, 499, 0], [525, -1, 499, 0], [525, 256, NaN, 0], [525, 256, 499, -1], [525, 256, 499, Infinity]])('rejects corrupt target camera multiplier tuple %j atomically', async tuple => {
    const { documents, history, operations, source, target } = setup();
    source.settings.whiteBalance = { mode: 'as-shot' };
    target.settings.whiteBalance.cameraMultipliers = tuple as [number, number, number, number];
    operations.copySettings(source.id);
    await expect(operations.pasteSettings(target.id, ['basic'], true)).rejects.toThrow(/target/i);
    expect(documents.getDevelopDocument(target.id)!.settings.exposure).toBe(0);
    expect(history.canUndo()).toBe(false);
  });
});
