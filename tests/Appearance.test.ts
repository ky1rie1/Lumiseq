import { describe, expect, it } from 'vitest';
import { readAppearance, saveAppearance } from '../src/stores/appearancePreferences';

describe('appearance preferences', () => {
  it('restores a valid user preference across application launches', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    saveAppearance(storage, { glass: 'off', reduceMotion: true });
    expect(readAppearance(storage)).toEqual({ glass: 'off', reduceMotion: true });
  });
  it('rejects invalid saved values rather than disabling accessibility defaults', () => {
    expect(readAppearance({ getItem: () => '{"glass":"transparent","reduceMotion":"false"}' })).toEqual({ glass: 'standard', reduceMotion: false });
  });
  it('recovers from corrupt or unavailable storage', () => {
    expect(readAppearance({ getItem: () => '{' })).toEqual({ glass: 'standard', reduceMotion: false });
    expect(readAppearance({ getItem: () => { throw new Error('blocked'); } })).toEqual({ glass: 'standard', reduceMotion: false });
    expect(() => saveAppearance({ setItem: () => { throw new Error('full'); } }, { glass: 'reduced', reduceMotion: true })).not.toThrow();
  });
});
