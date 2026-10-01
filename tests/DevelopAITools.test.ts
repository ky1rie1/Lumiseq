import { describe, expect, it, vi } from 'vitest';
import { defaultToolRegistry } from '../src/ai/tools/ToolRegistry';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { IToolContext } from '../src/ai/tools/CanonicalTool';
import { getPlatformBridge } from '../src/platform';

function setup() {
  const documentManager = new DocumentManager();
  const commandBus = new CommandBus(documentManager);
  const doc = createDevelopDocument({ fileName: 'photo.raw', sourceUri: 'photo.raw', fileSizeBytes: 100, isRaw: true });
  documentManager.openDocument(doc, true);
  const context: IToolContext = { documentManager, commandBus, currentWorkspace: 'develop' };
  const run = (name: string, args: Record<string, unknown>) => defaultToolRegistry.get(name)!.execute(context, args, 'call-1');
  return { doc, documentManager, commandBus, run };
}

describe('AI develop tools', () => {
  it('uses the shared source analysis for auto white balance with undo', async () => {
    const { doc, documentManager, commandBus, run } = setup();
    documentManager.updateDocument({ ...doc, nativeAssetId: 'decoded-fixture', rawState: 'ready' });
    const sample = vi.spyOn(getPlatformBridge(), 'getRawLinearSample').mockResolvedValue(
      Array.from({ length: 100 }, () => [.24, .2, .17]));
    try {
      const tool = defaultToolRegistry.get('develop_set_white_balance');
      expect(tool).toBeDefined();
      const result = await run('develop_set_white_balance', { mode: 'auto' });
      expect(result.success).toBe(true);
      expect(result.commandId).toBeTruthy();
      expect(documentManager.getDevelopDocument(doc.id)!.settings.whiteBalance.resolvedAuto?.status).toBe('resolved');
      commandBus.undo();
      expect(documentManager.getDevelopDocument(doc.id)!.settings.whiteBalance.mode).toBe('as-shot');
    } finally { sample.mockRestore(); }
  });
  it('reports exact RAW parameter bounds on demand', async () => {
    const { run } = setup();
    const result = await run('get_develop_parameter_specs', { parameterIds: ['exposure', 'temperature'] });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ exposure: { min: -5, max: 5, step: 0.05, unit: 'EV' },
      temperature: { min: 2000, max: 12000, step: 50, unit: 'K' } });
    const invalid = await run('get_develop_parameter_specs', { parameterIds: ['made-up'] });
    expect(invalid.error?.code).toBe('INVALID_ARGUMENT');
  });

  it('uses the shared service for a generic nested develop parameter and history', async () => {
    const { doc, documentManager, commandBus, run } = setup();
    const result = await run('develop_set_parameter', { parameterId: 'hslHue', channel: 'blue', value: 27 });
    expect(result.success).toBe(true);
    expect(result.commandId).toBeTruthy();
    expect(documentManager.getDevelopDocument(doc.id)?.settings.hsl.blue.hue).toBe(27);
    commandBus.undo();
    expect(documentManager.getDevelopDocument(doc.id)?.settings.hsl.blue.hue).toBe(0);
  });

  it('keeps named tools and exposure value alias, with validated limits', async () => {
    const { doc, documentManager, run } = setup();
    expect((await run('develop_set_exposure', { value: 0.75 })).success).toBe(true);
    expect(documentManager.getDevelopDocument(doc.id)?.settings.exposure).toBe(0.75);
    const invalid = await run('develop_set_exposure', { exposure: 50 });
    expect(invalid.success).toBe(false);
    expect(invalid.error?.code).toBe('INVALID_ARGUMENT');
    expect(documentManager.getDevelopDocument(doc.id)?.settings.exposure).toBe(0.75);
  });

  it('returns tool errors for missing, nonfinite, or unknown parameter values', async () => {
    const { run } = setup();
    for (const args of [
      { parameterId: 'exposure' },
      { parameterId: 'exposure', value: Infinity },
      { parameterId: 'bogus', value: 1 },
      { parameterId: 'hslHue', value: 1 },
    ]) {
      const result = await run('develop_set_parameter', args);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_ARGUMENT');
    }
  });

  it('creates, adjusts, updates, and deletes a local mask through command history', async () => {
    const { doc, documentManager, commandBus, run } = setup();
    const created = await run('develop_create_mask', {
      kind: 'radial', name: 'Face', geometry: { center: { x: 0.5, y: 0.5 }, radiusX: 0.2, radiusY: 0.3 },
    });
    expect(created.success).toBe(true);
    expect(created.commandId).toBeTruthy();
    const maskId = created.after.maskId as string;
    expect(documentManager.getDevelopDocument(doc.id)?.settings.masks[0].maskAssetId).toBeTruthy();
    expect((await run('develop_set_mask_parameter', { maskId, parameterId: 'exposure', value: 1.2 })).success).toBe(true);
    expect(documentManager.getDevelopDocument(doc.id)?.settings.masks[0].exposure).toBe(1.2);
    expect((await run('develop_update_mask', { maskId, name: 'Subject', opacity: 0.6 })).success).toBe(true);
    expect(documentManager.getDevelopDocument(doc.id)?.settings.masks[0].name).toBe('Subject');
    expect((await run('develop_delete_mask', { maskId })).success).toBe(true);
    expect(documentManager.getDevelopDocument(doc.id)?.settings.masks).toHaveLength(0);
    commandBus.undo();
    expect(documentManager.getDevelopDocument(doc.id)?.settings.masks[0].id).toBe(maskId);
  });

  it('returns tool errors for invalid local edits without changing the document', async () => {
    const { doc, documentManager, run } = setup();
    const result = await run('develop_create_mask', { kind: 'unknown', name: 'Bad', geometry: {} });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_ARGUMENT');
    const badGeometry = await run('develop_create_mask', {
      kind: 'radial', name: 'Bad radius', geometry: { center: { x: 0.5, y: 0.5 }, radiusX: 'large' },
    });
    expect(badGeometry.success).toBe(false);
    expect(badGeometry.error?.code).toBe('INVALID_ARGUMENT');
    const missing = await run('develop_set_mask_parameter', { maskId: 'missing', parameterId: 'exposure', value: 1 });
    expect(missing.success).toBe(false);
    expect(documentManager.getDevelopDocument(doc.id)?.settings.masks).toHaveLength(0);
  });
});
