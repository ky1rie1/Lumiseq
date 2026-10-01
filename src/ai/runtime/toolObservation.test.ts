import { describe, expect, it } from 'vitest';
import { toAgentObservation } from './toolObservation';
import type { ToolResult } from '../types';

describe('agent tool observations', () => {
  it('returns command identity without repeating large develop snapshots after edits', () => {
    const settings = { masks: Array.from({ length: 40 }, (_, id) => ({ id, exposure: id / 10 })) };
    const result: ToolResult = { success: true, toolCallId: 'call-1', commandId: 'cmd-1',
      changedDocumentId: 'doc-1', renderRequired: true, before: settings, after: settings };
    const message = JSON.parse(toAgentObservation(result, 'develop'));
    expect(message).toEqual({ success: true, toolCallId: 'call-1', commandId: 'cmd-1', changedDocumentId: 'doc-1' });
  });

  it('keeps read results and concise identifiers from newly created objects', () => {
    const read: ToolResult = { success: true, toolCallId: 'read', renderRequired: false, after: { exposure: 0.5 } };
    expect(JSON.parse(toAgentObservation(read, 'read')).after).toEqual({ exposure: 0.5 });
    const create: ToolResult = { success: true, toolCallId: 'create', renderRequired: true, after: { layerId: 'layer-1' } };
    expect(JSON.parse(toAgentObservation(create, 'edit')).after).toEqual({ layerId: 'layer-1' });
  });
  it('scrubs embedded image URLs and image objects at arbitrary nesting while preserving evidence metadata',()=>{
    const result:ToolResult={success:true,toolCallId:'image',renderRequired:false,data:{note:'prefix data:image/png;base64,aGVsbG8= suffix',nested:[{payload:{mimeType:'image/png',data:'aGVsbG8=',observationId:'obs'}}],evidence:{documentId:'real',width:2}}};
    const text=toAgentObservation(result,'read');
    expect(text).not.toContain('aGVsbG8=');expect(text).not.toContain('data:image/');
    expect(JSON.parse(text).data.evidence).toEqual({documentId:'real',width:2});
    expect(JSON.parse(text).data.nested[0].payload.observationId).toBe('obs');
  });
});
