import { expect, it } from 'vitest';
import { AgentRuntime } from './AgentRuntime';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ToolRegistry } from '../tools/ToolRegistry';
import { PermissionGuard } from '../permissions/PermissionGuard';
import { VisionInspector } from '../vision/VisionInspector';
import { DocumentManager } from '../../document/DocumentManager';
import { createDevelopDocument } from '../../document/DevelopDocument';
import { CommandBus } from '../../history/CommandBus';
import { DevelopOperationService } from '../../develop/DevelopOperationService';
import type { AgentMessage, CanonicalToolSchema } from '../types';
import type { IAIProvider } from '../providers/IAIProvider';
import { SetExposureCommand } from '../../commands/develop/SetExposureCommand';

function setup() {
  const docs = new DocumentManager();
  const doc = createDevelopDocument({ sourceUri: 'photo.jpg', fileName: 'photo.jpg', isRaw: false });
  docs.openDocument(doc);
  const bus = new CommandBus(docs);
  const providers = new ProviderRegistry();
  const guard = new PermissionGuard();
  return { docs, doc, bus, providers, guard, runtime: new AgentRuntime(providers, new ToolRegistry(), guard, new VisionInspector(), bus, docs) };
}

it('cancels after a provider returns late without executing the returned tool', async () => {
  const { providers, runtime, bus, docs, doc } = setup();
  let complete!: (response: AgentMessage) => void;
  const waiting = new Promise<AgentMessage>(resolve => { complete = resolve; });
  providers.getProvider = () => ({ chat: () => waiting }) as unknown as IAIProvider;
  const pending = runtime.run('Adjust exposure', { includeVision: false });
  runtime.cancelActiveRun();
  complete({ role: 'assistant', toolCalls: [{ id: 'late', name: 'develop_set_exposure', arguments: { value: 1 } }] });
  const result = await pending;
  expect(result.status).toBe('cancelled');
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
  expect(bus.getHistory()).toHaveLength(0);
});

it('does not apply a late agent tool to a different active photo', async () => {
  const { providers, runtime, bus, docs, doc } = setup();
  let complete!: (response: AgentMessage) => void;
  providers.getProvider = () => ({ chat: () => new Promise<AgentMessage>(resolve => { complete = resolve; }) }) as unknown as IAIProvider;
  const pending = runtime.run('Adjust this photo', { includeVision: false });
  const other = createDevelopDocument({ sourceUri: 'other.jpg', fileName: 'other.jpg', isRaw: false });
  docs.openDocument(other);
  complete({ role: 'assistant', toolCalls: [{ id: 'late', name: 'develop_set_exposure', arguments: { value: 1 } }] });
  const result = await pending;
  expect(result.status).toBe('cancelled');
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
  expect(docs.getDevelopDocument(other.id)!.settings.exposure).toBe(0);
  expect(bus.getHistory()).toHaveLength(0);
});

it('does not apply a late agent tool after the photo was manually changed', async () => {
  const { providers, runtime, bus, docs, doc } = setup();
  let complete!: (response: AgentMessage) => void;
  providers.getProvider = () => ({ chat: () => new Promise<AgentMessage>(resolve => { complete = resolve; }) }) as unknown as IAIProvider;
  const pending = runtime.run('Adjust this photo', { includeVision: false });
  new DevelopOperationService(docs, bus).setParameter({ documentId: doc.id, parameterId: 'contrast', value: 15, source: 'manual' });
  complete({ role: 'assistant', toolCalls: [{ id: 'late', name: 'develop_set_exposure', arguments: { value: 1 } }] });
  const result = await pending;
  expect(result.status).toBe('cancelled');
  expect(docs.getDevelopDocument(doc.id)!.settings.contrast).toBe(15);
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
  expect(bus.getHistory().map(entry => entry.agentRunId)).toEqual([undefined]);
});

it('preserves manual changes and reports the blocked rollback when cancellation follows an AI edit', async () => {
  const { providers, runtime, bus, docs, doc } = setup();
  let finish!: (response: AgentMessage) => void;
  let reached!: () => void;
  const reachedSecond = new Promise<void>(resolve => { reached = resolve; });
  let calls = 0;
  providers.getProvider = () => ({ chat: async () => {
    if (++calls === 1) return { role: 'assistant', toolCalls: [{ id: 'first', name: 'develop_set_exposure', arguments: { value: 1 } }] };
    reached();
    return new Promise<AgentMessage>(resolve => { finish = resolve; });
  } }) as unknown as IAIProvider;
  const pending = runtime.run('Adjust exposure', { includeVision: false });
  await reachedSecond;
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(1);
  new DevelopOperationService(docs, bus).setParameter({ documentId: doc.id, parameterId: 'exposure', value: 2, source: 'manual' });
  runtime.cancelActiveRun();
  finish({ role: 'assistant', content: 'Finished.' });
  const result = await pending;
  expect(result.status).toBe('cancelled');
  expect(result.rollbackBlockedReason).toContain('保留');
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(2);
  expect(bus.getHistory().map(entry => entry.agentRunId)).toEqual([result.runId, undefined]);
  expect(runtime.undoRun(result.runId)).toBe(false);
  expect(result.actions[0].status).toBe('success');
});

it('does not execute a tool after cancellation during its confirmation', async () => {
  const { providers, runtime, guard, docs, doc, bus } = setup();
  let accept!: (allowed: boolean) => void;
  let reached!: () => void;
  const confirming = new Promise<void>(resolve => { reached = resolve; });
  guard.setLevel('ask');
  guard.setConfirmationHandler(() => { reached(); return new Promise(resolve => { accept = resolve; }); });
  providers.getProvider = () => ({ chat: async () => ({ role: 'assistant', toolCalls: [{ id: 'ask', name: 'develop_set_exposure', arguments: { value: 1 } }] }) }) as unknown as IAIProvider;
  const pending = runtime.run('Adjust exposure', { includeVision: false });
  await confirming;
  runtime.cancelActiveRun();
  accept(true);
  const result = await pending;
  expect(result.status).toBe('cancelled');
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
  expect(bus.getHistory()).toHaveLength(0);
});

it('cancels and rolls back if the final async tool completes after cancellation', async () => {
  const { providers, docs, doc, bus } = setup();
  let finish!: () => void;
  let reached!: () => void;
  const executing = new Promise<void>(resolve => { reached = resolve; });
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const registry = new ToolRegistry();
  const tool = registry.get('develop_set_exposure')!;
  tool.execute = async (context, _args, callId) => {
    reached(); await waiting;
    const command = new SetExposureCommand(doc.id, 1, docs);
    await context.commandBus.execute(command);
    return { success: true, toolCallId: callId, commandId: command.id, renderRequired: true };
  };
  const asyncRuntime = new AgentRuntime(providers, registry, new PermissionGuard(), new VisionInspector(), bus, docs);
  providers.getProvider = () => ({ chat: async () => ({ role: 'assistant', toolCalls: [{ id: 'async', name: 'develop_set_exposure', arguments: { value: 1 } }] }) }) as unknown as IAIProvider;
  const pending = asyncRuntime.run('Adjust exposure', { includeVision: false, maxSteps: 1 });
  await executing;
  asyncRuntime.cancelActiveRun();
  finish();
  const result = await pending;
  expect(result.status).toBe('cancelled');
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(0);
  expect(bus.getHistory()).toHaveLength(0);
});

it('rejects a stale async tool before its command can overwrite a manual edit', async () => {
  const { providers, docs, doc, bus } = setup();
  let finish!: () => void;
  let reached!: () => void;
  const executing = new Promise<void>(resolve => { reached = resolve; });
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const registry = new ToolRegistry();
  registry.get('develop_set_exposure')!.execute = async (context, _args, callId) => {
    reached(); await waiting;
    const command = new SetExposureCommand(doc.id, 1, docs);
    await context.commandBus.execute(command);
    return { success: true, toolCallId: callId, commandId: command.id, renderRequired: true };
  };
  const runtime = new AgentRuntime(providers, registry, new PermissionGuard(), new VisionInspector(), bus, docs);
  providers.getProvider = () => ({ chat: async () => ({ role: 'assistant', toolCalls: [{ id: 'async', name: 'develop_set_exposure', arguments: { value: 1 } }] }) }) as unknown as IAIProvider;
  const pending = runtime.run('Adjust exposure', { includeVision: false, maxSteps: 1 });
  await executing;
  new DevelopOperationService(docs, bus).setParameter({ documentId: doc.id, parameterId: 'exposure', value: 2, source: 'manual' });
  finish();
  const result = await pending;
  expect(result.status).toBe('cancelled');
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(2);
  expect(bus.getHistory().map(entry => entry.agentRunId)).toEqual([undefined]);
});

it('allows its own edits and explicit document creation without mistaking them for manual changes', async () => {
  const { providers, runtime, docs, doc } = setup();
  let calls = 0;
  providers.getProvider = () => ({ chat: async () => ++calls === 1
    ? { role: 'assistant', toolCalls: [{ id: 'tone', name: 'develop_set_exposure', arguments: { value: 1 } },
      { id: 'create', name: 'create_document', arguments: { kind: 'develop', name: 'next', width: 32, height: 32 } }] }
    : { role: 'assistant', content: 'Done.' }
  }) as unknown as IAIProvider;
  const result = await runtime.run('Adjust this photo then create another', { includeVision: false });
  expect(result.status).toBe('partial');
  expect(result.verification?.pending).toContain('Visual verification unavailable');
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(1);
  expect(docs.getActiveDocument()?.id).not.toBe(doc.id);
});

it('refreshes tool schemas and context after creating a document in another workspace', async () => {
  const { providers, runtime, docs } = setup();
  let calls = 0;
  providers.getProvider = () => ({ chat: async (messages: AgentMessage[], schemas: CanonicalToolSchema[]) => {
    if (++calls === 1) return { role: 'assistant', toolCalls: [{ id: 'create', name: 'create_document', arguments: { kind: 'edit', name: 'Poster', width: 32, height: 32 } }] };
    expect(schemas.some(tool => tool.name.startsWith('edit_'))).toBe(true);
    expect(schemas.some(tool => tool.name === 'develop_set_exposure')).toBe(false);
    expect(messages[0].content).toContain('Workspace: edit');
    expect(messages[0].content).toContain('Poster');
    return { role: 'assistant', content: 'Ready to edit the poster.' };
  } }) as unknown as IAIProvider;
  const result = await runtime.run('Create a poster', { includeVision: false });
  expect(result.status).toBe('partial');
  expect(result.verification?.pending).toContain('Visual verification unavailable');
  expect(docs.getActiveDocument()?.kind).toBe('edit');
});

it('does not accept a manual edit made while an agent save was in flight', async () => {
  const { providers, docs, doc, bus } = setup();
  let finish!: () => void;
  let reached!: () => void;
  const saving = new Promise<void>(resolve => { reached = resolve; });
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const registry = new ToolRegistry();
  registry.get('system_save_project')!.execute = async (_context, _args, callId) => {
    const savedSnapshot = docs.getDocument(doc.id)!;
    reached(); await waiting;
    docs.markSaved(doc.id, savedSnapshot);
    return { success: true, toolCallId: callId, renderRequired: false };
  };
  const guard = new PermissionGuard();
  guard.setConfirmationHandler(async () => true);
  const runtime = new AgentRuntime(providers, registry, guard, new VisionInspector(), bus, docs);
  providers.getProvider = () => ({ chat: async () => ({ role: 'assistant', toolCalls: [
    { id: 'save', name: 'system_save_project', arguments: { documentId: doc.id, path: 'C:\\poster.lsq' } },
    { id: 'tone', name: 'develop_set_exposure', arguments: { value: 1 } },
  ] }) }) as unknown as IAIProvider;
  const pending = runtime.run('Save and adjust', { includeVision: false, maxSteps: 1 });
  await saving;
  new DevelopOperationService(docs, bus).setParameter({ documentId: doc.id, parameterId: 'exposure', value: 2, source: 'manual' });
  finish();
  const result = await pending;
  expect(result.status).toBe('cancelled');
  expect(docs.getDevelopDocument(doc.id)!.settings.exposure).toBe(2);
});
