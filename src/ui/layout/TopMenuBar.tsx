import { lazy, Suspense, useRef, useState } from 'react';
import { Download, FilePlus, FolderOpen, Home, Layers, RotateCcw, RotateCw, Save, SaveAll, Search, Settings, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { useHistoryStore } from '../../stores/useHistoryStore';
import { WorkspaceType } from '../../types/common';
import { APP_NAME } from '../../core/brand';
import { StudioActionHandlers } from '../../app/studioActions';
import { BrandMark } from '../shared/BrandMark';
import { useDocuments } from '../shared/useDocuments';
import '../shared/iconHints.css';
import { useWindowChrome } from './useWindowChrome';
import { WindowControls } from './WindowControls';
const SettingsCenter = lazy(() => import('../settings/SettingsCenter').then(module => ({ default: module.SettingsCenter })));

const workspaces: { id: WorkspaceType; label: string; icon: typeof Home }[] = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'edit', label: '图像编辑', icon: Layers },
  { id: 'develop', label: '照片调色', icon: SlidersHorizontal },
];

export function TopMenuBar({ actions }: { actions: StudioActionHandlers }) {
  const workspace = useAppStore(s => s.currentWorkspace);
  const setWorkspace = useAppStore(s => s.setWorkspace);
  const isAiPanelOpen = useAppStore(s => s.isAiPanelOpen);
  const toggleAiPanel = useAppStore(s => s.toggleAiPanel);
  const setCommandBarOpen = useAppStore(s => s.setCommandBarOpen);
  const canUndo = useHistoryStore(s => s.canUndo);
  const canRedo = useHistoryStore(s => s.canRedo);
  const undo = useHistoryStore(s => s.undo);
  const redo = useHistoryStore(s => s.redo);
  const { documents, activeDocument } = useDocuments();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chrome = useWindowChrome();
  return <>
    <header className={`studio-header${chrome.native ? ' has-window-controls' : ''}`} data-tauri-drag-region={chrome.native || undefined}>
      <div className="header-start header-capsule" role="group" aria-label="文件操作" data-tauri-drag-region={chrome.native || undefined}>
        <button className="brand-button" onClick={() => setWorkspace('home')} aria-label={`${APP_NAME} 首页`}><BrandMark /><span>影序<span className="brand-studio">Lumiseq</span></span></button>
        <span className="header-divider" data-tauri-drag-region={chrome.native || undefined} />
        <button className="header-action icon-hint" onClick={actions.openFile} aria-label="打开文件" data-tooltip="打开文件"><FolderOpen size={17} /></button>
        <button className="header-action icon-hint" onClick={actions.createCanvas} aria-label="新建文档" data-tooltip="新建文档"><FilePlus size={17} /></button>
        <button className="header-action header-save icon-hint" onClick={actions.saveProject} aria-label="保存项目" data-tooltip="保存项目 · Ctrl+S"><Save size={17} /></button>
        <button className="header-action icon-hint" onClick={actions.saveProjectAs} aria-label="另存为" data-tooltip="另存为 · Ctrl+Shift+S"><SaveAll size={17} /></button>
        <span className="header-divider" data-tauri-drag-region={chrome.native || undefined} />
        <button className="header-action icon-hint" onClick={actions.exportImage} disabled={!activeDocument} aria-label="导出图像" data-tooltip="导出图像"><Download size={17} /></button>
      </div>
      <nav className="workspace-switch" aria-label="工作区" data-tauri-drag-region={chrome.native || undefined}>
        {workspaces.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setWorkspace(id)} aria-label={label} data-tooltip={label} aria-current={workspace === id ? 'page' : undefined} className={`icon-hint${workspace === id ? ' is-active' : ''}`}><Icon size={16} strokeWidth={1.75} /><span>{label}</span></button>)}
      </nav>
      <div className="header-end header-capsule" role="group" aria-label="工作台操作" data-tauri-drag-region={chrome.native || undefined}>
        {workspace !== 'home' && <div className="history-actions"><button className="icon-button icon-hint" disabled={!canUndo} onClick={() => { void undo(); }} aria-label="撤销" data-tooltip="撤销 · Ctrl+Z"><RotateCcw size={15} /></button><button className="icon-button icon-hint" disabled={!canRedo} onClick={() => { void redo(); }} aria-label="重做" data-tooltip="重做 · Ctrl+Shift+Z"><RotateCw size={15} /></button></div>}
        <button className="icon-button search-action icon-hint" onClick={() => setCommandBarOpen(true)} data-tooltip="快速查找 · Ctrl+K" aria-label="快速查找文档与命令" aria-haspopup="dialog"><Search size={17} /></button>
        <button className={`icon-button icon-hint ${isAiPanelOpen ? 'is-active' : ''}`} aria-label="AI 助手" data-tooltip="AI 助手" aria-pressed={isAiPanelOpen} onClick={toggleAiPanel}><Sparkles size={17} /></button>
        <button ref={triggerRef} className={`icon-button icon-hint settings-trigger ${settingsOpen ? 'is-active' : ''}`} onClick={() => setSettingsOpen(true)} aria-label="设置" data-tooltip="设置" aria-haspopup="dialog" aria-expanded={settingsOpen}><Settings size={18} strokeWidth={1.75} /></button>
      </div>
      {chrome.native && <WindowControls maximized={chrome.maximized} run={chrome.run} />}
    </header>
    {documents.length > 0 && <div className="document-strip" role="tablist" aria-label="已打开文档">
      {documents.map(doc => <div key={doc.id} className={`document-tab${activeDocument?.id === doc.id && workspace !== 'home' ? ' is-active' : ''}`}>
        <button type="button" role="tab" aria-selected={activeDocument?.id === doc.id && workspace !== 'home'} onClick={() => actions.openDocument(doc.id)} title={`${doc.kind === 'edit' ? doc.name : doc.fileName} · ${doc.width} × ${doc.height} px`}>
          {doc.kind === 'edit' ? <Layers size={13} /> : <SlidersHorizontal size={13} />}
          <span className="document-tab-name">{doc.kind === 'edit' ? doc.name : doc.fileName}</span>
          {doc.isDirty && <><span className="dirty-dot" aria-hidden="true" /><span className="sr-only">有未保存的修改</span></>}
        </button>
        <button type="button" className="document-close-button" onClick={() => actions.closeDocument(doc.id)} aria-label={`关闭 ${doc.kind === 'edit' ? doc.name : doc.fileName}`} title="关闭文档"><X size={13} /></button>
      </div>)}
      <span className="document-strip-hint">切换工作区后仍可从这里返回文档</span>
    </div>}
    {settingsOpen && <Suspense fallback={null}><SettingsCenter isOpen onClose={() => { setSettingsOpen(false); triggerRef.current?.focus(); }} /></Suspense>}
  </>;
}
