// src/app/recentProjects.ts
//! Native Desktop Recent Projects Store (Stage 1A)
//! Persists to %APPDATA%\AI-Creative-Studio\recent.json using atomic file operations.
//! Includes idempotent one-time migration from localStorage with corruption recovery and missing file tracking.

import { defaultAppPaths } from '../core/AppPaths';
import { getPlatformBridge, IPlatformBridge } from '../platform';

export interface RecentProjectEntry {
  path: string;
  name: string;
  displayName?: string;
  lastOpenedAt: number;
  type?: 'project' | 'raw' | 'raster';
  missing?: boolean;
}

export interface RecentProjectsFileSchema {
  version: number;
  items: RecentProjectEntry[];
}

export interface IRecentProjectsStore {
  load(): Promise<RecentProjectEntry[]>;
  add(project: RecentProjectEntry): Promise<void>;
  remove(path: string): Promise<void> | RecentProjectEntry[];
  clear(): Promise<void> | void;
}

export type RecentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const LEGACY_STORAGE_KEY = 'ai_creative_studio_recent_projects_v1';
export const CURRENT_SCHEMA_VERSION = 1;
const MAX_RECENT_PROJECTS = 30;

function pathKey(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') ? path.replace(/\//g, '\\').toLocaleLowerCase() : path;
}

export function validProjectPath(path: unknown): path is string {
  return typeof path === 'string' &&
    (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/')) &&
    /\.(?:lsq|lumiseq|aistudio|psd)$/i.test(path) &&
    path.length < 4096;
}

function isStorage(obj: unknown): obj is RecentStorage {
  return Boolean(obj && typeof (obj as any).getItem === 'function' && typeof (obj as any).setItem === 'function');
}

export class RecentProjectsStore implements IRecentProjectsStore {
  private items: RecentProjectEntry[] = [];
  private listeners = new Set<() => void>();
  private visibleLimit = 12;
  private filePath: string;
  private legacyStorage: RecentStorage | null = null;
  private bridge: IPlatformBridge | null = null;
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private useHostPath: boolean;

  constructor(
    storageOrBridge?: RecentStorage | IPlatformBridge,
    filePathOrNow?: string | (() => number),
    private now: () => number = Date.now
  ) {
    this.useHostPath = typeof filePathOrNow !== 'string' || !filePathOrNow;
    if (typeof filePathOrNow === 'function') {
      this.now = filePathOrNow;
      this.filePath = defaultAppPaths.getRecentProjectsFile();
    } else {
      this.filePath = filePathOrNow || defaultAppPaths.getRecentProjectsFile();
    }

    if (isStorage(storageOrBridge)) {
      this.legacyStorage = storageOrBridge;
      this.items = this.readFromStorage(this.legacyStorage);
      this.initialized = true;
    } else {
      this.bridge = (storageOrBridge as IPlatformBridge) || getPlatformBridge();
      // Load synchronously if possible or initialize in background
      this.ensureInitialized();
    }
  }

  setLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECENT_PROJECTS) {
      throw new RangeError('Recent project limit must be between 1 and 30.');
    }
    if (this.visibleLimit === limit) return;
    this.visibleLimit = limit;
    this.emit();
  }

  /**
   * Synchronous getter for React useSyncExternalStore rendering.
   */
  getAll(): RecentProjectEntry[] {
    return this.items.slice(0, this.visibleLimit);
  }

  async load(): Promise<RecentProjectEntry[]> {
    await this.ensureInitialized();
    return this.items.slice(0, this.visibleLimit);
  }

  async add(project: RecentProjectEntry): Promise<void> {
    await this.ensureInitialized();
    this.record(project.path, project.displayName || project.name);
  }

  /**
   * Records a local project path into the store and triggers persistence.
   */
  record(path: string, name?: string): RecentProjectEntry[] {
    const trimmed = path?.trim();
    if (!validProjectPath(trimmed)) {
      throw new Error('最近项目需要已保存的本地 .lsq、.lumiseq、.aistudio 或 .psd 路径。');
    }
    const displayName = name?.trim() || trimmed.split(/[\\/]/).pop() || trimmed;
    const lastOpenedAt = Math.max(this.now(), (this.items[0]?.lastOpenedAt ?? 0) + 1);

    const entry: RecentProjectEntry = {
      path: trimmed,
      name: displayName,
      displayName,
      lastOpenedAt,
      type: 'project',
      missing: false,
    };

    this.items = [
      entry,
      ...this.items.filter(e => pathKey(e.path) !== pathKey(trimmed)),
    ].slice(0, MAX_RECENT_PROJECTS);

    this.emit();
    this.persistSyncOrAsync();
    return this.items.slice(0, this.visibleLimit);
  }

  remove(path: string): RecentProjectEntry[] {
    const key = pathKey(path);
    const next = this.items.filter(entry => pathKey(entry.path) !== key);
    if (next.length !== this.items.length) {
      this.items = next;
      this.emit();
      this.persistSyncOrAsync();
    }
    return this.items.slice(0, this.visibleLimit);
  }

  async clear(): Promise<void> {
    await this.ensureInitialized();
    this.items = [];
    this.emit();
    this.persistSyncOrAsync();
  }

  markMissing(path: string, missing: boolean): void {
    const key = pathKey(path);
    let changed = false;
    this.items = this.items.map(entry => {
      if (pathKey(entry.path) === key && entry.missing !== missing) {
        changed = true;
        return { ...entry, missing };
      }
      return entry;
    });
    if (changed) {
      this.emit();
      this.persistSyncOrAsync();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    this.initialization ??= this.doInitialize();
    return this.initialization;
  }

  private async doInitialize(): Promise<void> {
    if (!this.bridge) {
      this.initialized = true;
      return;
    }
    try {
      // WebView has no Node environment variables; resolve the current user's
      // canonical path before the first read or persistence operation.
      if (this.useHostPath) {
        const paths = await this.bridge.getAppPaths();
        this.filePath = paths.recentProjectsFile;
      }
      // 1. Attempt to read native file
      const raw = await this.bridge.readTextFile(this.filePath).catch(() => null);
      if (raw && raw.trim().length > 0) {
        try {
          const parsed = JSON.parse(raw);
          const loadedItems = this.parseSchemaItems(parsed);
          if (loadedItems.length > 0) {
            this.items = loadedItems;
            this.initialized = true;
            this.emit();
            this.cleanLegacyStorageIfMigrated();
            return;
          }
        } catch (parseErr) {
          console.warn('[RecentProjectsStore] Corrupt recent.json detected, backing up:', parseErr);
          const backupPath = `${this.filePath}.corrupt_${Date.now()}`;
          await this.bridge.writeTextFileAtomic(backupPath, raw).catch(() => {});
        }
      }

      // 2. Perform one-time migration from localStorage if native file is empty or missing
      await this.migrateFromLocalStorage();
    } catch (err) {
      console.warn('[RecentProjectsStore] Native initialization error:', err);
    } finally {
      this.initialized = true;
      this.emit();
    }
  }

  private readFromStorage(storage: RecentStorage): RecentProjectEntry[] {
    try {
      const raw = storage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return this.parseSchemaItems(parsed);
    } catch {
      return [];
    }
  }

  private parseSchemaItems(data: any): RecentProjectEntry[] {
    if (!data) return [];
    const array = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
    const seen = new Set<string>();
    return array
      .filter((entry: any): entry is RecentProjectEntry => (
        entry &&
        validProjectPath(entry.path) &&
        (typeof entry.displayName === 'string' || typeof entry.name === 'string') &&
        Number.isFinite(entry.lastOpenedAt) &&
        entry.lastOpenedAt > 0
      ))
      .map((entry: any) => {
        const displayName = entry.displayName || entry.name || entry.path.split(/[\\/]/).pop()!;
        return {
          path: entry.path,
          name: displayName,
          displayName,
          lastOpenedAt: entry.lastOpenedAt,
          type: 'project',
          missing: Boolean(entry.missing),
        };
      })
      .sort((a: RecentProjectEntry, b: RecentProjectEntry) => b.lastOpenedAt - a.lastOpenedAt)
      .filter((entry: RecentProjectEntry) => {
        const key = pathKey(entry.path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_RECENT_PROJECTS);
  }

  private async migrateFromLocalStorage(): Promise<void> {
    if (typeof globalThis.localStorage === 'undefined') return;
    try {
      const legacyRaw = globalThis.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyRaw || !legacyRaw.trim()) return;

      const parsed = JSON.parse(legacyRaw);
      const migratedItems = this.parseSchemaItems(parsed);
      if (migratedItems.length > 0) {
        this.items = migratedItems;
        await this.persist();
        globalThis.localStorage.removeItem(LEGACY_STORAGE_KEY);
        console.log(`[RecentProjectsStore] Successfully migrated ${migratedItems.length} projects to ${this.filePath}`);
      }
    } catch (err) {
      console.warn('[RecentProjectsStore] Migration failed, preserving localStorage:', err);
    }
  }

  private cleanLegacyStorageIfMigrated(): void {
    if (typeof globalThis.localStorage !== 'undefined') {
      try {
        if (globalThis.localStorage.getItem(LEGACY_STORAGE_KEY)) {
          globalThis.localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      } catch {}
    }
  }

  private persistSyncOrAsync(): void {
    if (this.legacyStorage) {
      this.legacyStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(this.items));
      return;
    }
    void this.persist().catch(err => {
      console.error('[RecentProjectsStore] Failed to persist recent.json:', err);
    });
  }

  private async persist(): Promise<void> {
    if (!this.bridge) return;
    const payload: RecentProjectsFileSchema = {
      version: CURRENT_SCHEMA_VERSION,
      items: this.items,
    };
    const json = JSON.stringify(payload, null, 2);
    await this.bridge.writeTextFileAtomic(this.filePath, json);
  }
}

export const defaultRecentProjectsStore = new RecentProjectsStore();
