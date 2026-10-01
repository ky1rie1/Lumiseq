import { prepareWindowClose } from './app/prepareWindowClose';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useAppStore } from './stores/useAppStore';
import { useHistoryStore } from './stores/useHistoryStore';
import { TopMenuBar } from './ui/layout/TopMenuBar';
import { HomeWorkspace } from './ui/workspaces/home/HomeWorkspace';
import { NewProjectDialog } from './ui/workspaces/home/NewProjectDialog';
import { DevelopWorkspace } from './ui/workspaces/develop/DevelopWorkspace';
import { EditWorkspace } from './ui/workspaces/edit/EditWorkspace';
import { AIPanel } from './ui/ai/AIPanel';
import { AICommandBar } from './ui/ai/AICommandBar';
import { openSelectedFile } from './app/documentOpening';
import { handleHistoryShortcut } from './app/keyboard';
import { useAppLifecycle } from './app/useAppLifecycle';
import { readSelectedNativeFile } from './platform/nativeFileDrop';
import { APP_NAME } from './core/brand';
import { defaultDocumentManager } from './document/DocumentManager';
import { defaultDocumentOperations, type CreateDocumentRequest } from './app/DocumentOperationService';
import { type StudioActionHandlers } from './app/studioActions';
import { defaultRecentProjectsStore } from './app/recentProjects';
import { findOpenProjectDocumentId } from './app/projectOpening';
import { defaultProjectOperations } from './app/ProjectOperationService';
import { savedProjectPaths } from './app/projectPaths';
import { getPlatformBridge, isTauriEnvironment, type SelectedFile } from './platform';
import { documentsNeedingSave } from './app/documentClose';
import { saveLayeredPsd } from './app/PsdOperationService';
import { Modal } from './ui/shared/Modal';
import { ExportDialog } from './ui/shared/ExportDialog';
import { AutosaveManager, type RecoveryEntry } from './project/AutosaveManager';
import type { StudioDocument } from './types/document';
import {getStudioPreferences,useStudioPreferences} from './stores/useStudioPreferences';
import {defaultCommandBus} from './history/CommandBus';
import {defaultLocalCutoutProvider} from './cutout/LocalCutoutProvider';

export const App: React.FC = () => {
  const currentWorkspace = useAppStore(s => s.currentWorkspace);
  const [visitedWorkspaces, setVisitedWorkspaces] = useState(() => ({ edit: currentWorkspace === 'edit', develop: currentWorkspace === 'develop' }));
  const setStatusMessage = useAppStore(s => s.setStatusMessage);
  const undo = useHistoryStore(s => s.undo);
  const redo = useHistoryStore(s => s.redo);
  const [isDragOver, setIsDragOver] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [closeRequest, setCloseRequest] = useState<{ kind: 'window' | 'document'; pendingIds: string[]; discardedIds?: string[] } | null>(null);
  const statusMessage = useAppStore(s => s.statusMessage);
  const openingRef = useRef(false);
  const mounted = useRef(true);
  const projectPaths = useRef(savedProjectPaths);
  const allowWindowClose = useRef(false);
  const autosave = useRef<AutosaveManager | null>(null);
  if(!autosave.current)autosave.current=new AutosaveManager(defaultDocumentManager,getStudioPreferences().recoveryIntervalSeconds*1000,undefined,undefined,reason=>reportError(reason));
  const recoveryIntervalSeconds=useStudioPreferences(s=>s.preferences.recoveryIntervalSeconds);
  const historyLimit=useStudioPreferences(s=>s.preferences.historyLimit);
  const recentLimit=useStudioPreferences(s=>s.preferences.recentLimit);
  const cutoutIdleMinutes=useStudioPreferences(s=>s.preferences.cutoutIdleMinutes);
  const cutoutAcceleration=useStudioPreferences(s=>s.preferences.cutoutAcceleration);
  const [recoveries, setRecoveries] = useState<RecoveryEntry[]>([]);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const recoveryBusyRef = useRef(false);
  const [closeBusy, setCloseBusy] = useState(false);
  useEffect(()=>{autosave.current!.setIntervalMs(recoveryIntervalSeconds*1000);},[recoveryIntervalSeconds]);
  useEffect(()=>{defaultCommandBus.setHistoryLimit(historyLimit);},[historyLimit]);
  useEffect(()=>{defaultRecentProjectsStore.setLimit(recentLimit);},[recentLimit]);
  useEffect(()=>{defaultLocalCutoutProvider.setIdleMinutes(cutoutIdleMinutes);},[cutoutIdleMinutes]);
  useEffect(()=>{defaultLocalCutoutProvider.setAcceleration(cutoutAcceleration);},[cutoutAcceleration]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (currentWorkspace === 'edit' || currentWorkspace === 'develop') {
      setVisitedWorkspaces(previous => ({ ...previous, [currentWorkspace]: true }));
    }
  }, [currentWorkspace]);
  const reportError = useCallback((reason: unknown) => {
    if (!mounted.current) return;
    const message = reason instanceof Error ? reason.message : String(reason);
    setError(message);
    setStatusMessage(message);
  }, [setStatusMessage]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleHistoryShortcut(event, undo, redo);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [undo, redo]);

  useEffect(() => {
    const recovery = autosave.current!;
    recovery.start();
    void recovery.checkForRecovery().then(setRecoveries).catch(reportError);
    return () => recovery.stop();
  }, [reportError]);

  const openFile = async (select: () => Promise<SelectedFile | null>) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setError(null);
    try {
      const selected = await select();
      if (!selected || !mounted.current) return;
      if (selected.path && /\.(aistudio|aiimg|lsq|lumiseq|psd)$/i.test(selected.name)) {
        const alreadyOpen = findOpenProjectDocumentId(selected.path, projectPaths.current, defaultDocumentManager);
        if (alreadyOpen) {
          defaultDocumentOperations.activate(alreadyOpen);
          defaultRecentProjectsStore.record(selected.path);
          setStatusMessage(`已切换到 ${selected.name}`);
          return;
        }
      }
      const doc = await openSelectedFile(selected);
      if (!mounted.current) return;
      defaultDocumentOperations.activate(doc.id);
      if (selected.path && /\.(aistudio|aiimg|lsq|lumiseq|psd)$/i.test(selected.name)) {
        projectPaths.current.set(doc.id, selected.path);
        defaultRecentProjectsStore.record(selected.path);
      }
      setStatusMessage(`已打开 ${selected.name}`);
    } catch (reason) { reportError(reason); }
    finally { openingRef.current = false; if (mounted.current) setOpening(false); }
  };

  const handleOpenFileDialog = () => openFile(() => getPlatformBridge().openFileDialog({
    title: `打开照片或项目 · ${APP_NAME}`,
    filters: [{ name: '照片与项目', extensions: ['cr2','cr3','nef','arw','raf','rw2','orf','dng','pef','srw','raw','jpg','jpeg','png','webp','bmp','tiff','tif','lsq','lumiseq','aistudio','aiimg','psd'] }],
  }));
  const handleOpenRecentProject = (path: string) => openFile(() => readSelectedNativeFile(path));

  useAppLifecycle(paths => {
    if (paths[0]) void openFile(() => readSelectedNativeFile(paths[0]));
  }, setIsDragOver, reportError);

  const saveDocument = async (doc: StudioDocument, saveAs = false): Promise<boolean> => {
    try {
      const safeName = (doc.kind === 'edit' ? doc.name : doc.fileName).replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]/g, '_');
      const path = (!saveAs && projectPaths.current.get(doc.id)) || await getPlatformBridge().saveFileDialog({
        title: `保存可编辑项目 · ${APP_NAME}`,
        defaultPath: `${safeName}.lsq`,
        filters: doc.kind === 'edit' ? [
          { name: '影序 Studio 工程文件 (*.lsq, *.aistudio)', extensions: ['lsq', 'aistudio', 'lumiseq'] },
          { name: 'Photoshop 分层文档 (*.psd)', extensions: ['psd'] },
        ] : [{ name: '影序 RAW 调色工程 (*.lsq, *.aistudio)', extensions: ['lsq', 'aistudio', 'lumiseq'] }],
      });
      if (!path) return false;
      let recentRecorded = true;
      if (/\.psd$/i.test(path)) {
        if (doc.kind !== 'edit') throw new Error('RAW 调色项目请保存为 .lsq 或 .aistudio 格式。');
        const snapshot = structuredClone(doc);
        await saveLayeredPsd(snapshot, path);
        defaultDocumentManager.markSaved(doc.id, snapshot);
        try { defaultRecentProjectsStore.record(path); } catch { recentRecorded = false; }
      } else if (/\.(aistudio|lsq|lumiseq)$/i.test(path)) {
        recentRecorded = (await defaultProjectOperations.save(doc, path)).recentRecorded;
      } else throw new Error('请选择 .lsq、.aistudio 或 .psd 保存格式。');
      projectPaths.current.set(doc.id, path);
      const hasNewerEdits = !!defaultDocumentManager.getDocument(doc.id)?.isDirty;
      setStatusMessage(hasNewerEdits ? `已保存项目快照；后续修改尚未保存：${path}` : recentRecorded ? `已保存项目：${path}` : `项目已保存，但最近项目列表暂不可用：${path}`);
      return !hasNewerEdits;
    } catch (reason) { reportError(reason); return false; }
  };

  const handleSaveProject = async () => {
    const doc = defaultDocumentManager.getActiveDocument();
    if (!doc) { setStatusMessage('请先打开或新建画布。'); return; }
    await saveDocument(doc);
  };
  const handleSaveProjectAs = async () => {
    const doc = defaultDocumentManager.getActiveDocument();
    if (!doc) { setStatusMessage('请先打开或新建画布。'); return; }
    await saveDocument(doc, true);
  };

  const handleCloseDocument = (id: string) => {
    const doc = defaultDocumentManager.getDocument(id);
    if (!doc) return;
    if (documentsNeedingSave([doc], projectPaths.current).length) {
      setCloseRequest({ kind: 'document', pendingIds: [doc.id] });
    } else {
      defaultDocumentManager.closeDocument(doc.id);
      projectPaths.current.delete(doc.id);
      if (!defaultDocumentManager.getActiveDocument()) useAppStore.getState().setWorkspace('home');
    }
  };
  const handleCloseActiveDocument = () => {
    const doc = defaultDocumentManager.getActiveDocument();
    if (doc) handleCloseDocument(doc.id);
  };

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow().onCloseRequested(event => {
        if (allowWindowClose.current) return;
        const pending = documentsNeedingSave(defaultDocumentManager.getOpenDocuments(), projectPaths.current);
        if (pending.length) {
          event.preventDefault();
          setCloseRequest({ kind: 'window', pendingIds: pending.map(doc => doc.id) });
        } else {
          event.preventDefault();
          void advanceClose({kind:'window',pendingIds:[]}).catch(reportError);
        }
      })
    ).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(reportError);
    return () => { disposed = true; unlisten?.(); };
  }, [reportError]);

  const advanceClose = async (request: NonNullable<typeof closeRequest>, discard = false) => {
    const currentId = request.pendingIds[0];
    if (currentId && !discard && defaultDocumentManager.getDocument(currentId)?.isDirty) return;
    const discardedIds = [...(request.discardedIds ?? []), ...(discard && currentId ? [currentId] : [])];
    const next = request.pendingIds.slice(1);
    if (next.length) { setCloseRequest({ ...request, pendingIds: next, discardedIds }); return; }
    setCloseRequest(null);
    if (request.kind === 'document') {
      const id = request.pendingIds[0];
      defaultDocumentManager.closeDocument(id);
      projectPaths.current.delete(id);
      if (!defaultDocumentManager.getActiveDocument()) useAppStore.getState().setWorkspace('home');
    } else {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const pending = await prepareWindowClose(() => defaultDocumentManager.getOpenDocuments(), projectPaths.current, discardedIds, () => autosave.current!.clearOpen());
      if (pending.length) {
        await autosave.current!.performAutosave().catch(reportError);
        setCloseRequest({kind:'window',pendingIds:pending.map(doc=>doc.id),discardedIds});
        return;
      }
      allowWindowClose.current = true;
      try { await getCurrentWindow().close(); }
      catch (reason) { allowWindowClose.current = false; reportError(reason); }
    }
  };

  useEffect(() => {
    const onSave = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void (event.shiftKey ? handleSaveProjectAs() : handleSaveProject());
      }
    };
    window.addEventListener('keydown', onSave);
    return () => window.removeEventListener('keydown', onSave);
  });

  const handleCreateDocument = (request: CreateDocumentRequest) => {
    try { defaultDocumentOperations.create(request); setStatusMessage('已创建新画布。'); }
    catch (reason) { reportError(reason); }
  };
  const studioActions: StudioActionHandlers = {
    openFile: handleOpenFileDialog,
    createCanvas: () => setNewProjectOpen(true),
    openDocument: id => { defaultDocumentOperations.activate(id); },
    openRecentProject: handleOpenRecentProject,
    saveProject: handleSaveProject,
    saveProjectAs: handleSaveProjectAs,
    exportImage: () => {
      if (!defaultDocumentManager.getActiveDocument()) { setStatusMessage('请先打开或新建文档。'); return; }
      setExportOpen(true);
    },
    closeActiveDocument: handleCloseActiveDocument,
    closeDocument: handleCloseDocument,
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void openFile(async () => ({ name: file.name, sizeBytes: file.size, blob: file }));
  };

  return <div className="studio-app h-screen w-screen flex flex-col bg-studio-950 text-studio-200 overflow-hidden font-sans relative"
    onDragOver={event => { event.preventDefault(); setIsDragOver(true); }}
    onDragLeave={event => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragOver(false); }}
    onDrop={handleDrop}>
    {isDragOver && <div className="absolute inset-0 z-50 bg-blue-950/80 backdrop-blur-xs flex flex-col items-center justify-center border-4 border-dashed border-blue-500 pointer-events-none"><UploadCloud className="w-16 h-16 text-blue-400 mb-2 animate-bounce" /><h2 className="text-xl font-bold text-white">拖入照片或项目</h2><p className="text-sm text-blue-200 mt-1">自动进入适合 RAW 或图像的工作区</p></div>}
    <TopMenuBar actions={studioActions} />
    <div className="flex-1 flex overflow-hidden relative"><div className="flex-1 overflow-hidden relative">
      {currentWorkspace === 'home' && <HomeWorkspace actions={studioActions} />}
      {(visitedWorkspaces.develop || currentWorkspace === 'develop') && <div className="absolute inset-0" hidden={currentWorkspace !== 'develop'}><DevelopWorkspace onExport={() => setExportOpen(true)} /></div>}
      {(visitedWorkspaces.edit || currentWorkspace === 'edit') && <div className="absolute inset-0" hidden={currentWorkspace !== 'edit'}><EditWorkspace onExport={() => setExportOpen(true)} /></div>}
    </div><AIPanel actions={studioActions} /></div>
    {(opening || error) && <div role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 max-w-xl rounded-xl border border-white/15 bg-studio-900/95 px-5 py-3 shadow-xl text-sm">{opening ? '正在打开文件…' : error}{error && !opening && <button className="ml-4 text-blue-300" onClick={() => setError(null)} aria-label="关闭提示">关闭</button>}</div>}
    <span className="sr-only" role="status" aria-live="polite">{statusMessage}</span>
    <AICommandBar actions={studioActions} />
    {newProjectOpen && <NewProjectDialog onClose={() => setNewProjectOpen(false)} onCreate={handleCreateDocument} onOpenFile={handleOpenFileDialog} />}
    <ExportDialog document={defaultDocumentManager.getActiveDocument()} open={exportOpen} onClose={() => setExportOpen(false)} onExported={path => setStatusMessage(`已导出成品：${path}`)} />
    <Modal open={recoveries.length > 0} onClose={() => {}} title="未保存工程自动恢复">
      <p>检测到工作台在上次会话中存在未保存的修改快照。您可以立即恢复继续编辑，或放弃以清理备份。</p>
      {recoveries.map(entry => <div key={entry.documentId}><span>{entry.name}</span><button disabled={recoveryBusy} onClick={() => {
        if (recoveryBusyRef.current) return;
        recoveryBusyRef.current=true;setRecoveryBusy(true);
        void autosave.current!.restore(entry).then(() => {
          defaultDocumentOperations.activate(defaultDocumentManager.getActiveDocument()!.id);
          setRecoveries(items => items.filter(item => item.documentId !== entry.documentId));
        }).catch(reportError).finally(()=>{recoveryBusyRef.current=false;setRecoveryBusy(false);});
      }}>恢复工程</button><button disabled={recoveryBusy} onClick={() => {
        if (recoveryBusyRef.current) return;
        recoveryBusyRef.current=true;setRecoveryBusy(true);
        void autosave.current!.discard(entry.documentId).then(() => setRecoveries(items => items.filter(item => item.documentId !== entry.documentId))).catch(reportError).finally(()=>{recoveryBusyRef.current=false;setRecoveryBusy(false);});
      }}>放弃快照</button></div>)}
    </Modal>
    <Modal open={!!closeRequest} onClose={() => setCloseRequest(null)} title="保存更改">
      {closeRequest && (() => {
        const doc = defaultDocumentManager.getDocument(closeRequest.pendingIds[0]);
        if (!doc) return null;
        return <div className="save-changes-dialog">
          <p>是否保存对「{doc.kind === 'edit' ? doc.name : doc.fileName}」所做的修改？</p>
          <small>{doc.kind === 'edit' ? '建议保存为「.aistudio 原生工程」以完整保留专属图层与 AI 历史；或保存为标准「.psd」以便在 Photoshop 中分层编辑。' : '建议保存为「.aistudio 调色工程」，将完整保留调色滑块、局部遮罩与历史步骤（重新打开需原始照片仍位于原路径）。'}</small>
          <div className="save-changes-actions">
            <button type="button" disabled={closeBusy} onClick={() => setCloseRequest(null)}>取消</button>
            <button type="button" disabled={closeBusy} onClick={() => { setCloseBusy(true);void autosave.current!.discard(doc.id).then(() => advanceClose(closeRequest,true)).catch(reportError).finally(()=>setCloseBusy(false)); }}>不保存</button>
            <button type="button" disabled={closeBusy} className="primary" onClick={() => {
              setCloseBusy(true);
              void saveDocument(doc).then(async saved => { if (saved) await advanceClose(closeRequest); }).catch(reportError).finally(()=>setCloseBusy(false));
            }}>保存</button>
          </div>
        </div>;
      })()}
    </Modal>
  </div>;
};
