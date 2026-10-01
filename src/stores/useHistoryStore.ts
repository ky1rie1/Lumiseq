// src/stores/useHistoryStore.ts
import { create } from 'zustand';
import { HistoryEntry } from '../types/history';
import { defaultCommandBus } from '../history/CommandBus';

interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  history: HistoryEntry[];
  undo: () => boolean;
  redo: () => boolean;
}

export const useHistoryStore = create<HistoryState>(() => ({
  canUndo: defaultCommandBus.canUndo(),
  canRedo: defaultCommandBus.canRedo(),
  history: defaultCommandBus.getHistory(),

  undo: () => {
    return defaultCommandBus.undo();
  },

  redo: () => {
    return defaultCommandBus.redo();
  },
}));

// State Adapter: Subscribe to CommandBus events
defaultCommandBus.subscribe(() => {
  useHistoryStore.setState({
    canUndo: defaultCommandBus.canUndo(),
    canRedo: defaultCommandBus.canRedo(),
    history: defaultCommandBus.getHistory(),
  });
});
