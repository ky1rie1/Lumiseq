import type { AgentMessage, AgentRun } from '../types';

/** Restore the current document's recent chat, independent of CLI process sessions. */
export function previousConversationMessages(runs: readonly AgentRun[]): AgentMessage[] {
  return runs
    .filter(run => run.status === 'completed' && !!run.response && !!run.prompt)
    .slice(-6)
    .flatMap(run => [
      { role: 'user' as const, content: run.prompt.slice(0, 4_000) },
      { role: 'assistant' as const, content: run.response!.slice(0, 4_000) },
    ]);
}
