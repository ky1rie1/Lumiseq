import { useEffect } from 'react';
import { useStudioPreferences } from '../../stores/useStudioPreferences';
import { deriveAppearancePolicy } from '../../stores/appearancePolicy';

export function AppearanceController() {
  const preferences = useStudioPreferences(s => s.preferences);
  useEffect(() => {
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const transparency=window.matchMedia('(prefers-reduced-transparency: reduce)');
    const sync=()=>{
      const root=document.documentElement;
      const policy=deriveAppearancePolicy(preferences,motion.matches,transparency.matches,!document.hidden);
      root.dataset.glass=policy.glass; root.dataset.motion=policy.motion;
      root.dataset.reduceMotion=String(policy.motion==='off'); root.dataset.density=preferences.density;
      root.dataset.pageHidden=String(document.hidden);
      root.style.setProperty('--canvas-surround-bg',preferences.canvasBackground);
    };
    sync(); motion.addEventListener('change',sync); transparency.addEventListener('change',sync); document.addEventListener('visibilitychange',sync);
    return ()=>{motion.removeEventListener('change',sync);transparency.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
  }, [preferences.motion,preferences.density,preferences.canvasBackground]);
  return null;
}
