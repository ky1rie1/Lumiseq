export type GlassLevel = 'standard' | 'reduced' | 'off';
export interface AppearancePreferences { glass: GlassLevel; reduceMotion: boolean }
const KEY = 'yingxu_appearance';
const defaults: AppearancePreferences = { glass: 'standard', reduceMotion: false };

export function readAppearance(storage?: Pick<Storage, 'getItem'>): AppearancePreferences {
  try {
    const value: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (!value || typeof value !== 'object') return { ...defaults };
    const saved = value as Record<string, unknown>;
    return {
      glass: saved.glass === 'reduced' || saved.glass === 'off' ? saved.glass : 'standard',
      reduceMotion: saved.reduceMotion === true,
    };
  } catch { return { ...defaults }; }
}

export function saveAppearance(storage: Pick<Storage, 'setItem'> | undefined, value: AppearancePreferences): void {
  try { storage?.setItem(KEY, JSON.stringify(value)); } catch { /* Keep the live preference if disk storage is unavailable. */ }
}

export function appearanceStorage(): Storage | undefined {
  try { return typeof localStorage !== 'undefined' ? localStorage : undefined; } catch { return undefined; }
}
