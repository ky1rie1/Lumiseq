import { afterEach, expect, it, vi } from 'vitest';
import { useStudioPreferences } from '../../stores/useStudioPreferences';
import { DEFAULT_STUDIO_PREFERENCES } from '../../stores/studioPreferences';
import { preferenceSectionPatch } from './settingsDraft';

afterEach(() => vi.unstubAllGlobals());
it('commits only this section so another preference is not overwritten', () => {
  const draft = { ...DEFAULT_STUDIO_PREFERENCES, density: 'compact' as const, jpegQuality: 40 };
  expect(preferenceSectionPatch(draft, 'appearance')).toEqual({
    density: 'compact', motion: 'full', canvasBackground: '#202022',
  });
});
it('keeps saved preferences unchanged when local storage rejects a save', () => {
  useStudioPreferences.setState({ preferences: { ...DEFAULT_STUDIO_PREFERENCES }, persistenceError: null });
  vi.stubGlobal('localStorage', { setItem() { throw new Error('quota'); } });
  expect(useStudioPreferences.getState().commitPreferences({ jpegQuality: 65 })).toBe(false);
  expect(useStudioPreferences.getState().preferences.jpegQuality).toBe(90);
  expect(useStudioPreferences.getState().persistenceError).toContain('未保存');
});
