import { expect, it, vi } from 'vitest';
import { DocumentManager } from '../../document/DocumentManager';
import { createEditDocument, createImageLayer } from '../../document/EditDocument';
import { CommandBus } from '../../history/CommandBus';
import { ToolRegistry } from '../tools/ToolRegistry';
import { DocumentObservationService } from '../vision/DocumentObservationService';
import { CandidateService } from './CandidateService';
import { RunBudget } from './RunBudget';
import { classifyTask } from './TaskPolicy';

function setup() {
  const documents = new DocumentManager();
  const source = createEditDocument({ id: 'poster', width: 100, height: 80, layers: [createImageLayer({ id: 'background', name: 'Background', sourceAssetId: 'shared-photo', naturalWidth: 100, naturalHeight: 80 })] });
  documents.openDocument(source);
  const commandBus = new CommandBus(documents);
  const toolRegistry = new ToolRegistry();
  const previewRenderer = {
    async render(doc, geometry) { return { data: btoa(`${doc.kind === 'edit' ? doc.layers.length : 0}:${geometry.width}`), mimeType: geometry.mimeType, approximate: false }; },
  } satisfies import('../vision/observationTypes').DocumentObservationRenderPort;
  const observationService = new DocumentObservationService({ documents, renderer: previewRenderer });
  const service = new CandidateService({ documents, commandBus, toolRegistry, observationService, previewRenderer });
  return { documents, commandBus, toolRegistry, observationService, service, source };
}

it('previews two real canonical plans without changing source, selection, or history and replays chosen IDs as one run', async () => {
  const f = setup();
  const before = JSON.stringify(f.documents.getActiveDocument());
  const created = await f.service.create({ runId: 'candidate-run', brief: { domain: 'layout', goal: 'Add two title options' }, plans: [
    { label: 'A', reason: 'Quiet hierarchy', operations: [
      { name: 'edit_create_text_layer', args: { text: '$10', documentId: 'poster' }, ref: 'title' },
      { name: 'edit_rename_layer', args: { layerId: '$title', newName: 'Headline A', documentId: 'poster' } },
    ] },
    { label: 'B', reason: 'Bolder hierarchy', operations: [{ name: 'edit_create_text_layer', args: { text: 'B', documentId: 'poster' } }] },
  ] });
  expect(created.candidates).toHaveLength(2);
  expect(created.baseline.preview).toBeTruthy();
  expect(created.candidates.every(candidate => !!candidate.preview)).toBe(true);
  expect(JSON.stringify(f.documents.getActiveDocument())).toBe(before);
  expect(f.commandBus.getHistory()).toEqual([]);
  const accepted = await f.service.accept(created.candidates[0].id);
  expect(accepted.runId).toBe('candidate-run');
  const live = f.documents.getEditDocument('poster')!;
  expect(live.layers[1].name).toBe('Headline A');
  expect(live.layers[1].type === 'text' && live.layers[1].text).toBe('$10');
  expect(live.layers[1].id).not.toBe(created.candidates[0].createdIds.title);
  expect(f.commandBus.getHistory().every(entry => entry.agentRunId === 'candidate-run')).toBe(true);
  expect(f.commandBus.rollbackAgentRun('candidate-run')).toBe(true);
  expect(f.documents.getEditDocument('poster')!.layers).toHaveLength(1);
});

it('keeps two creations distinct even when both canonical calls occur in the same millisecond', async () => {
  const f = setup();
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  const created = await f.service.create({ runId: 'same-time', brief: { domain: 'layout', goal: 'Two titles' }, plans: [
    { label: 'A', reason: 'Two-line title', operations: [
      { name: 'edit_create_text_layer', args: { documentId: 'poster', text: 'First' }, ref: 'first' },
      { name: 'edit_create_text_layer', args: { documentId: 'poster', text: 'Second' }, ref: 'second' },
      { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: '$second', newName: 'Second line' } },
    ] },
  ] });
  expect(created.candidates[0].createdIds.first).not.toBe(created.candidates[0].createdIds.second);
  await f.service.accept(created.candidates[0].id);
  const live = f.documents.getEditDocument('poster')!;
  expect(live.layers.map(layer => layer.name)).toEqual(['Background', 'Text: First', 'Second line']);
  vi.restoreAllMocks();
});

it('rejects more than two candidates and stale source including lock-only changes', async () => {
  const f = setup();
  const plan = { label: 'A', reason: 'Keep focus', operations: [{ name: 'edit_rename_layer', args: { documentId: 'poster', layerId: 'background', newName: 'Edited' } }] };
  await expect(f.service.create({ runId: 'run', brief: { domain: 'layout', goal: 'Reorder' }, plans: [plan, plan, plan] })).rejects.toThrow();
  const result = await f.service.create({ runId: 'run', brief: { domain: 'layout', goal: 'Reorder' }, plans: [plan] });
  const latest = f.documents.getEditDocument('poster')!;
  f.documents.updateDocument({ ...latest, layers: [{ ...latest.layers[0], locked: true }] });
  await expect(f.service.accept(result.candidates[0].id)).rejects.toThrow(/changed|stale/i);
  expect(f.commandBus.getHistory()).toEqual([]);
});

it('rolls back a failed replay and blocks source-side-effect tools in a sandbox', async () => {
  const f = setup();
  await expect(f.service.create({ runId: 'bad', brief: { domain: 'layout', goal: 'Export' }, plans: [{ label: 'A', reason: 'Export', operations: [{ name: 'system_save_project', args: {} }] }] })).rejects.toThrow(/unsupported/i);
  const result = await f.service.create({ runId: 'failed', brief: { domain: 'layout', goal: 'Rename' }, plans: [{ label: 'A', reason: 'Rename', operations: [
    { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: 'background', newName: 'Changed' } },
    { name: 'edit_set_layer_opacity', args: { documentId: 'poster', layerId: 'background', opacity: 0.4 } },
  ] }] });
  vi.spyOn(f.toolRegistry.get('edit_set_layer_opacity')!, 'execute').mockRejectedValueOnce(new Error('replay failed'));
  await expect(f.service.accept(result.candidates[0].id)).rejects.toThrow(/replay failed/);
  expect(f.documents.getEditDocument('poster')!.layers[0].name).not.toBe('Changed');
  expect(f.commandBus.getHistory()).toEqual([]);
});

it('rechecks the full source immediately before execute after a tool await', async () => {
  const f = setup();
  const result = await f.service.create({ runId: 'late', brief: { domain: 'layout', goal: 'Rename' }, plans: [{ label: 'A', reason: 'Rename', operations: [
    { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: 'background', newName: 'Candidate' } },
  ] }] });
  const tool = f.toolRegistry.get('edit_rename_layer')!;
  const execute = tool.execute.bind(tool);
  vi.spyOn(tool, 'execute').mockImplementationOnce(async (...args) => {
    await Promise.resolve();
    const document = f.documents.getEditDocument('poster')!;
    f.documents.updateDocument({ ...document, layers: [{ ...document.layers[0], name: 'Manual' }] });
    return execute(...args);
  });
  await expect(f.service.accept(result.candidates[0].id)).rejects.toThrow(/changed|stale/);
  expect(f.documents.getEditDocument('poster')!.layers[0].name).toBe('Manual');
  expect(f.commandBus.getHistory()).toEqual([]);
});

it('refuses locked existing targets even when they were locked at candidate creation', async () => {
  const f = setup();
  const document = f.documents.getEditDocument('poster')!;
  f.documents.updateDocument({ ...document, layers: [{ ...document.layers[0], locked: true }] });
  await expect(f.service.create({ runId: 'locked', brief: { domain: 'layout', goal: 'Rename' }, plans: [{ label: 'A', reason: 'Rename', operations: [
    { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: 'background', newName: 'Candidate' } },
  ] }] })).rejects.toThrow(/locked/);
});

it('does not absorb or overwrite a direct manual change after one accepted command', async () => {
  const f = setup();
  const result = await f.service.create({ runId: 'interrupted', brief: { domain: 'layout', goal: 'Rename' }, plans: [{ label: 'A', reason: 'Rename', operations: [
    { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: 'background', newName: 'Candidate' } },
    { name: 'edit_set_layer_opacity', args: { documentId: 'poster', layerId: 'background', opacity: 0.4 } },
  ] }] });
  const tool = f.toolRegistry.get('edit_rename_layer')!;
  const execute = tool.execute.bind(tool);
  vi.spyOn(tool, 'execute').mockImplementationOnce(async (...args) => {
    const outcome = await execute(...args);
    const document = f.documents.getEditDocument('poster')!;
    f.documents.updateDocument({ ...document, name: 'Manual project name' });
    return outcome;
  });
  await expect(f.service.accept(result.candidates[0].id)).rejects.toThrow(/manual|changed|stale/i);
  expect(f.documents.getEditDocument('poster')!.name).toBe('Manual project name');
  expect(f.documents.getEditDocument('poster')!.layers[0].opacity).toBe(1);
});

it('keeps its canonical operation log isolated from callers and remaps duplication IDs', async () => {
  const f = setup();
  const set = await f.service.create({ runId: 'copy', brief: { domain: 'layout', goal: 'Duplicate image' }, plans: [{ label: 'A', reason: 'Second copy', operations: [
    { name: 'edit_duplicate_layer', args: { documentId: 'poster', layerId: 'background' }, ref: 'copy' },
    { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: '$copy', newName: 'Copy' } },
  ] }] });
  set.candidates[0].operations[1].args.newName = 'Tampered';
  const accepted = await f.service.accept(set.candidates[0].id);
  expect(f.documents.getEditDocument('poster')!.layers[1].name).toBe('Copy');
  expect(accepted.idMap.copy).toBeTruthy();
  expect(accepted.idMap.copy).not.toBe(set.candidates[0].createdIds.copy);
});

it('releases candidate observations on discard while retaining shared source assets', async () => {
  const f = setup();
  const release = vi.spyOn(f.observationService, 'release');
  const set = await f.service.create({ runId: 'discard', brief: { domain: 'layout', goal: 'Rename' }, plans: [{ label: 'A', reason: 'Rename', operations: [
    { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: 'background', newName: 'Candidate' } },
  ] }] });
  f.service.discard(set.candidates[0].id);
  expect(f.service.getForRun('discard')).toBeUndefined();
  expect(release).toHaveBeenCalled();
  const layer = f.documents.getEditDocument('poster')!.layers[0];
  expect(layer.type === 'image' && layer.sourceAssetId).toBe('shared-photo');
});

it('replays references to newly created groups using the canonical returned group ID', async () => {
  const f = setup();
  const set = await f.service.create({ runId: 'group', brief: { domain: 'layout', goal: 'Group image' }, plans: [{ label: 'A', reason: 'Group the image', operations: [
    { name: 'edit_create_group', args: { documentId: 'poster', name: 'Group', memberLayerIds: ['background'] }, ref: 'group' },
    { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: '$group', newName: 'Image group' } },
  ] }] });
  await f.service.accept(set.candidates[0].id);
  expect(f.documents.getEditDocument('poster')!.layers[0].name).toBe('Image group');
});

it('does not publish a candidate after its preparation was discarded', async () => {
  const f = setup();
  const observe = f.observationService.observe.bind(f.observationService);
  vi.spyOn(f.observationService, 'observe').mockImplementationOnce(async (...args) => {
    const observation = await observe(...args); f.service.discardRun('cancel'); return observation;
  });
  await expect(f.service.create({ runId: 'cancel', brief: { domain: 'layout', goal: 'Rename' }, plans: [{ label: 'A', reason: 'Rename', operations: [
    { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: 'background', newName: 'Candidate' } },
  ] }] })).rejects.toThrow(/cancel/i);
  expect(f.service.getForRun('cancel')).toBeUndefined();
});

it('verifies accepted document postconditions match the preview and rolls back divergent replay', async () => {
  const f = setup();
  const set = await f.service.create({ runId: 'diverge', brief: { domain: 'layout', goal: 'Rename' }, plans: [{ label: 'A', reason: 'Rename', operations: [
    { name: 'edit_rename_layer', args: { documentId: 'poster', layerId: 'background', newName: 'Candidate' } },
  ] }] });
  const tool = f.toolRegistry.get('edit_rename_layer')!, execute = tool.execute.bind(tool);
  vi.spyOn(tool, 'execute').mockImplementationOnce((context, args, callId) => execute(context, { ...args, newName: 'Different' }, callId));
  await expect(f.service.accept(set.candidates[0].id)).rejects.toThrow(/postcondition|preview/i);
  expect(f.documents.getEditDocument('poster')!.layers[0].name).toBe('Background');
  expect(f.commandBus.getHistory()).toEqual([]);
});

it.each([
  { taskKind: 'layout' as const, targetIds: ['allowed-layer'] },
  { taskKind: 'local-detail' as const, regions: [{ x: 10, y: 10, width: 8, height: 8 }] },
])('rejects constrained exploration before any sandbox writes: %j', async options => {
  const f = setup();
  const current = f.documents.getEditDocument('poster')!;
  f.documents.updateDocument({ ...current, layers: [...current.layers,
    createImageLayer({ id: 'allowed-layer', name: 'Allowed', sourceAssetId: 'shared-photo', naturalWidth: 100, naturalHeight: 80 })] });
  const before = JSON.stringify(f.documents.getActiveDocument());
  const execution = { budget: new RunBudget(), policy: classifyTask('Balance layout', f.documents.getActiveDocument(), options) };
  await expect(f.service.create({ runId: 'constrained', brief: { domain: 'layout', goal: 'Balance layout' }, execution, plans: [
    { label: 'A', reason: 'Change full background', operations: [
      { name: 'edit_set_layer_opacity', args: { documentId: 'poster', layerId: 'background', opacity: 0.4 } },
    ] },
  ] })).rejects.toThrow(/candidate_scope_unsupported/);
  expect(JSON.stringify(f.documents.getActiveDocument())).toBe(before);
  expect(f.commandBus.getHistory()).toEqual([]);
  expect(execution.budget.state.toolCalls).toBe(0);
  expect(f.service.getForRun('constrained')).toBeUndefined();
});

it('honors an explicit local-detail task at the canonical entry point without a runtime context', async () => {
  const f = setup();
  const before = JSON.stringify(f.documents.getActiveDocument());
  const result = await f.toolRegistry.get('studio_create_candidates')!.execute({ documentManager: f.documents,
    commandBus: f.commandBus, currentWorkspace: 'edit', candidateService: f.service }, {
    runId: 'external-detail', prompt: 'Balance the layout', taskKind: 'local-detail', plans: [
      { label: 'A', reason: 'Full layer', operations: [
        { name: 'edit_set_layer_opacity', args: { documentId: 'poster', layerId: 'background', opacity: 0.4 } },
      ] },
    ],
  }, 'external-detail');
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain('candidate_scope_unsupported');
  expect(JSON.stringify(f.documents.getActiveDocument())).toBe(before);
  expect(f.commandBus.getHistory()).toEqual([]);
});
