/** Production dock, with controlled responses only at secret, CLI and runtime boundaries. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AIPanel } from '../src/ui/ai/AIPanel';
import { defaultProviderRegistry as providers } from '../src/ai/providers/ProviderRegistry';
import { nativeLocalAgentRunner } from '../src/ai/providers/LocalAgentProvider';
import { defaultAgentRuntime as runtime } from '../src/ai/runtime/AgentRuntime';
import { defaultDocumentManager as documents } from '../src/document/DocumentManager';
import { createEditDocument } from '../src/document/EditDocument';
import { useAppStore } from '../src/stores/useAppStore';
import type { AgentRun } from '../src/ai/types';
import type { AgentRuntimeEvent } from '../src/ai/runtime/AgentRuntime';
import type { StudioActionHandlers } from '../src/app/studioActions';
import '../src/styles/globals.css';
import '../src/styles/studio.css';
import '../src/styles/unified-theme.css';

let hasKey = false, available = false, delay = false, failure = false;
let active: AgentRun | null = null;
let finish: ((run: AgentRun) => void) | undefined;
const listeners = new Set<(event: AgentRuntimeEvent) => void>();
const sent: string[] = [];
providers.hasApiKey = async id => {
  const value = hasKey;
  if (delay && id === 'openai') await new Promise(resolve => setTimeout(resolve, 900));
  return value;
};
nativeLocalAgentRunner.probe = async () => ({ available, detail: available ? 'Fixture CLI available' : '本机未检测到此 Agent。' });
runtime.subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
runtime.getActiveRun = () => active;
runtime.run = async prompt => {
  sent.push(prompt);
  if (failure) throw new Error('测试服务暂时不可用：请保留当前草稿后重试。');
  active = { runId: `fixture-${sent.length}`, documentId: 'panel-fixture', prompt, startedAt: Date.now(), status: 'running',
    phase: 'observation', actions: [], commandIds: [], providerId: providers.getActiveConfig().id, modelId: providers.getActiveConfig().model };
  for (const listener of listeners) listener({ type: 'run_started', run: active });
  for (const listener of listeners) listener({ type: 'delta', delta: '正在检查主体、文字层级和边缘细节。\n' });
  return new Promise(resolve => { finish = resolve; });
};
function complete(status: 'completed' | 'cancelled' | 'failed') {
  if (!active) return;
  active.status = status; active.phase = 'review';
  active.response = '已检查画面整体与局部细节。';
  active.verification = { verified: ['画布尺寸保持不变'], pending: ['视觉效果等待用户确认'], observations: [] };
  if (status === 'failed') active.error = 'Fixture service unavailable';
  active.actions = [{ id: 'fixture-action', runId: active.runId, stepIndex: 0, toolName: 'edit_get_document_observation', args: { detail: 'overview' },
    status: 'success', timestamp: Date.now(), result: { success: true, toolCallId: 'fixture-action', renderRequired: false, data: { summary: 'Overview recorded' } } }];
  for (const listener of listeners) listener({ type: status === 'completed' ? 'run_completed' : status === 'failed' ? 'run_failed' : 'run_cancelled', run: active });
  finish?.(active); active = null; finish = undefined;
}
runtime.cancelActiveRun = () => complete('cancelled');
documents.openDocument(createEditDocument({ id: 'panel-fixture', name: 'Lumiseq · 银色工作台与非常长的文档名称测试.png', width: 1000, height: 700, layers: [] }));
useAppStore.setState({ isAiPanelOpen: true, currentWorkspace: 'edit' });

function Fixture() {
  const [, redraw] = useState(0);
  const configure = (mode: string) => {
    hasKey = mode !== 'empty'; available = mode === 'agent'; delay = mode === 'slow'; failure = mode === 'failure';
    providers.setActiveProvider(mode === 'agent' || mode === 'missing' ? 'codex-desktop' : mode === 'long' ? 'qwen' : 'openai');
    if (mode === 'long') providers.saveConfig({ ...providers.getActiveConfig(), name: 'A very long provider name for layout verification', model: 'a-very-long-model-id-with-detailed-configuration-2026' });
    else providers.saveConfig({ ...providers.getActiveConfig() });
    redraw(value => value + 1);
  };
  return <main className="studio-app" style={{ display: 'flex', height: '100dvh', overflow: 'hidden', background: 'var(--ui-base)' }}>
    <section style={{ flex: 1, minWidth: 0, padding: 20, overflow: 'auto' }}>
      <h1 style={{ fontSize: 18 }}>AI 面板验收</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
        {['empty', 'configured', 'missing', 'agent', 'slow', 'long', 'failure'].map(mode => <button key={mode} onClick={() => configure(mode)}>{mode}</button>)}
        <button onClick={() => complete('completed')}>complete</button>
        <button onClick={() => complete('failed')}>fail run</button>
        <button onClick={() => { const next = document.documentElement.dataset.motion === 'off' ? 'full' : 'off'; document.documentElement.dataset.motion = next; }}>motion</button>
        <button onClick={() => useAppStore.setState({ isAiPanelOpen: true })}>open dock</button>
      </div>
      <pre id="panel-report" style={{ whiteSpace: 'pre-wrap', marginTop: 20 }}>{JSON.stringify({ sent, hasKey, active: active?.status ?? null }, null, 2)}</pre>
    </section>
    <AIPanel actions={{ openFile() {}, createCanvas() {} } as unknown as StudioActionHandlers} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
