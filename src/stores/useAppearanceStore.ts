import { create } from 'zustand';
import { AppearancePreferences, GlassLevel } from './appearancePreferences';
import { getStudioPreferences, useStudioPreferences } from './useStudioPreferences';

interface AppearanceState extends AppearancePreferences {
  setGlass: (glass: GlassLevel) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
}

function adapted(): AppearancePreferences {
  const preferences=getStudioPreferences();
  return {glass:'off',reduceMotion:preferences.motion!=='full'};
}
export const useAppearanceStore = create<AppearanceState>(() => ({
  ...adapted(),
  setGlass:()=>{},
  setReduceMotion:reduceMotion=>useStudioPreferences.getState().updatePreferences({motion:reduceMotion?'reduced':'full'}),
}));
useStudioPreferences.subscribe(()=>{
  const next=adapted(); const current=useAppearanceStore.getState();
  if(next.glass!==current.glass||next.reduceMotion!==current.reduceMotion)useAppearanceStore.setState(next);
});
