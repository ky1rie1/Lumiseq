import { CanonicalTool, type IToolContext } from '../CanonicalTool';
import type { CanonicalToolSchema, JSONSchemaProperty, ToolResult } from '../../types';
import { buildCreativeBrief } from '../../harness/CreativeBrief';
import { defaultTastePreferences } from '../../harness/TastePreferences';
import { classifyTask } from '../../harness/TaskPolicy';
import { assertCandidateScope } from '../../harness/CandidateService';

type Handler = (context: IToolContext, args: Record<string, any>) => Promise<unknown> | unknown;
class CreativeTool extends CanonicalTool {
  constructor(readonly schema: CanonicalToolSchema, private readonly handler: Handler) { super(); }
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    try {
      const data = await this.handler(context, args);
      const images = this.schema.name === 'studio_create_candidates' || this.schema.name === 'studio_list_candidates'
        ? [ (data as any)?.baseline?.preview, ...((data as any)?.candidates ?? []).map((candidate: any) => candidate.preview) ]
          .filter((preview): preview is string => typeof preview === 'string')
          .map(preview => { const match = preview.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/); if (!match) throw new Error('Invalid candidate preview');
            return { mimeType: match[1], data: match[2] }; })
        : undefined;
      return { success: true, toolCallId, renderRequired: false, data, images };
    }
    catch (error) { return { success: false, toolCallId, renderRequired: false,
      error: { code: error instanceof Error && /permission|approval|user feedback/i.test(error.message) ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT',
        message: error instanceof Error ? error.message : String(error) } }; }
  }
}
const schema = (name: string, description: string, category: CanonicalToolSchema['category'],
  riskLevel: CanonicalToolSchema['riskLevel'], properties: Record<string, Omit<JSONSchemaProperty, 'description'> & { description?: string }>, required: string[]): CanonicalToolSchema =>
  ({ name, description, workspace: 'any', category, riskLevel, parameters: { type: 'object',
    properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, { description: key, ...value }])), required } });
const text = { type: 'string' as const };
const domain = { type: 'string' as const, enum: ['photo', 'layout'] };

export function creativeTools(): CanonicalTool[] {
  return [
    new CreativeTool(schema('studio_build_creative_brief', 'Build an evidence-bound photography or layout brief from the stated goal.', 'read', 'safe',
      { prompt: text, taskKind: text, documentId: text }, ['prompt']), (context, args) => {
      const document = context.documentManager.getDocument(args.documentId ?? context.documentManager.getActiveDocument()?.id ?? '');
      if (!document) throw new Error('Document not found');
      return buildCreativeBrief(String(args.prompt), document, { taskKind: args.taskKind });
    }),
    new CreativeTool(schema('studio_get_taste_preferences', 'Read explicit user style preferences by creative domain.', 'read', 'safe',
      { domain }, ['domain']), (context, args) => (context.tastePreferences ?? defaultTastePreferences).get(args.domain)),
    new CreativeTool(schema('studio_save_taste_preference', 'Save, edit, remove or clear user-confirmed style feedback.', 'system', 'dangerous',
      { domain, action: { type: 'string', enum: ['save', 'edit', 'remove', 'clear'] }, text, id: text }, ['domain']), (context, args) => {
      if (!context.userApproved) throw new Error('Explicit user approval required');
      const preferences = context.tastePreferences ?? defaultTastePreferences;
      const approval = preferences.beginUserFeedback();
      switch (args.action ?? 'save') {
        case 'save': return preferences.save(args.domain, String(args.text ?? ''), approval);
        case 'edit': preferences.edit(args.domain, String(args.id), String(args.text ?? ''), approval); return preferences.get(args.domain);
        case 'remove': preferences.remove(args.domain, String(args.id), approval); return preferences.get(args.domain);
        case 'clear': preferences.clear(args.domain, approval); return [];
        default: throw new Error('Unsupported preference action');
      }
    }),
    new CreativeTool(schema('studio_create_candidates', 'Preview one or two replayable canonical edit plans without changing the source.', 'system', 'safe',
      { runId: text, prompt: text, taskKind: text, plans: { type: 'array', items: { type: 'object', description: 'Candidate plan',
        properties: { label: { type: 'string', description: 'Short candidate label' }, reason: { type: 'string', description: 'Specific creative direction' },
          operations: { type: 'array', description: 'Replayable canonical edit operations', items: { type: 'object', description: 'Canonical operation',
            properties: { name: { type: 'string', description: 'Canonical tool name' }, args: { type: 'object', description: 'Canonical tool arguments' },
              ref: { type: 'string', description: 'Optional symbol for a newly created object ID' } }, required: ['name', 'args'] } } },
        required: ['label', 'reason', 'operations'] } } }, ['runId', 'prompt', 'plans']), async (context, args) => {
      if (!context.candidateService) throw new Error('Candidate service unavailable');
      const document = context.documentManager.getActiveDocument(); if (!document) throw new Error('Document not found');
      assertCandidateScope(context.candidateExecution?.policy ?? classifyTask(String(args.prompt), document, { taskKind: args.taskKind }));
      const brief = buildCreativeBrief(String(args.prompt), document, { taskKind: args.taskKind });
      if (brief.needsClarification) throw new Error('Critical content needs clarification');
      return context.candidateService.create({ runId: String(args.runId), brief, plans: args.plans, signal: context.signal,
        execution: context.candidateExecution });
    }),
    new CreativeTool(schema('studio_list_candidates', 'List active original and candidate previews for a run.', 'read', 'safe',
      { runId: text }, ['runId']), (context, args) => context.candidateService?.getForRun(String(args.runId)) ?? null),
    new CreativeTool(schema('studio_choose_candidate', 'Apply a chosen candidate after explicit user confirmation.', 'system', 'dangerous',
      { candidateId: text }, ['candidateId']), async (context, args) => {
      if (!context.userApproved) throw new Error('Explicit user approval required');
      if (context.candidateChoice) return context.candidateChoice(String(args.candidateId));
      if (!context.candidateService) throw new Error('Candidate service unavailable');
      return context.candidateService.accept(String(args.candidateId));
    }),
    new CreativeTool(schema('studio_discard_candidate', 'Discard an unchosen candidate and its owned resources.', 'system', 'dangerous',
      { candidateId: text }, ['candidateId']), (context, args) => {
      if (!context.userApproved) throw new Error('Explicit user approval required');
      if (!context.candidateService) throw new Error('Candidate service unavailable');
      context.candidateService.discard(String(args.candidateId)); return { discarded: true };
    }),
  ];
}
