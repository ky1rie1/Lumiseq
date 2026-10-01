import type { AgentRun } from '../ai/types';
import type { StudioDocument } from '../types/document';
import { Redactor } from '../ai/security/Redactor';
import { sanitizeRuntimeValue } from '../ai/runtime/toolObservation';

function safeArgs(value: unknown): unknown {
  if (typeof value === 'string') return Redactor.redact(value);
  if (Array.isArray(value)) return value.map(safeArgs);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /key|secret|token|authorization|password/i.test(key) ? '[REDACTED]' : safeArgs(item)]));
  return value;
}

/** Project-local record, without API secrets, previews, or large tool-result snapshots. */
export function appendProjectAiRun<T extends StudioDocument>(document: T, run: AgentRun): T {
  const compact: AgentRun = {
    runId: run.runId, documentId: document.id, providerId: run.providerId, modelId: run.modelId,
    prompt: Redactor.redact(String(sanitizeRuntimeValue(run.prompt))), response: run.response ? Redactor.redact(String(sanitizeRuntimeValue(run.response))) : undefined,
    startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status,
    commandIds: [],
    taskKind:run.taskKind,phase:run.phase,stopReason:run.stopReason,
    budget:run.budget?{...run.budget}:undefined,
    verification:run.verification?sanitizeRuntimeValue(run.verification) as AgentRun['verification']:undefined,
    journal:run.journal?sanitizeRuntimeValue(run.journal.slice(-80)) as AgentRun['journal']:undefined,
    actions: run.actions.map(action => {
      const args = safeArgs(sanitizeRuntimeValue(action.args)) as Record<string, unknown>;
      return {
        id: action.id, runId: action.runId, stepIndex: action.stepIndex,
        toolName: action.toolName,
        args: JSON.stringify(args).length <= 8192 ? args : { note: '大型操作参数已省略' },
        timestamp: action.timestamp, status: action.status,
      };
    }),
    error: run.error ? Redactor.redact(run.error) : undefined,
    rollbackBlockedReason: run.rollbackBlockedReason ? Redactor.redact(run.rollbackBlockedReason) : undefined,
  };
  return { ...document, aiHistory: { usedAI: true, runs: [...(document.aiHistory?.runs ?? []), compact] } };
}
