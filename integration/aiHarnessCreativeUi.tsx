/** Production creative controls with original media and memory-only preferences. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CreativeReview } from '../src/ui/ai/CreativeReview';
import { TasteSettings } from '../src/ui/ai/TasteSettings';
import { CandidateService, type CandidateSet } from '../src/ai/harness/CandidateService';
import { TastePreferences } from '../src/ai/harness/TastePreferences';
import { buildCreativeBrief } from '../src/ai/harness/CreativeBrief';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { AssetManager } from '../src/assets/AssetManager';
import { ToolRegistry } from '../src/ai/tools/ToolRegistry';
import { PermissionGuard } from '../src/ai/permissions/PermissionGuard';
import { DocumentObservationService } from '../src/ai/vision/DocumentObservationService';
import { createEditDocument, createImageLayer } from '../src/document/EditDocument';
import type { AgentRun } from '../src/ai/types';
import '../src/styles/globals.css';
import '../src/styles/studio.css';
import '../src/styles/unified-theme.css';

const assets = new AssetManager(), documents = new DocumentManager(), bus = new CommandBus(documents);
const observer = new DocumentObservationService({ documents, assets });
const memory = new Map<string, string>();
const preferences = new TastePreferences({ getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => { memory.set(key, value); }, removeItem: key => { memory.delete(key); } });
const service = new CandidateService({ documents, commandBus: bus, assets, observationService: observer,
  toolRegistry: new ToolRegistry(), permissionGuard: new PermissionGuard() });
const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = '#ded5c6'; ctx.fillRect(0, 0, 1200, 800);
ctx.fillStyle = '#477167'; ctx.fillRect(180, 130, 840, 540);
ctx.fillStyle = '#d6b67b'; ctx.beginPath(); ctx.arc(790, 300, 135, 0, 2 * Math.PI); ctx.fill();
const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(v => v ? resolve(v) : reject(new Error('Original fixture failed'))));
const asset = await assets.registerBlob(blob, 'image', 'Original candidate workbench pattern');
const layer = createImageLayer({ id: 'creative-base', name: 'Original candidate pattern', sourceAssetId: asset.id, naturalWidth: 1200, naturalHeight: 800 });
documents.openDocument(createEditDocument({ id: 'creative-ui', name: '候选验收', width: 1200, height: 800, layers: [layer] }));
const prompt = '保留主体，添加“LUMISEQ”作为标题。';
const run: AgentRun = { runId: 'creative-ui-run', documentId: 'creative-ui', prompt, startedAt: Date.now(),
  status: 'awaiting_selection', taskKind: 'layout', phase: 'review', actions: [], commandIds: [],
  verification: { verified: [], pending: ['候选尚未应用，等待用户选择'], observations: [] } };
const candidates = await service.create({ runId: run.runId, brief: buildCreativeBrief(prompt, documents.getActiveDocument()!), plans: [
  { label: 'A · 清晰标题', reason: '保留原图，在左上方增加简洁标题。', operations: [
    { name: 'edit_create_text_layer', args: { text: 'LUMISEQ', x: 220, y: 195, fontSize: 88, color: '#fff8e7' } },
  ] },
  { label: 'B · 柔和对比', reason: '稍微减弱图像强度，让标题更安静。', operations: [
    { name: 'edit_set_layer_opacity', args: { layerId: layer.id, opacity: 0.75 } },
    { name: 'edit_create_text_layer', args: { text: 'LUMISEQ', x: 220, y: 540, fontSize: 70, color: '#ffffff' } },
  ] },
] });

function Fixture() {
  const [set, setSet] = useState<CandidateSet | undefined>(candidates);
  const [message, setMessage] = useState('原稿保持不变，等待选择。');
  const [, refresh] = useState(0);
  const doc = documents.getEditDocument('creative-ui')!;
  return <main style={{ maxWidth: 1080, margin: '0 auto', padding: 24, minHeight: '100vh' }}>
    <h1 style={{ fontSize: 20 }}>Lumiseq · 候选与偏好验收</h1>
    <p>原创图像、生产控件与真实命令；不调用外部模型，偏好仅在本页内存保存。</p>
    {set && <CreativeReview run={run} candidates={set} preferences={preferences}
      onChoose={async id => {
        const result = await service.accept(id);
        run.commandIds = result.commandIds;
        run.status = 'completed';
        setSet(undefined); setMessage('所选方案已应用，可整组撤销。');
      }} onDiscard={() => { service.discardRun(run.runId); setSet(undefined); setMessage('候选已放弃，原稿保留。'); }} />}
    <p role="status">{message}</p>
    <button type="button" onClick={() => { const ok = bus.undoLastAgentRun();
      setMessage(ok ? '任务已撤销，原稿恢复。' : '没有可撤销的任务。'); refresh(v => v + 1); }}>撤销验收任务</button>
    <TasteSettings preferences={preferences} />
    <pre id="creative-ui-report" style={{ whiteSpace: 'pre-wrap', padding: 12 }}>{JSON.stringify({
      layers: doc.layers.map(l => ({ id: l.id, type: l.type, name: l.name, opacity: l.opacity,
        ...(l.type === 'text' ? { text: l.text } : {}) })), selectedLayerId: doc.selectedLayerId,
      history: bus.getHistory().map(entry => ({ id: entry.id, agentRunId: entry.agentRunId })),
      status: run.status, preferencesAreMemoryOnly: true,
    }, null, 2)}</pre>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
window.addEventListener('pagehide', () => { service.discardRun(run.runId); observer.dispose(); assets.releaseAsset(asset.id); });
