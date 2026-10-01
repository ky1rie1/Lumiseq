// src/stores/useAppStore.ts
import { create } from 'zustand';
import { WorkspaceType } from '../types/common';
import { defaultDocumentManager } from '../document/DocumentManager';
import {getStudioPreferences} from './useStudioPreferences';
import {preferenceStorage} from './studioPreferences';
import {initialWorkspace,LAST_WORKSPACE_KEY} from '../app/preferenceRuntime';

interface AppState {
  currentWorkspace: WorkspaceType;
  activeDocumentId: string | null;
  lastDocumentIdByWorkspace: { edit: string | null; develop: string | null };
  isAiPanelOpen: boolean;
  isCommandBarOpen: boolean;
  statusMessage: string;

  setWorkspace: (ws: WorkspaceType) => void;
  setActiveDocumentId: (id: string | null) => void;
  toggleAiPanel: () => void;
  setCommandBarOpen: (open: boolean) => void;
  setStatusMessage: (msg: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentWorkspace: initialWorkspace(getStudioPreferences(),preferenceStorage()),
  activeDocumentId: null,
  lastDocumentIdByWorkspace: { edit: null, develop: null },
  isAiPanelOpen: getStudioPreferences().openAiPanel,
  isCommandBarOpen: false,
  statusMessage: 'Ready',

  setWorkspace: (ws) => {
    if (ws !== 'home') {
      const active = defaultDocumentManager.getActiveDocument();
      if (active?.kind !== ws) {
        const remembered = get().lastDocumentIdByWorkspace[ws];
        const match = remembered && defaultDocumentManager.getDocument(remembered)?.kind === ws
          ? remembered
          : [...defaultDocumentManager.getOpenDocuments()].reverse().find(doc => doc.kind === ws)?.id;
        defaultDocumentManager.setActiveDocument(match ?? null);
      }
    }
    set({ currentWorkspace: ws });
    try { preferenceStorage()?.setItem(LAST_WORKSPACE_KEY, ws); } catch { /* Current workspace remains usable. */ }
  },
  setActiveDocumentId: (id) => {
    defaultDocumentManager.setActiveDocument(id);
    set({ activeDocumentId: id });
  },
  toggleAiPanel: () => set((s) => ({ isAiPanelOpen: !s.isAiPanelOpen })),
  setCommandBarOpen: (open) => set({ isCommandBarOpen: open }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
}));

// Sync when DocumentManager changes active document externally
defaultDocumentManager.subscribe((event) => {
  if (event.type === 'activated') {
    const doc = event.documentId ? defaultDocumentManager.getDocument(event.documentId) : null;
    useAppStore.setState(state => ({
      activeDocumentId: event.documentId,
      lastDocumentIdByWorkspace: doc
        ? { ...state.lastDocumentIdByWorkspace, [doc.kind]: doc.id }
        : state.lastDocumentIdByWorkspace,
    }));
  }
});
