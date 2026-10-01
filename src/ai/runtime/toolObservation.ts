import type { ToolResult, CanonicalToolSchema } from '../types';
import { metadataOnly } from '../providers/imageTransport';

/** Persistence and planner text retain image references and geometry, never pixel bodies. */
export function sanitizeRuntimeValue(value: unknown): unknown {
  const clean=metadataOnly(value);
  if(typeof clean==='string')return clean.replace(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/gi,'[image omitted]');
  if(Array.isArray(clean))return clean.map(sanitizeRuntimeValue);
  if(clean&&typeof clean==='object') {
    const image=typeof (clean as {mimeType?:unknown}).mimeType==='string' && /^image\//i.test((clean as {mimeType:string}).mimeType);
    return Object.fromEntries(Object.entries(clean).filter(([key])=>!image||!['data','blob','base64','url'].includes(key)).map(([key,item])=>[key,sanitizeRuntimeValue(item)]));
  }
  return clean;
}

export function toAgentObservation(result: ToolResult, category: CanonicalToolSchema['category']): string {
  result = sanitizeRuntimeValue(result) as ToolResult;
  const observation: Record<string, unknown> = {
    success: result.success,
    toolCallId: result.toolCallId,
  };
  if (result.commandId) observation.commandId = result.commandId;
  if (result.changedDocumentId) observation.changedDocumentId = result.changedDocumentId;
  if (result.error) observation.error = result.error;
  if (result.warning) observation.warning = result.warning;
  if (result.after !== undefined && (category === 'read' || JSON.stringify(result.after).length <= 500)) {
    observation.after = result.after;
  }
  if (result.data !== undefined && (category === 'read' || JSON.stringify(result.data).length <= 1000)) {
    observation.data = result.data;
  }
  return JSON.stringify(observation);
}
