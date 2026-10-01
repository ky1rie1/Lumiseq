/** Development-only production editor fixture. No private media or release imports. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditWorkspace } from '../src/ui/workspaces/edit/EditWorkspace';
import { TopMenuBar } from '../src/ui/layout/TopMenuBar';
import type { StudioActionHandlers } from '../src/app/studioActions';
import { createEditDocument, createGroupLayer, createImageLayer, createTextLayer } from '../src/document/EditDocument';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultAssetManager } from '../src/assets/AssetManager';
import { defaultImageEngine } from '../src/engine/WebGLImageEngine';
import { useEditStore } from '../src/stores/useEditStore';
import { useAppStore } from '../src/stores/useAppStore';
import { createReferenceColorPattern } from './referenceColorPattern';
import '../src/styles/globals.css';
import '../src/styles/studio.css';
import '../src/styles/workbench-2026.css';
import '../src/styles/efficiency.css';
import '../src/styles/pro-workbench.css';
import '../src/styles/pro-develop.css';
import '../src/styles/unified-theme.css';
import '../src/styles/window-chrome.css';

const report = document.querySelector<HTMLPreElement>('#report')!;
try {
  const blob = await createReferenceColorPattern();
  const asset = await defaultAssetManager.registerBlob(blob, 'image', '参考色块');
  await defaultImageEngine.loadAsset(asset.id, blob);
  const image = createImageLayer({ id: 'fixture-image', name: '组内参考色块', sourceAssetId: asset.id,
    naturalWidth: 640, naturalHeight: 480 });
  const text = createTextLayer({ id: 'fixture-text', name: '嵌套文字', text: 'Lumiseq', x: 20, y: 24, fontSize: 28 });
  const inner = createGroupLayer({ id: 'fixture-inner', name: '内层组', children: [text] });
  const outer = createGroupLayer({ id: 'fixture-outer', name: '参考组', children: [image, inner] });
  const doc = createEditDocument({ id: 'fixture-edit', name: '图层工作流 · 合成参考',
    width: 800, height: 640, layers: [outer], backgroundColor: '#262626' });
  doc.selectedLayerId = image.id;
  defaultDocumentManager.openDocument(doc);
  useEditStore.getState().loadDocument(doc);
  useAppStore.getState().setWorkspace('edit');
  const writeReport = () => {
    const current = defaultDocumentManager.getEditDocument(doc.id);
    report.textContent = JSON.stringify({ ready: true, document: current }, null, 2);
  };
  defaultDocumentManager.subscribe(writeReport);
  const noop = () => {};
  const actions: StudioActionHandlers = { openFile: noop, createCanvas: noop, openDocument: noop,
    openRecentProject: noop, saveProject: noop, saveProjectAs: noop, exportImage: noop,
    closeActiveDocument: noop, closeDocument: noop };
  createRoot(document.querySelector('#fixture')!).render(<><TopMenuBar actions={actions}/>
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><EditWorkspace onExport={noop}/></div></>);
  writeReport();
} catch (error) {
  report.textContent = JSON.stringify({ ready: false, error: String(error) });
}
