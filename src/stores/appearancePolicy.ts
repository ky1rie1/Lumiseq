import type {StudioPreferences} from './studioPreferences';
export function deriveAppearancePolicy(preferences: StudioPreferences, systemMotion: boolean, _systemTransparency: boolean, visible: boolean) {
  return {
    glass: 'off',
    motion: !visible || systemMotion ? 'off' : preferences.motion,
  } as const;
}
