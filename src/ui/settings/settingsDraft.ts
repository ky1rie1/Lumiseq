import { PREFERENCE_SECTIONS, type PreferenceSection, type StudioPreferences } from '../../stores/studioPreferences';

export interface SettingsSaveController {
  dirty: boolean;
  busy: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}
export type SettingsControllerListener = (controller: SettingsSaveController) => void;

export function preferenceSectionPatch(draft: StudioPreferences, section: PreferenceSection): Partial<StudioPreferences> {
  return Object.fromEntries(PREFERENCE_SECTIONS[section].map(key => [key, draft[key]]));
}

/** Each page/service change invalidates asynchronous results belonging to its previous lifetime. */
export class SettingsRequestScope {
  private generation = 0;
  begin() { return ++this.generation; }
  capture() { return this.generation; }
  invalidate() { ++this.generation; }
  isCurrent(request: number) { return request === this.generation; }
}
export function hasSettingsDraftChanges(saved: unknown, draft: unknown, keyInput = '') {
  return keyInput.length > 0 || JSON.stringify(saved) !== JSON.stringify(draft);
}
