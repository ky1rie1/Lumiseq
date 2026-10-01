import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_PREFERENCES, normalizeStudioPreferences, readStudioPreferences, resetPreferenceSection, saveStudioPreferences, STUDIO_PREFERENCES_KEY } from './studioPreferences';

describe('studio preferences', () => {
  it('falls back when persisted JSON is corrupt or storage denies access', () => {
    expect(readStudioPreferences({getItem: () => '{broken'})).toEqual(DEFAULT_STUDIO_PREFERENCES);
    expect(readStudioPreferences({getItem: () => {throw new Error('denied');}})).toEqual(DEFAULT_STUDIO_PREFERENCES);
  });
  it('validates enums, booleans, numeric ranges and CSS colors', () => {
    const prefs = normalizeStudioPreferences({historyLimit: -1, jpegQuality: 300, defaultBrushSize: NaN, density: 'giant', openAiPanel: 'true', canvasBackground: 'url(secret)', motion: 'off'});
    expect(prefs).toEqual({...DEFAULT_STUDIO_PREFERENCES, motion: 'off'});
    expect(normalizeStudioPreferences({historyLimit: 20, defaultBrushHardness: 0, canvasBackground: '#abcdef'})).toMatchObject({historyLimit:20,defaultBrushHardness:0,canvasBackground:'#abcdef'});
  });
  it('migrates legacy and version 1 appearance values into the unified surface', () => {
    const storage = {getItem: (key: string) => key === 'yingxu_appearance' ? JSON.stringify({glass:'off',reduceMotion:true}) : null};
    expect(readStudioPreferences(storage)).toMatchObject({motion:'reduced'});
    expect(readStudioPreferences(storage)).not.toHaveProperty('surface');
    const migrated = readStudioPreferences({getItem: key => key === STUDIO_PREFERENCES_KEY ? JSON.stringify({version:1,preferences:{surface:'transparent',motion:'full',density:'compact',jpegQuality:82}}) : storage.getItem(key)});
    expect(migrated).toMatchObject({motion:'full',density:'compact',jpegQuality:82});
    expect(migrated).not.toHaveProperty('surface');
  });
  it('resets one section without losing other preferences', () => {
    const prefs = normalizeStudioPreferences({jpegQuality:72,density:'compact',historyLimit:30});
    expect(resetPreferenceSection(prefs,'appearance')).toMatchObject({density:'comfortable',jpegQuality:72,historyLimit:30});
  });
  it('persists validated preferences in a versioned record and reports failed writes', () => {
    let saved = '';
    expect(saveStudioPreferences({setItem: (key, value) => {expect(key).toBe(STUDIO_PREFERENCES_KEY);saved=value;}}, {...DEFAULT_STUDIO_PREFERENCES,jpegQuality:82})).toBe(true);
    expect(JSON.parse(saved)).toMatchObject({version:2,preferences:{jpegQuality:82}});
    expect(JSON.parse(saved).preferences).not.toHaveProperty('surface');
    expect(saveStudioPreferences({setItem: () => {throw new Error('quota');}}, DEFAULT_STUDIO_PREFERENCES)).toBe(false);
  });
});
