// src/develop/NativePresetStore.ts
//! File-based Develop Preset Store (Stage 1A)
//! Saves individual JSON files in %APPDATA%\AI-Creative-Studio\presets\
//! Includes import/export via native dialogs, schema versioning, and safe idempotent localStorage migration.

import { defaultAppPaths } from '../core/AppPaths';
import { getPlatformBridge, IPlatformBridge } from '../platform';
import type { DevelopPreset, DevelopSettings } from '../types/develop';

export interface DevelopPresetFile {
  format: 'lumiseq-develop-preset';
  version: number;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  settings: Partial<DevelopSettings>;
}

export const PRESET_FILE_FORMAT = 'lumiseq-develop-preset';
export const CURRENT_PRESET_VERSION = 1;
export const LEGACY_PRESET_KEY = 'aistudio.develop-presets.v1';

export function sanitizePresetName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim().slice(0, 100) || 'Unnamed Preset';
}

/**
 * Strips photo-specific states (masks, camera WB multipliers, file paths, IDs).
 * Preserves only reusable global develop parameters.
 */
export function sanitizeDevelopSettingsForPreset(settings: Partial<DevelopSettings>): Partial<DevelopSettings> {
  const { masks, ...global } = structuredClone(settings);
  if (global.whiteBalance) {
    global.whiteBalance = {
      mode: global.whiteBalance.mode ?? 'as-shot',
      temperature: global.whiteBalance.temperature,
      tint: global.whiteBalance.tint,
      cameraMultipliers: undefined, // Strip camera-specific hardware multipliers
    };
  }
  return global;
}

export class NativePresetStore {
  private cache: Map<string, DevelopPreset> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    private bridge: IPlatformBridge = getPlatformBridge(),
    private presetsDir: string = defaultAppPaths.getPresetsDir()
  ) {}

  async loadPresets(): Promise<DevelopPreset[]> {
    await this.ensureInitialized();
    return Array.from(this.cache.values());
  }

  getPresetsSync(): DevelopPreset[] {
    return Array.from(this.cache.values());
  }

  async savePreset(preset: DevelopPreset, description?: string): Promise<string> {
    await this.ensureInitialized();
    return await this.writePresetFile(preset, description);
  }

  private async writePresetFile(preset: DevelopPreset, description?: string): Promise<string> {
    const fileName = `${sanitizePresetName(preset.name)}.json`;
    const targetPath = `${this.presetsDir}\\${fileName}`;

    const now = new Date().toISOString();
    const filePayload: DevelopPresetFile = {
      format: PRESET_FILE_FORMAT,
      version: CURRENT_PRESET_VERSION,
      name: preset.name,
      description,
      createdAt: now,
      updatedAt: now,
      settings: sanitizeDevelopSettingsForPreset(preset.settings),
    };

    const json = JSON.stringify(filePayload, null, 2);
    await this.bridge.writeTextFileAtomic(targetPath, json);

    // Update in-memory cache
    this.cache.set(preset.id, preset);
    return targetPath;
  }

  async deletePreset(presetId: string): Promise<boolean> {
    await this.ensureInitialized();
    const preset = this.cache.get(presetId);
    if (!preset) return false;

    const fileName = `${sanitizePresetName(preset.name)}.json`;
    const targetPath = `${this.presetsDir}\\${fileName}`;

    await this.bridge.deleteFile(targetPath).catch(() => {});
    this.cache.delete(presetId);
    return true;
  }

  async importPreset(): Promise<DevelopPreset | null> {
    const selected = await this.bridge.openFileDialog({
      title: '导入调色预设',
      filters: [{ name: '影序调色预设 (*.json)', extensions: ['json'] }],
    });
    if (!selected?.path) return null;

    const content = await this.bridge.readTextFile(selected.path);
    const parsed = JSON.parse(content);
    const validated = this.validatePresetFile(parsed);
    if (!validated) {
      throw new Error('所选文件不是有效的影序调色预设格式。');
    }

    const preset: DevelopPreset = {
      id: crypto.randomUUID(),
      name: validated.name,
      settings: validated.settings as DevelopSettings,
    };

    await this.savePreset(preset, validated.description);
    return preset;
  }

  async exportPreset(preset: DevelopPreset): Promise<string | null> {
    const defaultName = `${sanitizePresetName(preset.name)}.json`;
    const savePath = await this.bridge.saveFileDialog({
      title: '导出调色预设',
      defaultPath: defaultName,
      filters: [{ name: '影序调色预设 (*.json)', extensions: ['json'] }],
    });
    if (!savePath) return null;

    const now = new Date().toISOString();
    const filePayload: DevelopPresetFile = {
      format: PRESET_FILE_FORMAT,
      version: CURRENT_PRESET_VERSION,
      name: preset.name,
      createdAt: now,
      updatedAt: now,
      settings: sanitizeDevelopSettingsForPreset(preset.settings),
    };

    const json = JSON.stringify(filePayload, null, 2);
    await this.bridge.writeTextFileAtomic(savePath, json);
    return savePath;
  }

  private validatePresetFile(data: any): DevelopPresetFile | null {
    if (!data || typeof data !== 'object') return null;
    if (data.format !== PRESET_FILE_FORMAT && !data.settings) return null;

    const name = typeof data.name === 'string' ? data.name.trim() : 'Imported Preset';
    const settings = data.settings && typeof data.settings === 'object' ? data.settings : null;
    if (!settings) return null;

    return {
      format: PRESET_FILE_FORMAT,
      version: typeof data.version === 'number' ? data.version : CURRENT_PRESET_VERSION,
      name,
      description: data.description,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      settings: sanitizeDevelopSettingsForPreset(settings),
    };
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.initialized = true;
    try {
      // 1. Load files from presets directory
      const files = await this.bridge.listDirFiles(this.presetsDir, 'json').catch(() => []);
      for (const filePath of files) {
        try {
          const content = await this.bridge.readTextFile(filePath);
          const parsed = JSON.parse(content);
          const valid = this.validatePresetFile(parsed);
          if (valid) {
            const id = crypto.randomUUID();
            this.cache.set(id, {
              id,
              name: valid.name,
              settings: valid.settings as DevelopSettings,
            });
          }
        } catch (err) {
          console.warn(`[NativePresetStore] Skipping invalid preset file ${filePath}:`, err);
        }
      }

      // 2. Perform one-time migration if cache is empty
      if (this.cache.size === 0) {
        await this.migrateFromLegacyLocalStorage();
      } else {
        this.cleanLegacyLocalStorageIfMigrated();
      }
    } catch (err) {
      console.warn('[NativePresetStore] Initialization warning:', err);
    }
  }

  private async migrateFromLegacyLocalStorage(): Promise<void> {
    if (typeof globalThis.localStorage === 'undefined') return;
    try {
      const raw = globalThis.localStorage.getItem(LEGACY_PRESET_KEY);
      if (!raw || !raw.trim()) return;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      let migratedCount = 0;
      for (const item of parsed) {
        if (item && typeof item.name === 'string' && item.settings && typeof item.settings === 'object') {
          const preset: DevelopPreset = {
            id: item.id || crypto.randomUUID(),
            name: item.name,
            settings: item.settings,
          };
          await this.writePresetFile(preset);
          migratedCount++;
        }
      }

      if (migratedCount > 0) {
        globalThis.localStorage.removeItem(LEGACY_PRESET_KEY);
        console.log(`[NativePresetStore] Migrated ${migratedCount} develop presets to ${this.presetsDir}`);
      }
    } catch (err) {
      console.warn('[NativePresetStore] Legacy preset migration failed, preserving localStorage:', err);
    }
  }

  private cleanLegacyLocalStorageIfMigrated(): void {
    if (typeof globalThis.localStorage !== 'undefined') {
      try {
        if (globalThis.localStorage.getItem(LEGACY_PRESET_KEY)) {
          globalThis.localStorage.removeItem(LEGACY_PRESET_KEY);
        }
      } catch {}
    }
  }
}

export const defaultNativePresetStore = new NativePresetStore();
