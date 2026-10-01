import { expect, it } from 'vitest';
import { previousConversationMessages } from './conversationContext';
import type { AgentRun } from '../types';

const run = (i: number, status: AgentRun['status'] = 'completed'): AgentRun => ({
  runId: String(i), prompt: `question ${i}`, response: `answer ${i}`,
  startedAt: i, status, actions: [], commandIds: [],
});

it('restores recent completed chat turns in order without failed runs', () => {
  const messages = previousConversationMessages([run(1), run(2, 'failed'), run(3)]);
  expect(messages.map(message => message.content)).toEqual(['question 1', 'answer 1', 'question 3', 'answer 3']);
});

it('bounds history to recent short text and excludes untrusted massive content', () => {
  const many = Array.from({ length: 20 }, (_, i) => run(i));
  const messages = previousConversationMessages(many);
  expect(messages).toHaveLength(12);
  expect(messages[0].content).toBe('question 14');
  const huge = { ...run(21), response: 'x'.repeat(30_000) };
  expect(previousConversationMessages([huge])[1].content?.length).toBeLessThanOrEqual(4_000);
});
