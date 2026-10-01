import { DocumentManager } from '../../document/DocumentManager';
import { CommandBus } from '../../history/CommandBus';
import { defaultAssetManager } from '../../assets/AssetManager';
import type { IAssetManager } from '../../types/asset';
import type { StudioDocument } from '../../types/document';
import type { ICommandBus, ICommand } from '../../types/history';
import { ToolRegistry } from '../tools/ToolRegistry';
import { DocumentObservationService } from '../vision/DocumentObservationService';
import type { DocumentObservationRenderPort } from '../vision/observationTypes';
import { PermissionGuard } from '../permissions/PermissionGuard';
import type { CreativeBrief } from './CreativeBrief';
import { flattenLayerTree } from '../../document/EditDocument';
import type { ToolResult } from '../types';
import { HarnessStop, RunBudget } from './RunBudget';
import { classifyTask, type TaskPolicy } from './TaskPolicy';

export interface CandidateOperation { name: string; args: Record<string, unknown>; ref?: string }
export interface CandidatePlan { label: string; reason: string; operations: CandidateOperation[] }
export interface CandidatePreview {
  id: string; runId: string; label: string; reason: string; documentId: string;
  preview: string; operations: CandidateOperation[]; createdIds: Record<string, string>;
}
export interface CandidateSet { baseline: { preview: string; revision: string }; candidates: CandidatePreview[] }
export interface CandidateExecution {
  budget: RunBudget;
  policy?: TaskPolicy;
  onAction?: (stage: 'preview' | 'replay', name: string, args: Record<string, unknown>, result: ToolResult) => void;
}
export function assertCandidateScope(policy?: TaskPolicy): void {
  if (policy && (policy.kind === 'local-detail' || policy.targetIds.length || policy.regions.length))
    throw new HarnessStop('candidate_scope_unsupported');
}
export class CandidateAcceptanceError extends Error {
  constructor(message: string, readonly runId: string, readonly commandIds: string[], readonly stopReason: string,
    readonly rollbackBlockedReason?: string) { super(message); }
}

interface Dependencies {
  documents: DocumentManager; commandBus: CommandBus; toolRegistry: ToolRegistry;
  observationService: DocumentObservationService; permissionGuard?: PermissionGuard;
  assets?: IAssetManager; previewRenderer?: DocumentObservationRenderPort;
}
interface RecordEntry { candidate: CandidatePreview; state: string; revision: string; finalState: string; sourceIds: Set<string>; ownedAssetIds: Set<string>; execution: CandidateExecution }
const REPLAYABLE = new Set([
  'develop_set_parameter', 'develop_set_exposure', 'develop_set_contrast', 'develop_set_temperature',
  'develop_set_tint', 'develop_set_saturation', 'develop_set_highlights', 'develop_set_shadows',
  'develop_set_curves', 'develop_reset_settings',
  'edit_create_text_layer', 'edit_create_image_layer', 'edit_create_adjustment_layer',
  'edit_set_adjustment_settings', 'edit_delete_layer', 'edit_rename_layer', 'edit_set_layer_opacity',
  'edit_set_blend_mode', 'edit_set_visibility', 'edit_move_layer_order', 'edit_duplicate_layer',
  'edit_set_layer_locked', 'edit_align_layer', 'edit_flip_layer', 'edit_create_group',
  'edit_move_to_group', 'edit_transform', 'edit_crop', 'edit_resize_canvas',
]);
const SYMBOL_FIELDS = new Set(['layerId', 'memberLayerIds', 'targetGroupId', 'maskId', 'filterId']);
let candidateSerial = 0;

function sourceState(document: StudioDocument): string {
  const { aiHistory: _history, updatedAt: _updated, isDirty: _dirty, ...content } = document;
  return JSON.stringify(content);
}
function replayState(document: StudioDocument, sourceIds: Set<string>): string {
  const newIds = new Map(document.kind === 'edit' ? flattenLayerTree(document.layers).filter(layer => !sourceIds.has(layer.id))
    .map((layer, index) => [layer.id, `created:${index}`]) : []);
  return JSON.stringify(JSON.parse(sourceState(document)), (key, value) =>
    typeof value === 'string' && (key === 'id' || /Id$/.test(key)) ? newIds.get(value) ?? value : value);
}
function resultId(name: string, after: any): string | undefined {
  if (name === 'edit_create_text_layer' || name === 'edit_create_image_layer') return after?.createdLayerId;
  if (name === 'edit_create_adjustment_layer' || name === 'edit_create_group' || name === 'edit_duplicate_layer') return after?.layerId ?? after?.groupId;
  return undefined;
}
function resolveArgs(args: Record<string, unknown>, refs: Record<string, string>): Record<string, unknown> {
  const visit = (value: unknown, key: string): unknown => {
    if (typeof value === 'string' && value.startsWith('$') && SYMBOL_FIELDS.has(key)) {
      if (!refs[value.slice(1)]) throw new Error(`Unknown candidate reference ${value}`);
      return refs[value.slice(1)];
    }
    if (Array.isArray(value)) return value.map(item => visit(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([child, item]) => [child, visit(item, child)]));
    return value;
  };
  return visit(args, '') as Record<string, unknown>;
}

/** Executes only documented, resource-neutral canonical edits in separate document histories. */
export class CandidateService {
  private records = new Map<string, RecordEntry>();
  private baselineByRun = new Map<string, CandidateSet['baseline']>();
  private baselineObservationByRun = new Map<string, string>();
  private accepting = false;
  private preparationSerial = 0;
  private preparingRun?: string;
  private readonly permissionGuard: PermissionGuard;
  private readonly assets: IAssetManager;
  constructor(private readonly deps: Dependencies) {
    this.permissionGuard = deps.permissionGuard ?? new PermissionGuard();
    this.assets = deps.assets ?? defaultAssetManager;
  }
  getForRun(runId: string): CandidateSet | undefined {
    const baseline = this.baselineByRun.get(runId);
    if (!baseline) return undefined;
    return structuredClone({ baseline, candidates: [...this.records.values()].filter(record => record.candidate.runId === runId).map(record => record.candidate) });
  }
  private current(documentId: string, state: string, revision: string): StudioDocument {
    const document = this.deps.documents.getDocument(documentId);
    if (!document || this.deps.documents.getActiveDocument()?.id !== documentId || sourceState(document) !== state || this.deps.observationService.revision(documentId) !== revision)
      throw new Error('Candidate source changed or became stale');
    return document;
  }
  private validate(plan: CandidatePlan, document: StudioDocument): CandidateOperation[] {
    if (!plan.label?.trim() || !plan.reason?.trim() || !plan.operations?.length || plan.operations.length > 16) throw new Error('Candidate plan is incomplete or too large');
    return plan.operations.map(operation => {
      const tool = this.deps.toolRegistry.get(operation.name);
      if (!tool || !REPLAYABLE.has(tool.schema.name) || tool.schema.category !== (document.kind === 'edit' ? 'edit' : 'develop'))
        throw new Error(`Unsupported candidate operation: ${operation.name}`);
      for (const key of tool.schema.parameters.required ?? []) if (operation.args[key] === undefined)
        throw new Error(`Candidate operation ${tool.schema.name} requires ${key}`);
      if (tool.schema.name === 'edit_create_image_layer' && !this.assets.hasAsset(String(operation.args.assetId))) throw new Error('Unsupported candidate asset');
      if (tool.schema.name === 'develop_set_white_balance' && operation.args.mode === 'auto') throw new Error('Unsupported candidate resource operation');
      if (operation.args.documentId && operation.args.documentId !== document.id) throw new Error('Candidate may edit only its source document');
      return { name: tool.schema.name, args: structuredClone(operation.args), ref: operation.ref };
    });
  }
  private capacity(budget: RunBudget, toolCalls: number, images = 0): void {
    budget.checkTime();
    if (budget.state.toolCalls + toolCalls > budget.limits.maxToolCalls) throw new HarnessStop('maxToolCalls_exhausted', true);
    if (budget.state.images + images > budget.limits.maxImages) throw new HarnessStop('maxImages_exhausted', true);
  }
  private async execute(execution: CandidateExecution, stage: 'preview' | 'replay', name: string, args: Record<string, unknown>,
    operation: () => Promise<ToolResult>): Promise<ToolResult> {
    execution.budget.take('toolCalls');
    let result: ToolResult;
    try { result = await operation(); }
    catch (error) {
      execution.onAction?.(stage, name, args, { success: false, toolCallId: `candidate:${stage}`, renderRequired: false,
        error: { code: 'COMMAND_FAILED', message: (error as Error).message } });
      throw error;
    }
    execution.onAction?.(stage, name, args, result);
    return result;
  }
  private async observe(execution: CandidateExecution, service: DocumentObservationService, documentId: string,
    signal?: AbortSignal, expectedRevision?: string): Promise<import('../vision/observationTypes').DocumentObservation> {
    this.capacity(execution.budget, 1, 1);
    let observation!: import('../vision/observationTypes').DocumentObservation;
    await this.execute(execution, 'preview', 'inspect_document', { documentId, mode: 'overview', maxDimension: 768 }, async () => {
      observation = await execution.budget.request(currentSignal => service.observe({ documentId, mode: 'overview', maxDimension: 768,
        expectedRevision }, currentSignal), signal ?? new AbortController().signal, false);
      execution.budget.take('images');
      const data = observation.image.data;
      execution.budget.state.imageBytes += data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
      return { success: true, toolCallId: 'candidate:observation', renderRequired: false,
        data: { evidence: observation.evidence }, images: [observation.image] };
    });
    return observation;
  }
  private async preview(doc: StudioDocument, operations: CandidateOperation[], execution: CandidateExecution, signal?: AbortSignal): Promise<{ image: string; ids: Record<string, string>; document: StudioDocument }> {
    const documents = new DocumentManager();
    documents.openDocument(structuredClone(doc));
    const bus = new CommandBus(documents);
    const refs: Record<string, string> = {};
    try {
      for (const [index, operation] of operations.entries()) {
        if (signal?.aborted) throw Object.assign(new Error('Candidate preparation cancelled'), { name: 'AbortError' });
        const args = resolveArgs(operation.args, refs);
        const result = await this.execute(execution, 'preview', operation.name, args, () => this.deps.toolRegistry.get(operation.name)!.execute({ documentManager: documents, commandBus: bus,
          currentWorkspace: doc.kind, signal }, args, `candidate:${index}`));
        if (!result.success || !result.commandId) throw new Error(result.error?.message ?? 'Candidate operation did not produce a canonical edit');
        if (operation.ref) {
          if (!/^[a-z][a-z\d_]{0,31}$/i.test(operation.ref) || refs[operation.ref]) throw new Error('Invalid candidate reference');
          const id = resultId(operation.name, result.after);
          if (!id) throw new Error('Candidate reference has no created object ID');
          if (Object.values(refs).includes(id)) throw new Error('Candidate returned a duplicate object ID');
          refs[operation.ref] = id;
        }
      }
      const observation = new DocumentObservationService({ documents, assets: this.assets, renderer: this.deps.previewRenderer });
      try {
        const result = await this.observe(execution, observation, doc.id, signal);
        return { image: `data:${result.image.mimeType};base64,${result.image.data}`, ids: refs, document: structuredClone(documents.getActiveDocument()!) };
      } finally { observation.dispose(); }
    } finally { documents.closeAll(); }
  }
  async create(request: { runId: string; brief: Pick<CreativeBrief, 'domain' | 'goal'>; plans: CandidatePlan[]; signal?: AbortSignal; execution?: CandidateExecution }): Promise<CandidateSet> {
    const { runId, brief, plans } = request;
    const execution = request.execution ?? { budget: new RunBudget(), policy: classifyTask(brief.goal, this.deps.documents.getActiveDocument()) };
    assertCandidateScope(execution.policy);
    if (!runId || !plans.length || plans.length > 2) throw new Error('Exploration supports one or two candidates');
    const document = this.deps.documents.getActiveDocument();
    if (!document || !['photo', 'layout'].includes(brief.domain) || !brief.goal?.trim() || (document.kind === 'develop' && brief.domain !== 'photo')) throw new Error('Candidate brief does not match the active document');
    const state = sourceState(document), revision = this.deps.observationService.revision(document.id);
    const normalized = plans.map(plan => this.validate(plan, document));
    // Leave capacity for the longest chosen replay before any sandbox operation or rendering.
    this.capacity(execution.budget, normalized.reduce((count, operations) => count + operations.length, 0)
      + Math.max(...normalized.map(operations => operations.length)) + plans.length + 1, plans.length + 1);
    for (const previous of [...this.baselineByRun.keys()]) this.discardRun(previous);
    const preparation = ++this.preparationSerial;
    this.preparingRun = runId;
    const assertPreparing = () => { if (request.signal?.aborted || preparation !== this.preparationSerial)
      throw Object.assign(new Error('Candidate preparation cancelled'), { name: 'AbortError' }); };
    assertPreparing();
    const baselineObservation = await this.observe(execution, this.deps.observationService, document.id, request.signal, revision);
    const baseline = { preview: `data:${baselineObservation.image.mimeType};base64,${baselineObservation.image.data}`, revision };
    const prepared: RecordEntry[] = [];
    const sourceIds = new Set(document.kind === 'edit' ? flattenLayerTree(document.layers).map(layer => layer.id) : []);
    try {
      for (const [index, plan] of plans.entries()) {
        assertPreparing();
        this.current(document.id, state, revision);
        const rendered = await this.preview(document, normalized[index], execution, request.signal);
        assertPreparing();
        this.current(document.id, state, revision);
        const candidate: CandidatePreview = { id: `candidate_${Date.now()}_${++candidateSerial}`, runId, label: plan.label.slice(0, 48),
          reason: plan.reason.slice(0, 240), documentId: document.id, preview: rendered.image, operations: normalized[index], createdIds: rendered.ids };
        prepared.push({ candidate, state, revision, finalState: replayState(rendered.document, sourceIds), sourceIds, ownedAssetIds: new Set(), execution });
      }
      this.baselineByRun.set(runId, baseline);
      this.baselineObservationByRun.set(runId, baselineObservation.evidence.observationId);
      for (const record of prepared) this.records.set(record.candidate.id, record);
      return structuredClone({ baseline, candidates: prepared.map(record => record.candidate) });
    } catch (error) {
      this.deps.observationService.release(baselineObservation.evidence.observationId);
      for (const record of prepared) for (const id of record.ownedAssetIds) this.assets.releaseAsset(id);
      throw error;
    } finally { if (preparation === this.preparationSerial) this.preparingRun = undefined; }
  }
  async accept(id: string, signal: AbortSignal = new AbortController().signal): Promise<{ runId: string; commandIds: string[]; idMap: Record<string, string> }> {
    if (this.accepting) throw new Error('Candidate acceptance is already in progress');
    const record = this.records.get(id);
    if (!record) throw new Error('Candidate is unavailable');
    const { candidate, state, revision } = record;
    const bus = this.deps.commandBus;
    const scoped = bus.forAgentRun(candidate.runId);
    const refs: Record<string, string> = {}, ids: string[] = [];
    const previousHistory = bus.getHistory();
    let expected = state, expectedRevision = revision;
    let sourceInterrupted = false;
    const assertCurrent = () => {
      if (signal.aborted) throw Object.assign(new Error('Candidate acceptance cancelled'), { name: 'AbortError' });
      if (!this.records.has(id)) throw new Error('Candidate acceptance cancelled');
      try { this.current(candidate.documentId, expected, expectedRevision); }
      catch (error) { sourceInterrupted = true; throw error; }
    };
    const guarded = new Proxy<ICommandBus>(scoped, { get: (target, property) => {
      if (property === 'execute') return (command: ICommand) => {
        record.execution.budget.checkTime();
        assertCurrent();
        if (command.documentId !== candidate.documentId) throw new Error('Candidate may edit only its source document');
        const result = target.execute(command);
        expected = sourceState(this.deps.documents.getDocument(candidate.documentId)!);
        expectedRevision = this.deps.observationService.revision(candidate.documentId);
        if (result instanceof Promise) return result.then(() => assertCurrent());
        return result;
      };
      // Candidate edits use ordinary canonical commands, never history manipulation.
      if (['preview', 'beginTransaction', 'commitTransaction', 'abortTransaction', 'undo', 'redo'].includes(String(property)))
        return () => { throw new Error('Unsupported candidate history operation'); };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    this.accepting = true;
    let began = false;
    try {
      assertCandidateScope(record.execution.policy);
      this.capacity(record.execution.budget, candidate.operations.length);
      assertCurrent();
      bus.beginAgentRun(candidate.runId, candidate.label);
      began = true;
      for (const [index, operation] of candidate.operations.entries()) {
        const tool = this.deps.toolRegistry.get(operation.name)!;
        const args = resolveArgs(operation.args, refs);
        assertCurrent();
        if (!(await record.execution.budget.request(() => this.permissionGuard.checkPermission(tool, args), signal, false))) throw new Error('Candidate edit permission denied');
        assertCurrent();
        const result = await this.execute(record.execution, 'replay', operation.name, args, () => record.execution.budget.request(toolSignal => tool.execute({ documentManager: this.deps.documents, commandBus: guarded,
          currentWorkspace: this.deps.documents.getActiveDocument()!.kind, signal: toolSignal }, args, `candidate_accept:${index}`), signal, false));
        assertCurrent();
        if (!result.success || !result.commandId) throw new Error(result.error?.message ?? 'Candidate replay failed');
        ids.push(result.commandId);
        if (operation.ref) {
          const created = resultId(operation.name, result.after);
          if (!created) throw new Error('Accepted creation returned no object ID');
          if (Object.values(refs).includes(created)) throw new Error('Candidate replay returned a duplicate object ID');
          refs[operation.ref] = created;
        }
        const history = bus.getHistory();
        if (history.length < previousHistory.length || previousHistory.some((entry, index) => history[index]?.id !== entry.id)
          || history.slice(previousHistory.length).some(entry => entry.agentRunId !== candidate.runId))
          throw new Error('Manual edit interrupted candidate replay');
      }
      if (replayState(this.deps.documents.getDocument(candidate.documentId)!, record.sourceIds) !== record.finalState)
        throw new Error('Candidate replay postconditions do not match its preview');
      bus.commitAgentRun();
      this.discardRun(candidate.runId);
      return { runId: candidate.runId, commandIds: ids, idMap: refs };
    } catch (error) {
      // Cancellation may win a pending permission/tool wait before assertCurrent runs again.
      if (began) {
        try { this.current(candidate.documentId, expected, expectedRevision); }
        catch { sourceInterrupted = true; }
      }
      if (began && sourceInterrupted && bus.getHistory().some(entry => entry.agentRunId === candidate.runId)) {
        bus.commitAgentRun();
      } else if (began) bus.rollbackAgentRun(candidate.runId);
      const retained = bus.getHistory().filter(entry => entry.agentRunId === candidate.runId).map(entry => entry.command.id);
      this.discardRun(candidate.runId);
      throw new CandidateAcceptanceError(`${retained.length ? 'Candidate replay stopped; later manual edits were preserved: ' : ''}${(error as Error).message}`,
        candidate.runId, retained, error instanceof HarnessStop ? error.reason : 'candidate_replay_interrupted',
        retained.length ? bus.getAgentRunUndoBlockReason(candidate.runId) ?? undefined : undefined);
    } finally { this.accepting = false; }
  }
  discard(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    for (const assetId of record.ownedAssetIds) this.assets.releaseAsset(assetId);
    this.records.delete(id);
    if (![...this.records.values()].some(item => item.candidate.runId === record.candidate.runId)) this.discardRun(record.candidate.runId);
  }
  discardRun(runId: string): void {
    if (this.preparingRun === runId) { this.preparationSerial++; this.preparingRun = undefined; }
    for (const [id, record] of this.records) if (record.candidate.runId === runId) this.discard(id);
    this.baselineByRun.delete(runId);
    const observationId = this.baselineObservationByRun.get(runId);
    if (observationId) this.deps.observationService.release(observationId);
    this.baselineObservationByRun.delete(runId);
  }
  dispose(): void {
    if (this.preparingRun) this.discardRun(this.preparingRun);
    for (const runId of [...this.baselineByRun.keys()]) this.discardRun(runId);
  }
}
