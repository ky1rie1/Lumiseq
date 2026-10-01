// src/ai/runtime/AgentRuntime.ts
import {
  AgentActionLogEntry,
  AgentMessage,
  AgentRun,
  ToolResult,
  VisionSnapshot
} from '../types';
import { ProviderRegistry, defaultProviderRegistry } from '../providers/ProviderRegistry';
import { previousConversationMessages } from './conversationContext';
import { ToolRegistry, defaultToolRegistry } from '../tools/ToolRegistry';
import { PermissionGuard, defaultPermissionGuard } from '../permissions/PermissionGuard';
import { VisionInspector, defaultVisionInspector } from '../vision/VisionInspector';
import { CommandBus } from '../../history/CommandBus';
import { DocumentManager, defaultDocumentManager } from '../../document/DocumentManager';
import { Redactor } from '../security/Redactor';
import { IToolContext } from '../tools/CanonicalTool';
import { toAgentObservation, sanitizeRuntimeValue } from './toolObservation';
import { appendProjectAiRun } from '../../app/projectAiHistory';
import type { ICommandBus } from '../../types/history';
import { DocumentObservationService } from '../vision/DocumentObservationService';
import { CapabilityRouter, defaultCapabilityRouter } from '../capabilities/CapabilityRouter';
import { RunBudget, HarnessStop, type RunBudgetOptions } from '../harness/RunBudget';
import { HarnessSession } from '../harness/HarnessSession';
import type { TaskPolicyOptions } from '../harness/TaskPolicy';
import { initialAgentSchemas, operationGuide } from '../harness/OperationGuide';
import { CandidateService, CandidateAcceptanceError, assertCandidateScope, type CandidateSet } from '../harness/CandidateService';
import { buildCreativeBrief, prepareCreativeReferences, type CreativeReference } from '../harness/CreativeBrief';
import { TastePreferences, defaultTastePreferences } from '../harness/TastePreferences';
import { defaultAssetManager } from '../../assets/AssetManager';
import { normalizeImageMessages, DEFAULT_IMAGE_LIMITS } from '../providers/imageTransport';
import { technicalReview } from '../harness/QualityReview';

export type AgentRuntimeEventType =
  | 'run_started'
  | 'step_started'
  | 'delta'
  | 'action_completed'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled';

export interface AgentRuntimeEvent {
  type: AgentRuntimeEventType;
  run?: AgentRun;
  stepIndex?: number;
  entry?: AgentActionLogEntry;
  delta?: string;
  error?: string;
}

export type AgentEventListener = (event: AgentRuntimeEvent) => void;

export interface AgentRunOptions extends RunBudgetOptions, TaskPolicyOptions {
  maxSteps?: number;
  signal?: AbortSignal;
  includeVision?: boolean;
  workspace?: 'develop' | 'edit';
  documentId?: string;
  explore?: boolean;
  references?: CreativeReference[];
}

export interface AgentRuntimeHarnessOptions {
  observationService?: DocumentObservationService;
  capabilityRouter?: CapabilityRouter;
  candidateService?: CandidateService;
  tastePreferences?: TastePreferences;
}

export class AgentRuntime {
  private observationService: DocumentObservationService;
  private capabilityRouter: CapabilityRouter;
  private candidateService: CandidateService;
  private tastePreferences: TastePreferences;
  private activeRun: AgentRun | null = null;
  private runs: Map<string, AgentRun> = new Map();
  private listeners: Set<AgentEventListener> = new Set();
  private abortController: AbortController | null = null;
  private choosingCandidate = false;

  constructor(
    private providerRegistry: ProviderRegistry = defaultProviderRegistry,
    private toolRegistry: ToolRegistry = defaultToolRegistry,
    private permissionGuard: PermissionGuard = defaultPermissionGuard,
    _visionInspector: VisionInspector = defaultVisionInspector,
    private commandBus: CommandBus,
    private documentManager: DocumentManager = defaultDocumentManager,
    harnessOptions: AgentRuntimeHarnessOptions = {}
  ) {
    this.observationService = harnessOptions.observationService ?? new DocumentObservationService({documents:documentManager});
    this.capabilityRouter = harnessOptions.capabilityRouter ?? (providerRegistry === defaultProviderRegistry ? defaultCapabilityRouter : new CapabilityRouter(providerRegistry));
    this.candidateService = harnessOptions.candidateService ?? new CandidateService({ documents: documentManager, commandBus,
      toolRegistry, observationService: this.observationService, permissionGuard });
    this.tastePreferences = harnessOptions.tastePreferences ?? defaultTastePreferences;
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentRuntimeEvent): void {
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch (err) {
        console.error('AgentRuntime listener error:', err);
      }
    });
  }

  getActiveRun(): AgentRun | null {
    return this.activeRun;
  }

  getRun(runId: string): AgentRun | undefined {
    return this.runs.get(runId);
  }

  getAllRuns(): AgentRun[] {
    return Array.from(this.runs.values());
  }

  cancelActiveRun(): void {
    this.abortController?.abort();
  }

  getCandidateSet(runId: string): CandidateSet | undefined { return this.candidateService.getForRun(runId); }
  getTastePreferences(): TastePreferences { return this.tastePreferences; }

  async chooseCandidate(candidateId: string): Promise<AgentRun> {
    if (this.choosingCandidate) throw new Error('Candidate acceptance is already in progress');
    const chosen = [...this.runs.values()].find(run => run.status === 'awaiting_selection'
      && this.candidateService.getForRun(run.runId)?.candidates.some(candidate => candidate.id === candidateId));
    if (!chosen || this.activeRun) throw new Error('Candidate is not awaiting a choice');
    const selected = this.candidateService.getForRun(chosen.runId)!.candidates.find(candidate => candidate.id === candidateId)!;
    const controller = new AbortController();
    this.choosingCandidate = true;
    this.activeRun = chosen;
    this.abortController = controller;
    chosen.status = 'running'; chosen.phase = 'tools'; chosen.finishedAt = undefined;
    this.emit({ type: 'run_started', run: chosen });
    try {
      const accepted = await this.candidateService.accept(candidateId, controller.signal);
      chosen.commandIds = [...new Set([...chosen.commandIds, ...accepted.commandIds])];
      const commandIds = new Set(accepted.commandIds);
      const technical = technicalReview(this.documentManager.getDocument(selected.documentId),
        chosen.actions.filter(action => action.result?.commandId && commandIds.has(action.result.commandId)),
        id => this.documentManager.getDocument(id), id => this.commandBus.getHistory().find(entry => entry.command.id === id)?.command);
      chosen.status = technical.pending.length ? 'partial' : 'completed';
      chosen.stopReason = technical.pending.length ? 'verification_pending' : 'chosen_candidate';
      chosen.finishedAt = Date.now(); chosen.phase = 'review';
      chosen.journal?.push({ phase: 'review', fact: `User selected ${selected.label}` });
      chosen.verification = { verified: ['Canonical replay postconditions match the chosen preview', `User selected ${selected.label}`, ...technical.verified],
        pending: technical.pending, observations: chosen.verification?.observations ?? [], aesthetic: 'pass' };
      this.persistCandidateRun(chosen, 'AI candidate selected');
      this.emit({ type: 'run_completed', run: chosen });
      return chosen;
    }
    catch (error) {
      const retained = error instanceof CandidateAcceptanceError ? error.commandIds
        : this.commandBus.getHistory().filter(entry => entry.agentRunId === chosen.runId).map(entry => entry.command.id);
      chosen.commandIds = [...new Set(retained)];
      chosen.status = controller.signal.aborted ? 'cancelled' : 'partial';
      chosen.stopReason = controller.signal.aborted ? 'candidate_cancelled' : error instanceof CandidateAcceptanceError ? error.stopReason : 'candidate_replay_interrupted';
      chosen.finishedAt = Date.now(); chosen.phase = 'review';
      chosen.error = Redactor.redact((error as Error).message);
      chosen.rollbackBlockedReason = error instanceof CandidateAcceptanceError ? error.rollbackBlockedReason : undefined;
      chosen.verification = { verified: [], pending: ['Candidate replay interrupted; chosen preview was not fully applied'],
        observations: chosen.verification?.observations ?? [], aesthetic: 'pending' };
      chosen.journal?.push({ phase: 'review', fact: chosen.error });
      this.candidateService.discardRun(chosen.runId);
      this.persistCandidateRun(chosen, 'AI candidate interrupted');
      this.emit({ type: chosen.status === 'cancelled' ? 'run_cancelled' : 'run_completed', run: chosen });
      throw error;
    } finally {
      this.choosingCandidate = false;
      if (this.activeRun === chosen) this.activeRun = null;
      if (this.abortController === controller) this.abortController = null;
    }
  }

  discardCandidateRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'awaiting_selection') return;
    this.candidateService.discardRun(runId);
    run.status = 'cancelled'; run.stopReason = 'candidate_discarded'; run.finishedAt = Date.now();
    if (run.verification) run.verification.pending = run.verification.pending.filter(claim => claim !== 'Choose a candidate to apply its edits');
    this.persistCandidateRun(run, 'AI candidates discarded');
    this.emit({ type: 'run_cancelled', run });
  }

  private persistCandidateRun(run: AgentRun, changeSummary: string): void {
    const document = run.documentId ? this.documentManager.getDocument(run.documentId) : null;
    if (!document) return;
    const withoutRun = { ...document, aiHistory: { usedAI: true,
      runs: (document.aiHistory?.runs ?? []).filter(entry => entry.runId !== run.runId) } };
    this.documentManager.updateDocument(appendProjectAiRun(withoutRun, run), changeSummary);
  }

  getRunUndoBlockReason(runId: string): string | null {
    return this.commandBus.getAgentRunUndoBlockReason(runId);
  }

  private rollbackRun(run: AgentRun): boolean {
    const undone = this.commandBus.rollbackAgentRun(run.runId);
    if (!undone && this.commandBus.getHistory().some(entry => entry.agentRunId === run.runId)) {
      run.rollbackBlockedReason = this.getRunUndoBlockReason(run.runId) ?? '无法安全撤销本次任务，当前修改已保留。';
    }
    return undone;
  }

  /**
   * Undo all operations executed during a specific Agent Run.
   */
  undoRun(runId: string): boolean {
    const run = this.runs.get(runId);
    const success = run ? this.rollbackRun(run) : this.commandBus.rollbackAgentRun(runId);
    if (run && success) {
      run.rollbackBlockedReason = undefined;
      run.actions.forEach((act) => {
        if (act.status === 'success') {
          act.status = 'rejected';
        }
      });
    }
    return success;
  }

  /**
   * Run agent with user prompt.
   */
  async run(prompt: string, options?: AgentRunOptions): Promise<AgentRun> {
    if (this.activeRun) {
      throw new Error('An agent run is already in progress.');
    }
    for (const previous of this.runs.values()) if (previous.status === 'awaiting_selection') this.discardCandidateRun(previous.runId);

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const budget = new RunBudget({...options, requestTimeoutMs: options?.requestTimeoutMs ?? this.providerRegistry.getActiveConfig().timeoutMs});
    budget.bindProviderTimeout(this.providerRegistry.getActiveConfig().timeoutMs);
    const maxSteps = budget.limits.maxSteps;
    let harness: HarnessSession | undefined;
    const controller = new AbortController();
    this.abortController = controller;
    const onParentAbort = () => controller.abort();

    // Link optional parent abort signal
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', onParentAbort, { once: true });
      }
    }

    const providerConfig = this.providerRegistry.getActiveConfig();
    let expectedDocument = this.documentManager.getActiveDocument();
    let selectionChanged = false;
    let agentActivatingDocument = false;
    const stopWatchingDocuments = this.documentManager.subscribe(event => {
      if (event.type === 'activated' && !agentActivatingDocument) selectionChanged = true;
    });
    const documentIsCurrent = () => !selectionChanged && this.documentManager.getActiveDocument() === expectedDocument;
    const run: AgentRun = {
      runId,
      documentId: options?.documentId ?? this.documentManager.getActiveDocument()?.id,
      providerId: providerConfig.id,
      modelId: providerConfig.model,
      prompt,
      startedAt: Date.now(),
      actions: [],
      status: 'running',
      commandIds: [],
    };

    this.activeRun = run;
    this.runs.set(runId, run);
    this.commandBus.beginAgentRun(runId, prompt);
    this.emit({ type: 'run_started', run });

    try {
      if (controller.signal.aborted) {
        run.status = 'cancelled';
        run.finishedAt = Date.now();
        this.rollbackRun(run);
        this.emit({ type: 'run_cancelled', run });
        return run;
      }

      let activeWorkspace = options?.workspace || this.resolveWorkspace();
      const activeDoc = expectedDocument;

      // Vision capture if requested
      let visionSnapshot: VisionSnapshot | undefined;

      // Build tool context
      const scopedBus = this.commandBus.forAgentRun(runId);
      const guardedBus = new Proxy<ICommandBus>(scopedBus, {
        get: (target, property) => {
          const value = Reflect.get(target, property, target);
          if (['execute', 'preview', 'beginTransaction', 'commitTransaction', 'abortTransaction', 'undo', 'redo'].includes(String(property))) {
            return (...args: unknown[]) => {
              if (controller.signal.aborted || !documentIsCurrent()) {
                controller.abort();
                throw Object.assign(new Error('文档已切换或修改，本次 AI 任务已停止。'), { name: 'AbortError' });
              }
              const result = Reflect.apply(value, target, args);
              // Synchronous commands publish before returning; keep the next
              // tool tied to our own latest state, never an ambient UI edit.
              expectedDocument = this.documentManager.getActiveDocument();
              if (result instanceof Promise) return result.then(outcome => {
                if (!documentIsCurrent()) controller.abort();
                return outcome;
              });
              return result;
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const toolContext: IToolContext = {
        documentManager: this.documentManager,
        commandBus: guardedBus,
        currentWorkspace: activeWorkspace,
        visionSnapshot,
        observationService: this.observationService,
        candidateService: this.candidateService,
        tastePreferences: this.tastePreferences,
        candidateChoice: id => this.chooseCandidate(id),
        signal:controller.signal,
      };

      harness = new HarnessSession(run,budget,this.documentManager,this.toolRegistry,toolContext,this.capabilityRouter,controller.signal,options ?? {});
      toolContext.candidateExecution = { budget, policy: harness.policy, onAction: (stage, name, args, result) => {
        const entry: AgentActionLogEntry = { id: `candidate_${stage}_${runId}_${run.actions.length}`, runId, stepIndex: budget.state.modelSteps,
          toolName: name, args: sanitizeRuntimeValue(args) as Record<string, unknown>, result: sanitizeRuntimeValue(result) as ToolResult,
          timestamp: Date.now(), status: result.success ? 'success' : 'failed' };
        run.actions.push(entry);
        run.journal?.push({ phase: stage === 'preview' ? 'plan' : 'tools', fact: `${stage}: ${name}` });
        this.emit({ type: 'action_completed', run, entry });
      } };
      if (options?.explore) assertCandidateScope(harness.policy);
      const creativeBrief = activeDoc && harness.policy.visual ? buildCreativeBrief(prompt, activeDoc, { references: options?.references, taskKind: harness.policy.kind }) : undefined;
      if (activeDoc?.kind === 'edit' && creativeBrief?.needsClarification) {
        run.response = '请提供需要保留的标题或文案，再继续设计。';
        throw new HarnessStop('critical_content_missing');
      }
      const taste = creativeBrief ? this.tastePreferences.get(creativeBrief.domain).map(item => item.text) : [];
      const creativeContext = creativeBrief ? `\nCreative brief: ${JSON.stringify(creativeBrief)}. Explicit user style preferences: ${JSON.stringify(taste)}. Never invent missing content or infer preferences from model evaluations.` : '';
      const systemPrompt = this.buildSystemPrompt(activeWorkspace, activeDoc, visionSnapshot) + '\n' + operationGuide(this.toolRegistry,harness.policy) + creativeContext;
      let schemas = initialAgentSchemas(this.toolRegistry,activeWorkspace,harness.policy);

      const messages: AgentMessage[] = [
        { role: 'system', content: systemPrompt },
        ...previousConversationMessages(activeDoc?.aiHistory?.runs ?? []),
        { role: 'user', content: prompt },
      ];

      const provider = this.providerRegistry.getProvider();
      if (harness.policy.visual && options?.includeVision !== false) await harness.initialize(provider);
      const referenceImages = options?.references?.length ? await budget.request(signal => prepareCreativeReferences(
        options.references!, defaultAssetManager, this.capabilityRouter, providerConfig.id, activeDoc ?? undefined, this.observationService, signal, budget), controller.signal, false) : [];
      if (referenceImages.length && provider.capabilities?.vision === false) throw new Error('Reference images require a vision-capable planner');
      harness.setReferenceContext(creativeBrief, taste, referenceImages);
      harness.phase('plan','Plan using task-relevant canonical tools and observation references');
      if (options?.explore) {
        if (!creativeBrief || creativeBrief.needsClarification) throw new Error('Critical layout content is missing; clarify before generating candidates');
        const prepared = harness.plannerMessages(messages, provider);
        const requestMessages = prepared instanceof Promise ? await prepared : prepared;
        if (referenceImages.length) requestMessages.push({ role: 'user', content: JSON.stringify({ references: creativeBrief.references, evidence: referenceImages.map(image => image.evidence ?? { observationId: image.observationId }) }), images: referenceImages });
        requestMessages[0] = { ...requestMessages[0], content: `${requestMessages[0].content}\nReturn JSON only: {"candidates":[{"label":"A","reason":"specific direction","operations":[{"name":"canonical_tool_name","args":{},"ref":"optional_created_id_symbol"}]}]}. Supply one or two plans. Only replayable document edits; no save, export, UI activation, external generation, raster replacement or unsupported mask operations. Use $symbol only in object ID fields after a creation with ref. Keep literal text exact.` };
        const proposal = await budget.request(signal => provider.chat(normalizeImageMessages(requestMessages, provider.imageLimits ?? DEFAULT_IMAGE_LIMITS), [], undefined, signal), controller.signal);
        if (proposal.toolCalls?.length) throw new Error('Candidate planning must return recorded operations, not live tool calls');
        const content = (proposal.content ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
        const parsed = JSON.parse(content) as { candidates?: unknown };
        if (!Array.isArray(parsed.candidates)) throw new Error('Candidate plan is missing');
        const plans = parsed.candidates;
        const set = await budget.request(signal => this.candidateService.create({ runId, brief: creativeBrief, plans, signal,
          execution: toolContext.candidateExecution }), controller.signal, false);
        if (!documentIsCurrent() || controller.signal.aborted) throw Object.assign(new Error('Document changed during candidate preparation'), { name: 'AbortError' });
        run.status = 'awaiting_selection'; run.stopReason = 'awaiting_selection'; run.finishedAt = Date.now();
        run.response = set.candidates.map(candidate => `${candidate.label}: ${candidate.reason}`).join('\n');
        run.verification = { verified: [], pending: ['Choose a candidate to apply its edits'], observations: run.verification?.observations ?? [] };
        this.commandBus.commitAgentRun();
        this.emit({ type: 'run_completed', run });
        return run;
      }
      let stepCount = 0;

      while (stepCount < maxSteps) {
        if (!documentIsCurrent()) controller.abort();
        if (controller.signal.aborted) {
          run.status = 'cancelled';
          run.finishedAt = Date.now();
          this.rollbackRun(run);
          this.emit({ type: 'run_cancelled', run });
          break;
        }

        this.emit({ type: 'step_started', run, stepIndex: stepCount });

        // Call Provider
        const preparedMessages = harness.plannerMessages(messages,provider);
        const requestMessages = preparedMessages instanceof Promise ? await preparedMessages : preparedMessages;
        if (referenceImages.length) requestMessages.push({ role: 'user', content: JSON.stringify({ references: creativeBrief?.references, evidence: referenceImages.map(image => image.evidence ?? { observationId: image.observationId }) }), images: referenceImages });
        const assistantMsg = await budget.request(signal => provider.chat(
          normalizeImageMessages(requestMessages, provider.imageLimits ?? DEFAULT_IMAGE_LIMITS),
          schemas,
          (delta) => {
            this.emit({ type: 'delta', delta, run, stepIndex: stepCount });
          },
          signal
        ),controller.signal);

        if (!documentIsCurrent()) controller.abort();
        if (controller.signal.aborted) {
          run.status = 'cancelled';
          run.finishedAt = Date.now();
          this.rollbackRun(run);
          this.emit({ type: 'run_cancelled', run });
          break;
        }

        messages.push(assistantMsg);

        // Check if LLM requested tool executions
        if (!assistantMsg.toolCalls || assistantMsg.toolCalls.length === 0) {
          run.response = sanitizeRuntimeValue(assistantMsg.content) as string | undefined;
          const result = await harness.finish();
          if (!documentIsCurrent()) {controller.abort();throw Object.assign(new Error('Document changed during review'),{name:'AbortError'});}
          if (result === 'repair') {
            messages.push({role:'user',content:JSON.stringify({repair:run.verification?.pending, instruction:'Apply only targeted repairs using current evidence and canonical tools.'})});
            harness.phase('plan','Targeted repair requested by independent review');
            stepCount++;
            continue;
          }
          run.status = run.verification!.pending.length ? 'partial' : 'completed';
          run.stopReason = run.status === 'partial' ? 'verification_pending' : 'verified';
          run.finishedAt = Date.now();
          this.commandBus.commitAgentRun();
          this.emit({ type: 'run_completed', run });
          break;
        }

        // Execute tool calls sequentially
        for (const tc of assistantMsg.toolCalls) {
          if (!documentIsCurrent()) controller.abort();
          if (controller.signal.aborted) {
            run.status = 'cancelled';
            run.finishedAt = Date.now();
            this.rollbackRun(run);
            this.emit({ type: 'run_cancelled', run });
            return run;
          }

          const tool = this.toolRegistry.get(tc.name);
          harness.beforeTool(tc,tool?.schema.category ?? 'system');
          let toolResult: ToolResult;

          if (!tool) {
            toolResult = {
              success: false,
              toolCallId: tc.id,
              renderRequired: false,
              error: {
                code: 'UNSUPPORTED_OPERATION',
                message: `Tool '${tc.name}' does not exist in registry.`,
              },
            };
          } else {
            // Permission check
            const allowed = await this.permissionGuard.checkPermission(tool, tc.arguments);
            if (!documentIsCurrent()) controller.abort();
            if (controller.signal.aborted) {
              run.status = 'cancelled';
              run.finishedAt = Date.now();
              this.rollbackRun(run);
              this.emit({ type: 'run_cancelled', run });
              return run;
            }
            if (!allowed) {
              toolResult = {
                success: false,
                toolCallId: tc.id,
                renderRequired: false,
                error: {
                  code: 'PERMISSION_DENIED',
                  message: `User rejected permission to execute tool '${tc.name}'.`,
                },
              };
            } else {
              try {
                toolContext.userApproved = tool.schema.riskLevel === 'dangerous';
                agentActivatingDocument = ['activate_document', 'create_document'].includes(tc.name);
                toolResult = tool.schema.category==='read'
                  ? await budget.request(signal=>tool.execute({...toolContext,signal},tc.arguments,tc.id),controller.signal,false)
                  : await tool.execute(toolContext, tc.arguments, tc.id);
                if (toolResult.commandId) {
                  run.commandIds.push(toolResult.commandId);
                }
              } catch (err: any) {
                if(err instanceof HarnessStop||err?.name==='AbortError')throw err;
                toolResult = {
                  success: false,
                  toolCallId: tc.id,
                  renderRequired: false,
                  error: {
                    code: 'COMMAND_FAILED',
                    message: Redactor.redact(err?.message || String(err)),
                  },
                };
              } finally {
                toolContext.userApproved = false;
                agentActivatingDocument = false;
              }
            }
          }

          if (toolResult.success && ['activate_document', 'create_document'].includes(tc.name)) {
            expectedDocument = this.documentManager.getActiveDocument();
            activeWorkspace = expectedDocument?.kind ?? activeWorkspace;
            toolContext.currentWorkspace = activeWorkspace;
            // A snapshot from the previous photo must not follow a document switch.
            toolContext.visionSnapshot = undefined;
            schemas = initialAgentSchemas(this.toolRegistry,activeWorkspace,harness.policy);
            messages[0] = { role: 'system', content: this.buildSystemPrompt(activeWorkspace, expectedDocument)+'\n'+operationGuide(this.toolRegistry,harness.policy) };
          } else if (toolResult.success && tc.name === 'system_save_project') {
            const current = this.documentManager.getActiveDocument();
            // Saving may clear the dirty flag, but must not absorb concurrent edits.
            if (current && expectedDocument &&
              JSON.stringify({ ...current, isDirty: false }) === JSON.stringify({ ...expectedDocument, isDirty: false })) {
              expectedDocument = current;
            }
          }
          if (!documentIsCurrent()) controller.abort();

          if(toolResult.success&&tool?.schema.name==='studio_discover_tools'&&toolResult.data?.expanded) {
            const names=new Set<string>((toolResult.data.schemas??[]).map((schema:{name:string})=>schema.name));
            for(const available of this.toolRegistry.getForWorkspace(activeWorkspace))if(names.has(available.schema.name)&&!schemas.some(schema=>schema.name===available.schema.name))schemas.push(available.schema);
          }

          // Record action entry
          const entry: AgentActionLogEntry = {
            id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            runId,
            stepIndex: stepCount,
            toolName: tool?.schema.name ?? tc.name,
            args: sanitizeRuntimeValue(tc.arguments) as Record<string, any>,
            result: sanitizeRuntimeValue(toolResult) as ToolResult,
            timestamp: Date.now(),
            status: toolResult.success ? 'success' : 'failed',
          };

          run.actions.push(entry);
          this.emit({ type: 'action_completed', run, entry });

          if (controller.signal.aborted) {
            run.status = 'cancelled';
            run.finishedAt = Date.now();
            this.rollbackRun(run);
            this.emit({ type: 'run_cancelled', run });
            return run;
          }

          // Append tool result into message chain for LLM to observe
          await harness.afterTool(tc,toolResult);
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: toAgentObservation(toolResult, tool?.schema.category ?? 'system'),
            images: toolResult.images,
          });
        }

        stepCount++;
      }

      if (stepCount >= maxSteps && run.status === 'running') {
        run.status = 'budget_exhausted';
        harness.stop('maxSteps_exhausted');
        run.finishedAt = Date.now();
        this.commandBus.commitAgentRun();
        this.emit({ type: 'run_completed', run });
      }

    } catch (err: any) {
      if (err instanceof HarnessStop && !controller.signal.aborted) {
        run.status = err.exhausted ? 'budget_exhausted' : 'partial';
        harness?.stop(err.reason);
        run.finishedAt = Date.now();
        this.commandBus.commitAgentRun();
        this.emit({type:'run_completed',run});
      } else if (controller.signal.aborted || err?.name === 'AbortError') {
        run.status = 'cancelled';
        run.finishedAt = Date.now();
        this.rollbackRun(run);
        this.emit({ type: 'run_cancelled', run });
      } else {
        const errorMsg = Redactor.redact(err?.message || String(err));
        run.status = 'failed';
        run.error = errorMsg;
        run.finishedAt = Date.now();
        this.rollbackRun(run);
        this.emit({ type: 'run_failed', run, error: errorMsg });
      }
    } finally {
      if (run.status !== 'awaiting_selection') this.candidateService.discardRun(runId);
      harness?.dispose();
      for (const evidence of run.verification?.observations ?? []) this.observationService.release(evidence.observationId);
      stopWatchingDocuments();
      options?.signal?.removeEventListener('abort', onParentAbort);
      const project = run.documentId ? this.documentManager.getDocument(run.documentId) : null;
      if (project && run.status !== 'running') {
        this.documentManager.updateDocument(appendProjectAiRun(project, run), 'AI conversation');
      }
      this.activeRun = null;
      if (this.abortController === controller) this.abortController = null;
    }

    return run;
  }

  private resolveWorkspace(): 'develop' | 'edit' {
    const doc = this.documentManager.getActiveDocument();
    if (doc?.kind === 'develop') {
      return 'develop';
    }
    return 'edit';
  }

  private buildSystemPrompt(
    workspace: 'develop' | 'edit',
    doc: any | null,
    vision?: VisionSnapshot
  ): string {
    const docName = doc ? (doc.kind === 'develop' ? doc.fileName : doc.name) : '';
    const docInfo = doc
      ? `Active Document: "${docName}" (ID: ${doc.id}, Kind: ${doc.kind}${doc.isRaw ? ', RAW' : ''}, Size: ${doc.width}x${doc.height}px)`
      : 'No document is currently active.';

    const histInfo = vision?.histogram
      ? `Histogram available: Yes (R/G/B/Luminance channels calculated)`
      : 'Histogram available: None';

    return `You are 影序 Studio's desktop image-editing assistant. Use only the supplied tool APIs, never simulated clicks.
Workspace: ${workspace}. ${docInfo}. ${histInfo}.
Use the active document unless a different ID is explicit. Read settings or layer state only when needed; do not guess IDs.
Develop: use develop_set_parameter(parameterId,value[,channel]) for global adjustments; exposure is EV, temperature is Kelvin, HSL needs a channel. If a range is uncertain, query get_develop_parameter_specs for only those IDs. Local edits use mask tools and a maskId.
Edit: inspect layers and selection before targeting an ID; use edit tools for layers, text, masks and canvas operations.
For relative requests, read the current value before setting an absolute value. Check tool errors and report only completed changes. Keep the final response concise.`;
  }
}

import { defaultCommandBus } from '../../history/CommandBus';

export const defaultAgentRuntime = new AgentRuntime(
  defaultProviderRegistry,
  defaultToolRegistry,
  defaultPermissionGuard,
  defaultVisionInspector,
  defaultCommandBus,
  defaultDocumentManager
);
