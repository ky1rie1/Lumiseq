import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { defaultToolRegistry } from '../src/ai/tools/ToolRegistry';
import { IToolContext } from '../src/ai/tools/CanonicalTool';
import { DevelopOperationService } from '../src/develop/DevelopOperationService';
import { DevelopSettingsClipboard } from '../src/develop/DevelopSettingsClipboard';

function setup() {
  const documentManager = new DocumentManager();
  const commandBus = new CommandBus(documentManager);
  const source = createDevelopDocument({ sourceUri: 'source.raw', fileName: 'source.raw', isRaw: true });
  source.settings.exposure = 1.25;
  source.settings.whiteBalance = { mode: 'custom', temperature: 5000, tint: 12 };
  const target = createDevelopDocument({ sourceUri: 'target.raw', fileName: 'target.raw', isRaw: true });
  target.settings.whiteBalance = { mode: 'custom', temperature: 6500, tint: -8, cameraMultipliers: [3, 1, 2, 1] };
  documentManager.openDocument(source);
  documentManager.openDocument(target, true);
  const clipboard = new DevelopSettingsClipboard();
  const context: IToolContext = { documentManager, commandBus, currentWorkspace: 'develop', developSettingsClipboard: clipboard };
  const operations = new DevelopOperationService(documentManager, commandBus, undefined, undefined, clipboard);
  const run = (name: string, args: Record<string, unknown>) => defaultToolRegistry.get(name)!.execute(context, args, 'task3-call');
  return { documentManager, commandBus, source, target, context, operations, run };
}

describe('canonical RAW precision tools', () => {
  it('shares the clipboard with UI, copy is read-only, paste is one equivalent command', async () => {
    const { source, target, documentManager, commandBus, operations, run } = setup();
    expect(defaultToolRegistry.get('develop_copy_settings')).toBeDefined();
    const copied = await run('develop_copy_settings', { documentId: source.id });
    expect(copied.success).toBe(true);
    expect(copied.renderRequired).toBe(false);
    expect(commandBus.getHistory()).toHaveLength(0);
    await operations.pasteSettings(target.id, ['basic'], true);
    const manual = structuredClone(documentManager.getDevelopDocument(target.id)!.settings);
    commandBus.undo();
    operations.copySettings(source.id);
    const pasted = await run('develop_paste_settings', { documentId: target.id, groups: ['basic'], includeWB: true });
    expect(pasted.success).toBe(true);
    expect(pasted.commandId).toBeTruthy();
    expect(documentManager.getDevelopDocument(target.id)!.settings).toEqual(manual);
    commandBus.undo();
    expect(documentManager.getDevelopDocument(target.id)!.settings.whiteBalance.temperature).toBe(6500);
  });

  it('routes curve/paste writes through the injected task bus and permits task rollback', async () => {
    const { source, target, context, commandBus, documentManager, operations, run } = setup();
    expect(defaultToolRegistry.get('develop_set_curves')).toBeDefined();
    const before = structuredClone(target.settings);
    operations.copySettings(source.id);
    commandBus.beginAgentRun('raw-task', 'RAW task');
    context.commandBus = commandBus.forAgentRun('raw-task');
    const curves = { ...before.curves, rgb: [{ x: 0, y: 0 }, { x: .5, y: .7 }, { x: 1, y: 1 }] };
    expect((await run('develop_set_curves', { documentId: target.id, curves })).success).toBe(true);
    expect((await run('develop_paste_settings', { documentId: target.id, groups: ['basic'] })).success).toBe(true);
    expect(commandBus.getHistory().map(entry => entry.agentRunId)).toEqual(['raw-task', 'raw-task']);
    commandBus.rollbackAgentRun('raw-task');
    expect(documentManager.getDevelopDocument(target.id)!.settings).toEqual(before);
    expect((await run('develop_set_curves', { documentId: target.id, curves })).success).toBe(false);
  });

  it('exposes explicit MCP names with nested point schemas and rejects invalid writes atomically', async () => {
    const { target, documentManager, commandBus, run } = setup();
    const schemas = defaultToolRegistry.getMCPSchemas('develop');
    expect(schemas.find(schema => schema.name === 'studio_set_curves')?.inputSchema.properties?.curves.properties.rgb.items.required).toEqual(['x', 'y']);
    expect(schemas.some(schema => schema.name === 'studio_copy_settings')).toBe(true);
    expect(schemas.find(schema => schema.name === 'studio_paste_settings')?.inputSchema.required).toEqual(['documentId', 'groups']);
    for (const [name, args] of [
      ['develop_set_curves', { curves: { ...target.settings.curves, rgb: [{ x: .5, y: 0 }, { x: .5, y: 1 }] } }],
      ['develop_paste_settings', { groups: ['masks'] }],
      ['develop_paste_settings', { groups: ['basic'], includeWB: 'yes' }],
    ] as const) {
      const result = await run(name, { ...args, documentId: target.id });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_ARGUMENT');
    }
    expect(documentManager.getDevelopDocument(target.id)!.settings.exposure).toBe(0);
    expect(commandBus.getHistory()).toHaveLength(0);
  });

  it('requires explicit source/target IDs even for direct tool execution', async () => {
    const { target, commandBus, run } = setup();
    for (const documentId of [undefined, 99, '']) {
      for (const [name, args] of [
        ['develop_set_curves', { curves: target.settings.curves }],
        ['develop_copy_settings', {}],
        ['develop_paste_settings', { groups: ['basic'] }],
      ] as const) {
        const result = await run(name, { ...args, documentId });
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('INVALID_ARGUMENT');
      }
    }
    expect(commandBus.getHistory()).toHaveLength(0);
  });
});
