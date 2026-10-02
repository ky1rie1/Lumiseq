import { afterEach, expect, it, vi } from 'vitest';
import { AgentRuntime } from './AgentRuntime';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { ToolRegistry } from '../tools/ToolRegistry';
import { PermissionGuard } from '../permissions/PermissionGuard';
import { VisionInspector } from '../vision/VisionInspector';
import { DocumentObservationService } from '../vision/DocumentObservationService';
import { CapabilityRouter } from '../capabilities/CapabilityRouter';
import { DocumentManager } from '../../document/DocumentManager';
import { createEditDocument, createImageLayer } from '../../document/EditDocument';
import { CommandBus } from '../../history/CommandBus';
import { CandidateService } from '../harness/CandidateService';
import type { IAIProvider } from '../providers/IAIProvider';
import type { DocumentObservationRenderPort } from '../vision/observationTypes';
import { AssetManager } from '../../assets/AssetManager';
import { ProjectSerializer } from '../../project/ProjectSerializer';
import { RenameLayerCommand } from '../../commands/edit/RenameLayerCommand';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture() {
  // These tests exercise candidate lifecycle, not installed system fonts.
  // Keep text measurement deterministic; the verifier still checks both bounds.
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
    font: '10px Fixture',
    measureText(text: string) {
      const fontSize = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 10);
      return { width: Array.from(text).length * fontSize * 0.5 };
    },
  }) }) });
  const documents = new DocumentManager();
  documents.openDocument(createEditDocument({ id: 'poster', width: 100, height: 80, layers: [
    createImageLayer({ id: 'background', name: 'Background', sourceAssetId: 'shared', naturalWidth: 100, naturalHeight: 80 }),
  ] }));
  const commandBus = new CommandBus(documents), toolRegistry = new ToolRegistry(), providerRegistry = new ProviderRegistry();
  const permissionGuard = new PermissionGuard(); permissionGuard.setLevel('full');
  const renderer: DocumentObservationRenderPort = { async render(doc, geometry) {
    return { data: btoa(`${doc.kind === 'edit' ? doc.layers.length : 0}:${geometry.width}`), mimeType: geometry.mimeType, approximate: false };
  } };
  const observationService = new DocumentObservationService({ documents, renderer });
  const candidateService = new CandidateService({ documents, commandBus, toolRegistry, observationService, permissionGuard, previewRenderer: renderer });
  const provider = { capabilities: { vision: true }, chat: async () => ({ role: 'assistant', content: JSON.stringify({ candidates: [
    { label: 'A', reason: 'Clear headline', operations: [{ name: 'edit_create_text_layer', args: { documentId: 'poster', text: 'A' } }] },
    { label: 'B', reason: 'Quiet headline', operations: [{ name: 'edit_create_text_layer', args: { documentId: 'poster', text: 'B' } }] },
  ] }) }) } as unknown as IAIProvider;
  providerRegistry.getProvider = () => provider;
  const router = new CapabilityRouter(providerRegistry); router.setPrivacyMode('allow');
  const runtime = new AgentRuntime(providerRegistry, toolRegistry, permissionGuard, new VisionInspector(), commandBus, documents,
    { observationService, capabilityRouter: router, candidateService });
  return { runtime, documents, commandBus, candidateService, provider, toolRegistry, permissionGuard };
}

it('keeps exploration awaiting a user choice and applies only the chosen recorded plan', async () => {
  const f = fixture();
  const before = JSON.stringify(f.documents.getActiveDocument());
  const run = await f.runtime.run('Balance the layout', { taskKind: 'layout', explore: true });
  expect(run.status).toBe('awaiting_selection');
  expect(f.commandBus.getHistory()).toEqual([]);
  const choices = f.runtime.getCandidateSet(run.runId)!;
  expect(choices.candidates).toHaveLength(2);
  expect(JSON.stringify(f.documents.getActiveDocument())).not.toBe(before); // project AI history only
  expect(f.documents.getEditDocument('poster')!.layers).toHaveLength(1);
  await f.runtime.chooseCandidate(choices.candidates[1].id);
  const chosenLayer = f.documents.getEditDocument('poster')!.layers[1];
  expect(chosenLayer.type === 'text' ? chosenLayer.text : undefined).toBe('B');
  expect(f.runtime.getRun(run.runId)?.status).toBe('completed');
  expect(f.commandBus.getHistory().every(entry => entry.agentRunId === run.runId)).toBe(true);
  expect(f.runtime.undoRun(run.runId)).toBe(true);
  expect(f.documents.getEditDocument('poster')!.layers).toHaveLength(1);
});

it.each([0, 1])('refuses overlapping choice %i without interrupting the admitted replay', async secondIndex => {
  const f = fixture();
  const run = await f.runtime.run('Balance the layout', { taskKind: 'layout', explore: true, includeVision: false });
  const candidates = f.runtime.getCandidateSet(run.runId)!.candidates;
  let entered!: () => void, release!: (allowed: boolean) => void;
  const atPermission = new Promise<void>(resolve => { entered = resolve; });
  const confirmation = new Promise<boolean>(resolve => { release = resolve; });
  f.permissionGuard.setLevel('ask');
  f.permissionGuard.setConfirmationHandler(() => { entered(); return confirmation; });
  const completions: string[] = [];
  f.runtime.subscribe(event => { if (event.type === 'run_completed') completions.push(event.run!.status); });
  const source = JSON.stringify(f.documents.getActiveDocument());
  const first = f.runtime.chooseCandidate(candidates[0].id).then(value => ({ value }), error => ({ error }));
  await atPermission;
  await expect(f.runtime.chooseCandidate(candidates[secondIndex].id)).rejects.toThrow(/already in progress/i);
  const during = { status: run.status, set: f.runtime.getCandidateSet(run.runId), source: JSON.stringify(f.documents.getActiveDocument()),
    history: f.commandBus.getHistory().length, completions: [...completions] };
  release(true);
  const outcome = await first;
  expect(during.status).toBe('running');
  expect(during.set?.candidates).toHaveLength(2);
  expect(during.source).toBe(source);
  expect(during.history).toBe(0);
  expect(during.completions).toEqual([]);
  expect(outcome).toEqual({ value: run });
  expect(run.status).toBe('completed');
  expect(run.stopReason).toBe('chosen_candidate');
  expect(completions).toEqual(['completed']);
  const history = f.commandBus.getHistory();
  expect(history).toHaveLength(1);
  expect(history[0].agentRunId).toBe(run.runId);
  expect(run.commandIds).toEqual([history[0].command.id]);
  const live = f.documents.getEditDocument('poster')!;
  expect(live.layers).toHaveLength(2);
  expect(live.layers[1].type === 'text' && live.layers[1].text).toBe('A');
  expect(live.aiHistory!.runs.filter(entry => entry.runId === run.runId)).toHaveLength(1);
  expect(live.aiHistory!.runs[0].status).toBe('completed');
});

it('keeps real text overflow pending after choice and save/reopen, reviewing accepted live IDs only', async () => {
  const f = fixture();
  f.provider.chat = async () => ({ role: 'assistant', content: JSON.stringify({ candidates: [
    { label: 'A', reason: 'Two lines', operations: [{ name: 'edit_create_text_layer', args: { documentId: 'poster', text: 'Line 1\nLine 2', fontSize: 24 } }] },
  ] }) });
  const run = await f.runtime.run('Balance layout', { taskKind: 'layout', explore: true, includeVision: false });
  const previewIds = run.actions.filter(action => action.toolName === 'edit_create_text_layer').map(action => action.result!.after!.createdLayerId);
  await f.runtime.chooseCandidate(f.runtime.getCandidateSet(run.runId)!.candidates[0].id);
  expect(run.status).toBe('partial'); expect(run.verification?.aesthetic).toBe('pass');
  expect(run.verification?.pending.join(' ')).toContain('actual text overflows bounds');
  expect(run.verification?.verified.join(' ')).not.toContain(previewIds[0]);
  const saved = await saveAndReopen(f);
  expect(saved.document.aiHistory!.runs[0]).toMatchObject({ status: 'partial', verification: { aesthetic: 'pass' } });
  expect(saved.document.aiHistory!.runs[0].verification?.pending.join(' ')).toContain('actual text overflows bounds');
});

async function heldChoice(f: ReturnType<typeof fixture>, options = {}) {
  f.provider.chat = async () => ({ role: 'assistant', content: JSON.stringify({ candidates: [
    { label: 'A', reason: 'Two titles', operations: ['First', 'Second'].map(text => ({ name: 'edit_create_text_layer', args: { documentId: 'poster', text } })) },
  ] }) });
  const run = await f.runtime.run('Balance layout', { taskKind: 'layout', explore: true, includeVision: false, ...options });
  let entered!: () => void, release!: (allowed: boolean) => void, calls = 0;
  const enteredPermission = new Promise<void>(resolve => { entered = resolve; });
  const permission = new Promise<boolean>(resolve => { release = resolve; });
  f.permissionGuard.setLevel('ask');
  f.permissionGuard.setConfirmationHandler(async () => ++calls === 1 ? true : (entered(), permission));
  const choice = f.runtime.chooseCandidate(f.runtime.getCandidateSet(run.runId)!.candidates[0].id).then(value => ({ value }), error => ({ error }));
  await enteredPermission;
  return { run, choice, release };
}
it('refuses a new ordinary run during acceptance without discarding the first choice', async () => {
  const f = fixture(), held = await heldChoice(f);
  expect(f.runtime.getActiveRun()).toBe(held.run);
  await expect(f.runtime.run('Read state', { taskKind: 'precise' })).rejects.toThrow(/already in progress/i);
  expect(f.runtime.getCandidateSet(held.run.runId)).toBeDefined();
  held.release(true); expect(await held.choice).toEqual({ value: held.run });
  expect(held.run.status).toBe('completed'); expect(f.documents.getEditDocument('poster')!.layers).toHaveLength(3);
});
it('cancels held approval, rolls back before admitting another run, and blocks late approval writes', async () => {
  const f = fixture(), held = await heldChoice(f);
  f.runtime.cancelActiveRun();
  await expect(held.choice).resolves.toHaveProperty('error');
  expect(held.run.status).toBe('cancelled'); expect(f.runtime.getActiveRun()).toBeNull();
  expect(f.documents.getEditDocument('poster')!.layers).toHaveLength(1);
  f.provider.chat = async () => ({ role: 'assistant', content: 'Done' });
  const next = await f.runtime.run('Read state', { taskKind: 'precise', includeVision: false });
  held.release(true); await Promise.resolve(); await Promise.resolve();
  expect(next.status).toBe('completed'); expect(f.commandBus.getHistory()).toHaveLength(0);
  expect(f.documents.getEditDocument('poster')!.layers).toHaveLength(1);
});
it('bounds a never-resolving acceptance approval with the original request budget', async () => {
  vi.useFakeTimers(); const f = fixture(), held = await heldChoice(f, { requestTimeoutMs: 5 });
  await vi.advanceTimersByTimeAsync(6);
  expect(await held.choice).toHaveProperty('error'); expect(held.run.stopReason).toBe('provider_timeout');
  expect(f.runtime.getActiveRun()).toBeNull(); expect(f.commandBus.getHistory()).toHaveLength(0);
  held.release(true);
});
it('preserves direct manual state when cancellation interrupts pending replay approval', async () => {
  const f = fixture(), held = await heldChoice(f);
  const current = f.documents.getEditDocument('poster')!;
  f.documents.updateDocument({ ...current, layers: current.layers.map((layer, index) => index === 1 ? { ...layer, name: 'Manual title' } : layer) });
  f.runtime.cancelActiveRun(); await held.choice;
  expect(f.documents.getEditDocument('poster')!.layers).toHaveLength(2);
  expect(f.documents.getEditDocument('poster')!.layers[1].name).toBe('Manual title');
  expect(held.run.commandIds).toEqual(f.commandBus.getHistory().filter(entry => entry.agentRunId === held.run.runId).map(entry => entry.command.id));
  expect(held.run.commandIds).toHaveLength(1);
  held.release(true);
});
it('stops acceptance after the original overall deadline including human selection wait', async () => {
  vi.useFakeTimers(); const f = fixture();
  const run = await f.runtime.run('Balance layout', { taskKind: 'layout', explore: true, includeVision: false, overallTimeoutMs: 10 });
  const id = f.runtime.getCandidateSet(run.runId)!.candidates[0].id;
  await vi.advanceTimersByTimeAsync(11);
  await expect(f.runtime.chooseCandidate(id)).rejects.toThrow('overall_timeout');
  expect(run.stopReason).toBe('overall_timeout'); expect(f.commandBus.getHistory()).toHaveLength(0);
  expect(f.runtime.getActiveRun()).toBeNull();
});
it('cancels a delayed canonical replay tool before its late command can write', async () => {
  const f = fixture();
  const run = await f.runtime.run('Balance layout', { taskKind: 'layout', explore: true, includeVision: false });
  const tool = f.toolRegistry.get('edit_create_text_layer')!, execute = tool.execute.bind(tool);
  let entered!: () => void, release!: () => void, toolSignal: AbortSignal | undefined;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  tool.execute = async (context, args, id) => { toolSignal = context.signal; entered(); await held; return execute(context, args, id); };
  const choice = f.runtime.chooseCandidate(f.runtime.getCandidateSet(run.runId)!.candidates[0].id).catch(error => error);
  await started; f.runtime.cancelActiveRun(); await choice;
  expect(toolSignal?.aborted).toBe(true); expect(f.runtime.getActiveRun()).toBeNull();
  release(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(f.documents.getEditDocument('poster')!.layers).toHaveLength(1); expect(f.commandBus.getHistory()).toHaveLength(0);
});

it('requests critical missing poster copy before any model plan or source edit', async () => {
  const f = fixture();
  const chat = vi.spyOn(f.provider, 'chat');
  const run = await f.runtime.run('Make a premium poster', { taskKind: 'layout' });
  expect(run.stopReason).toBe('critical_content_missing');
  expect(run.response).toContain('文案');
  expect(chat).not.toHaveBeenCalled();
  expect(f.commandBus.getHistory()).toEqual([]);
});

it('discards unchosen candidates when a new task starts', async () => {
  const f = fixture();
  const first = await f.runtime.run('Balance the layout', { taskKind: 'layout', explore: true });
  expect(f.runtime.getCandidateSet(first.runId)?.candidates).toHaveLength(2);
  await f.runtime.run('Balance the layout', { taskKind: 'layout', explore: true });
  expect(f.runtime.getCandidateSet(first.runId)).toBeUndefined();
  expect(f.runtime.getRun(first.runId)?.status).toBe('cancelled');
});

async function saveAndReopen(f: ReturnType<typeof fixture>) {
  const assets = new AssetManager();
  const asset = await assets.registerBlob(new Blob(['original fixture bytes'], { type: 'image/png' }), 'image', 'Reference');
  const document = f.documents.getEditDocument('poster')!;
  const packageDocument = { ...document, layers: document.layers.map(layer => layer.type === 'image' ? { ...layer, sourceAssetId: asset.id } : layer) };
  const serializer = new ProjectSerializer();
  const serialized = await serializer.serialize(packageDocument, assets);
  const reopenedAssets = new AssetManager(), reopenedDocuments = new DocumentManager();
  try {
    return { serialized, document: await serializer.deserialize(serialized, reopenedDocuments, reopenedAssets) };
  } finally { assets.dispose(); reopenedDocuments.closeAll(); reopenedAssets.dispose(); }
}

it('persists final chosen verification through project save and reopen without previews and keeps task undo', async () => {
  const f = fixture();
  const original = structuredClone(f.documents.getEditDocument('poster')!);
  const run = await f.runtime.run('Balance the layout', { taskKind: 'layout', explore: true });
  const candidate = f.runtime.getCandidateSet(run.runId)!.candidates[1];
  await f.runtime.chooseCandidate(candidate.id);
  const saved = await saveAndReopen(f);
  const entries = saved.document.aiHistory!.runs.filter(entry => entry.runId === run.runId);
  expect(entries).toHaveLength(1);
  expect(entries[0].status).toBe('completed');
  expect(entries[0].stopReason).toBe('chosen_candidate');
  expect(entries[0].verification?.pending).toEqual([]);
  expect(entries[0].verification?.verified).toContain('Canonical replay postconditions match the chosen preview');
  expect(entries[0].verification?.aesthetic).toBe('pass');
  expect(entries[0].finishedAt).toBe(run.finishedAt);
  expect(entries[0].journal?.some(entry => entry.fact === 'User selected B')).toBe(true);
  expect(entries[0].commandIds).toEqual([]);
  expect(saved.serialized).not.toContain(candidate.preview);
  expect(f.commandBus.getHistory().every(entry => entry.agentRunId === run.runId)).toBe(true);
  expect(f.runtime.undoRun(run.runId)).toBe(true);
  expect(f.documents.getEditDocument('poster')!.layers).toEqual(original.layers);
  expect(f.documents.getEditDocument('poster')!.selectedLayerId).toBe(original.selectedLayerId);
  expect(f.commandBus.getHistory()).toEqual([]);
});

it('persists discarded cancellation through project save and reopen while preserving manual edits', async () => {
  const f = fixture();
  const run = await f.runtime.run('Balance the layout', { taskKind: 'layout', explore: true });
  const candidate = f.runtime.getCandidateSet(run.runId)!.candidates[0];
  const current = f.documents.getEditDocument('poster')!;
  f.documents.updateDocument({ ...current, layers: current.layers.map(layer => ({ ...layer, name: 'Manual background name' })) });
  const manual = structuredClone(f.documents.getEditDocument('poster')!);
  f.runtime.discardCandidateRun(run.runId);
  const saved = await saveAndReopen(f);
  const entries = saved.document.aiHistory!.runs.filter(entry => entry.runId === run.runId);
  expect(entries).toHaveLength(1);
  expect(entries[0].status).toBe('cancelled');
  expect(entries[0].stopReason).toBe('candidate_discarded');
  expect(entries[0].finishedAt).toBe(run.finishedAt);
  expect(entries[0].verification?.pending).not.toContain('Choose a candidate to apply its edits');
  expect(saved.serialized).not.toContain(candidate.preview);
  expect(f.documents.getEditDocument('poster')!.layers).toEqual(manual.layers);
  expect(f.documents.getEditDocument('poster')!.selectedLayerId).toBe(manual.selectedLayerId);
  expect(f.commandBus.getHistory()).toEqual([]);
  expect(f.runtime.undoRun(run.runId)).toBe(false);
});

it.each([
  { taskKind: 'layout' as const, targetIds: ['background'] },
  { taskKind: 'local-detail' as const, regions: [{ x: 10, y: 10, width: 8, height: 8 }] },
])('stops constrained exploration before planning or source editing: %j', async options => {
  const f = fixture();
  const original = structuredClone(f.documents.getEditDocument('poster')!);
  const run = await f.runtime.run('Balance the layout', { ...options, explore: true, includeVision: false });
  expect(run.status).toBe('partial');
  expect(run.stopReason).toBe('candidate_scope_unsupported');
  expect(run.budget?.modelSteps).toBe(0);
  expect(run.budget?.toolCalls).toBe(0);
  expect(f.runtime.getCandidateSet(run.runId)).toBeUndefined();
  expect(f.documents.getEditDocument('poster')!.layers).toEqual(original.layers);
  expect(f.documents.getEditDocument('poster')!.selectedLayerId).toBe(original.selectedLayerId);
  expect(f.commandBus.getHistory()).toEqual([]);
});

it.each(['direct', 'history', 'history-noop'] as const)('finalizes interrupted acceptance and persists retained commands with %s manual changes', async kind => {
  const f = fixture();
  f.provider.chat = async () => ({ role: 'assistant', content: JSON.stringify({ candidates: [
    { label: 'A', reason: 'Quiet background', operations: [
      { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: 'background', newName: 'Candidate' } },
      { name: 'edit_set_layer_opacity', args: { documentId: 'poster', layerId: 'background', opacity: 0.4 } },
    ] },
  ] }) });
  const run = await f.runtime.run('Balance the layout', { taskKind: 'layout', explore: true, includeVision: false });
  const candidate = f.runtime.getCandidateSet(run.runId)!.candidates[0];
  const tool = f.toolRegistry.get('edit_rename_layer')!, execute = tool.execute.bind(tool);
  vi.spyOn(tool, 'execute').mockImplementationOnce(async (...args) => {
    const result = await execute(...args);
    if (kind !== 'direct') f.commandBus.execute(new RenameLayerCommand('poster', 'background', kind === 'history' ? 'Manual' : 'Candidate', f.documents));
    else f.documents.updateDocument({ ...f.documents.getEditDocument('poster')!, name: 'Manual project' });
    return result;
  });
  const events: string[] = [];
  f.runtime.subscribe(event => events.push(event.type));
  await expect(f.runtime.chooseCandidate(candidate.id)).rejects.toThrow(/manual|changed|stale/i);
  expect(run.status).toBe('partial');
  expect(run.stopReason).toBe('candidate_replay_interrupted');
  const taskHistory = f.commandBus.getHistory().filter(entry => entry.agentRunId === run.runId);
  expect(taskHistory).toHaveLength(1);
  expect(run.commandIds).toEqual(taskHistory.map(entry => entry.command.id));
  expect(run.actions.some(action => action.result?.commandId === run.commandIds[0] && action.status === 'success')).toBe(true);
  expect(run.verification?.pending).not.toContain('Choose a candidate to apply its edits');
  expect(run.verification?.aesthetic).not.toBe('pass');
  expect(f.runtime.getCandidateSet(run.runId)).toBeUndefined();
  expect(events).toContain('run_completed');
  const saved = await saveAndReopen(f);
  expect(saved.document.aiHistory!.runs.filter(entry => entry.runId === run.runId)).toHaveLength(1);
  expect(saved.document.aiHistory!.runs[0]).toMatchObject({ status: 'partial', stopReason: 'candidate_replay_interrupted' });
  expect(f.documents.getEditDocument('poster')!.layers[0].opacity).toBe(1);
  if (kind !== 'direct') {
    expect(f.documents.getEditDocument('poster')!.layers[0].name).toBe(kind === 'history' ? 'Manual' : 'Candidate');
    expect(f.runtime.undoRun(run.runId)).toBe(false);
    expect(run.rollbackBlockedReason).toBeTruthy();
    f.commandBus.undo();
  }
  expect(f.runtime.undoRun(run.runId)).toBe(true);
  expect(f.documents.getEditDocument('poster')!.layers[0].name).toBe('Background');
  if (kind === 'direct') expect(f.documents.getEditDocument('poster')!.name).toBe('Manual project');
});

it('accounts actual preview, image and replay actions against the same budget without replanning', async () => {
  const f = fixture();
  const chat = vi.spyOn(f.provider, 'chat');
  const run = await f.runtime.run('Balance the layout', { taskKind: 'layout', explore: true, includeVision: false, maxToolCalls: 6, maxImages: 3 });
  expect(run.status).toBe('awaiting_selection');
  expect(run.budget).toMatchObject({ modelSteps: 1, toolCalls: 5, images: 3 });
  expect(run.budget!.imageBytes).toBeGreaterThan(0);
  expect(run.actions).toHaveLength(5);
  expect(run.actions.filter(action => action.toolName === 'edit_create_text_layer')).toHaveLength(2);
  const chosen = f.runtime.getCandidateSet(run.runId)!.candidates[1];
  await f.runtime.chooseCandidate(chosen.id);
  expect(chat).toHaveBeenCalledTimes(1);
  expect(run.budget).toMatchObject({ modelSteps: 1, toolCalls: 6, images: 3 });
  expect(run.actions).toHaveLength(6);
  expect(run.actions.filter(action => action.toolName === 'edit_create_text_layer')).toHaveLength(3);
  expect(run.actions.at(-1)).toMatchObject({ toolName: 'edit_create_text_layer', status: 'success', args: { text: 'B' } });
  expect(run.actions.at(-1)!.result?.commandId).toBe(run.commandIds[0]);
  expect(JSON.stringify(run.actions)).not.toContain('data:image');
  expect(f.runtime.undoRun(run.runId)).toBe(true);
});

it.each([
  { maxToolCalls: 0, reason: 'maxToolCalls_exhausted' },
  { maxToolCalls: 5, reason: 'maxToolCalls_exhausted' },
  { maxImages: 2, reason: 'maxImages_exhausted' },
])('reserves chosen replay and preview images before editing: %j', async limits => {
  const f = fixture();
  const original = structuredClone(f.documents.getEditDocument('poster')!);
  const run = await f.runtime.run('Balance the layout', { taskKind: 'layout', explore: true, includeVision: false, ...limits });
  expect(run.status).toBe('budget_exhausted');
  expect(run.stopReason).toBe(limits.reason);
  expect(run.budget?.toolCalls).toBe(0);
  expect(run.budget?.images).toBe(0);
  expect(run.actions).toEqual([]);
  expect(f.runtime.getCandidateSet(run.runId)).toBeUndefined();
  await expect(f.runtime.chooseCandidate('unavailable')).rejects.toThrow();
  expect(f.documents.getEditDocument('poster')!.layers).toEqual(original.layers);
  expect(f.commandBus.getHistory()).toEqual([]);
});
