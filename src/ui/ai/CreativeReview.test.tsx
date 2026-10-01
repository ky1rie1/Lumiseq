import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreativeReview } from './CreativeReview';
import { TasteSettings } from './TasteSettings';
import { TastePreferences } from '../../ai/harness/TastePreferences';
import type { AgentRun } from '../../ai/types';
import { ActionLogView } from './ActionLogView';

it('shows original and actual candidate previews with direction and explicit user controls', () => {
  const run: AgentRun = { runId: 'run', prompt: 'Poster', status: 'awaiting_selection', actions: [], startedAt: 1, commandIds: [] };
  const markup = renderToStaticMarkup(<CreativeReview run={run} candidates={{ baseline: { preview: 'data:image/png;base64,original', revision: 'r1' }, candidates: [
    { id: 'a', runId: 'run', documentId: 'doc', label: 'A', reason: 'Clear headline', preview: 'data:image/png;base64,candidate', operations: [], createdIds: {} },
  ] }} onChoose={async () => {}} onDiscard={() => {}} />);
  expect(markup).toContain('data:image/png;base64,original');
  expect(markup).toContain('data:image/png;base64,candidate');
  expect(markup).toContain('Clear headline');
  expect(markup).toContain('选择 A');
  expect(markup).toContain('放弃候选');
  expect(markup).toContain('保存为风格偏好');
});

it('shows separate photography and layout preferences with edit and clear actions', () => {
  const preferences = new TastePreferences();
  preferences.save('photo', 'Natural skin', preferences.beginUserFeedback());
  const markup = renderToStaticMarkup(<TasteSettings preferences={preferences} />);
  expect(markup).toContain('摄影'); expect(markup).toContain('排版');
  expect(markup).toContain('Natural skin'); expect(markup).toContain('编辑');
  expect(markup).toContain('清空摄影偏好');
});

it('shows task phase, consumed budget and verified versus pending claims', () => {
  const run: AgentRun = { runId: 'run', prompt: 'Photo', status: 'awaiting_selection', phase: 'review', actions: [], startedAt: 1, commandIds: [],
    budget: { modelSteps: 2, toolCalls: 3, images: 4, imageBytes: 200, detailTiles: 1, repairRounds: 0 },
    verification: { verified: ['Exact text preserved'], pending: ['Review skin'], observations: [] } };
  const markup = renderToStaticMarkup(<ActionLogView run={run} />);
  expect(markup).toContain('已核验'); expect(markup).toContain('待确认');
  expect(markup).toContain('Exact text preserved'); expect(markup).toContain('Review skin');
  expect(markup).toContain('模型 2'); expect(markup).toContain('评审');
});
