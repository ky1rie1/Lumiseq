/** Development-only: production RAW controls with original raster fixtures, no camera claims. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DevelopWorkspace } from '../src/ui/workspaces/develop/DevelopWorkspace';
import { TopMenuBar } from '../src/ui/layout/TopMenuBar';
import type { StudioActionHandlers } from '../src/app/studioActions';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultCommandBus } from '../src/history/CommandBus';
import { defaultAssetManager } from '../src/assets/AssetManager';
import { defaultImageEngine } from '../src/engine/WebGLImageEngine';
import { useDevelopStore } from '../src/stores/useDevelopStore';
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
  const asset = await defaultAssetManager.registerBlob(blob, 'image', '调色参考色块');
  await defaultImageEngine.loadAsset(asset.id, blob);
  const common = { sourceUri: 'memory://verification', isRaw: false, sourceAssetId: asset.id,
    width: 640, height: 480 };
  const source = createDevelopDocument({ ...common, id: 'fixture-develop-source', fileName: '来源 · 合成参考.png',
    settings: { exposure: 1.25, contrast: 12, whiteBalance: { mode: 'custom', temperature: 5000, tint: 12 },
      curves: { rgb: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }],
        red: [{ x: 0, y: 0 }, { x: 1, y: 1 }], green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } } });
  const target = createDevelopDocument({ ...common, id: 'fixture-develop-target', fileName: '目标 · 合成参考.png',
    settings: { whiteBalance: { mode: 'custom', temperature: 6500, tint: -8 } } });
  defaultDocumentManager.openDocument(target, false);
  defaultDocumentManager.openDocument(source);
  useDevelopStore.getState().loadDocument(source);
  useAppStore.getState().setWorkspace('develop');
  const writeReport = () => {
    report.textContent = JSON.stringify({ ready: true,
      source: defaultDocumentManager.getDevelopDocument(source.id),
      target: defaultDocumentManager.getDevelopDocument(target.id),
      history: defaultCommandBus.getHistory().map(entry => ({ name: entry.name, documentId: entry.documentId })) }, null, 2);
  };
  defaultDocumentManager.subscribe(writeReport);
  defaultCommandBus.subscribe(writeReport);
  const noop = () => {};
  const actions: StudioActionHandlers = { openFile: noop, createCanvas: noop, openDocument: id => {
    const selected = defaultDocumentManager.getDevelopDocument(id);
    if (!selected) return;
    defaultDocumentManager.setActiveDocument(id);
    useAppStore.getState().setActiveDocumentId(id);
    useDevelopStore.getState().loadDocument(selected);
    useAppStore.getState().setWorkspace('develop');
  },
    openRecentProject: noop, saveProject: noop, saveProjectAs: noop, exportImage: noop,
    closeActiveDocument: noop, closeDocument: noop };
  createRoot(document.querySelector('#fixture')!).render(<><TopMenuBar actions={actions}/>
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><DevelopWorkspace onExport={noop}/></div></>);
  writeReport();
} catch (error) {
  report.textContent = JSON.stringify({ ready: false, error: String(error) });
}
