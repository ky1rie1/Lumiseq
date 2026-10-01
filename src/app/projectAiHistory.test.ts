import { describe, expect, it } from 'vitest';
import { createEditDocument } from '../document/EditDocument';
import { createDevelopDocument } from '../document/DevelopDocument';
import { appendProjectAiRun } from './projectAiHistory';

describe('project AI history', () => {
  it('binds prompt, reply, model and operations to one document without storing credentials', () => {
    const doc = createEditDocument({ name: '海报' });
    const result = appendProjectAiRun(doc, {
      runId: 'run-1', prompt: '删除背景', response: '已删除背景', startedAt: 10, finishedAt: 20,
      status: 'completed', commandIds: ['cmd-1'], providerId: 'openai', modelId: 'example-model',
      actions: [{ id: 'a1', runId: 'run-1', stepIndex: 0, toolName: 'edit_select_background',
        args: { documentId: doc.id, apiKey: 'plain-secret' }, timestamp: 12, status: 'success',
        result: { success: true, toolCallId: 'x', renderRequired: true, after: { image: 'large blob' } } }],
    });
    expect(result.aiHistory?.usedAI).toBe(true);
    expect(result.aiHistory?.runs[0]).toMatchObject({ prompt: '删除背景', response: '已删除背景', providerId: 'openai', modelId: 'example-model' });
    expect(result.aiHistory?.runs[0].actions[0].args.apiKey).toBe('[REDACTED]');
    expect(JSON.stringify(result.aiHistory)).not.toContain('plain-secret');
    expect(JSON.stringify(result.aiHistory)).not.toContain('large blob');
    expect(doc.aiHistory).toBeUndefined();
  });
  it('also attaches AI conversations to RAW develop documents', () => {
    const doc = createDevelopDocument({ sourceUri: 'C:\\photo.cr3', fileName: 'photo.cr3', isRaw: true });
    const result = appendProjectAiRun(doc, {
      runId: 'raw-run', documentId: doc.id, prompt: '提亮天空', startedAt: 10, finishedAt: 20,
      status: 'completed', commandIds: [], providerId: 'openai', modelId: 'example-model', actions: [],
    });
    expect(result.aiHistory?.runs[0].prompt).toBe('提亮天空');
  });
  it('persists terminal verification and budgets as metadata while scrubbing image-bearing fields',()=>{
    const doc=createEditDocument({});
    const result=appendProjectAiRun(doc,{runId:'partial',prompt:'test',response:'result data:image/png;base64,aGVsbG8=',startedAt:1,status:'partial',stopReason:'detail_coverage_pending',taskKind:'local-detail',phase:'review',budget:{modelSteps:2,toolCalls:3,images:1,imageBytes:5,detailTiles:1,repairRounds:0},verification:{verified:['actual value'],pending:['coverage pending'],observations:[],aesthetic:'pending'},journal:[{phase:'review',fact:'coverage pending'}],commandIds:[],actions:[{id:'a',runId:'partial',stepIndex:1,toolName:'read',args:{nested:{mimeType:'image/png',data:'aGVsbG8='}},status:'success',timestamp:2}]});
    expect(result.aiHistory?.runs[0]).toMatchObject({status:'partial',stopReason:'detail_coverage_pending',taskKind:'local-detail',budget:{images:1},verification:{pending:['coverage pending'],aesthetic:'pending'}});
    expect(JSON.stringify(result.aiHistory)).not.toContain('aGVsbG8=');
  });
});
