import {create} from 'zustand';
import {normalizeStudioPreferences, preferenceStorage, readStudioPreferences, resetPreferenceSection, saveStudioPreferences, type PreferenceSection, type StudioPreferences} from './studioPreferences';

interface StudioPreferencesState {
  preferences: StudioPreferences;
  persistenceError: string | null;
  updatePreferences: (patch: Partial<StudioPreferences>) => void;
  commitPreferences: (patch: Partial<StudioPreferences>) => boolean;
  resetSection: (section: PreferenceSection) => void;
}
export const useStudioPreferences=create<StudioPreferencesState>((set,get)=>{
  const apply=(preferences:StudioPreferences)=>{
    const persisted=saveStudioPreferences(preferenceStorage(),preferences);
    set({preferences,persistenceError:persisted?null:'设置已在当前会话生效，但无法写入本地存储。'});
  };
  return {preferences:readStudioPreferences(preferenceStorage()),persistenceError:null,
    updatePreferences:patch=>apply(normalizeStudioPreferences({...get().preferences,...patch})),
    commitPreferences: patch => {
      const preferences = normalizeStudioPreferences({ ...get().preferences, ...patch });
      if (!saveStudioPreferences(preferenceStorage(), preferences)) {
        set({ persistenceError: '设置未保存：无法写入本地存储，请重试。' });
        return false;
      }
      set({ preferences, persistenceError: null });
      return true;
    },
    resetSection:section=>apply(resetPreferenceSection(get().preferences,section)),
  };
});
export const getStudioPreferences=():StudioPreferences=>useStudioPreferences.getState().preferences;
