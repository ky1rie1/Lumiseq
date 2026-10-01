// tests/NativeRecentProjects.test.ts
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { RecentProjectsStore, LEGACY_STORAGE_KEY } from '../src/app/recentProjects';
import type { IPlatformBridge } from '../src/platform/IPlatformBridge';

class MockPlatformBridge implements Partial<IPlatformBridge> {
  public files = new Map<string, string>();

  async readTextFile(path: string): Promise<string> {
    if (this.files.has(path)) {
      return this.files.get(path)!;
    }
    throw new Error(`File not found: ${path}`);
  }

  async writeTextFileAtomic(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async deleteFile(path: string): Promise<boolean> {
    return this.files.delete(path);
  }
}

function createMockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, val),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

describe('NativeRecentProjectsStore (Stage 1A)', () => {
  let bridge: MockPlatformBridge;
  const recentFile = 'C:\\Users\\Test\\AppData\\Roaming\\AI-Creative-Studio\\recent.json';

  beforeEach(() => {
    bridge = new MockPlatformBridge();
    (globalThis as any).localStorage = createMockLocalStorage();
  });

  it.each(['lsq', 'lumiseq'])('persists and reloads native .%s projects', async extension => {
    const store = new RecentProjectsStore(bridge as any, recentFile, () => 1000);
    await store.load();
    const path = `C:\\Work\\Photo.${extension}`;

    await store.add({ path, name: `Photo.${extension}`, lastOpenedAt: 1000 });

    const reloaded = new RecentProjectsStore(bridge as any, recentFile, () => 2000);
    expect(await reloaded.load()).toEqual([expect.objectContaining({ path, missing: false })]);
  });

  it('resolves the default recent file from the desktop host once before reading or writing', async () => {
    const getAppPaths = vi.fn(async () => ({ recentProjectsFile: recentFile }));
    const native = Object.assign(bridge, { getAppPaths });
    bridge.files.set(recentFile, JSON.stringify({ version: 1, items: [
      { path: 'C:\\Work\\Existing.lsq', name: 'Existing', lastOpenedAt: 500 },
    ] }));
    const store = new RecentProjectsStore(native as any);
    const [first, second] = await Promise.all([store.load(), store.load()]);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(getAppPaths).toHaveBeenCalledOnce();

    await store.add({ path: 'C:\\Work\\New.lsq', name: 'New', lastOpenedAt: 1000 });
    expect(JSON.parse(bridge.files.get(recentFile)!).items[0].path).toBe('C:\\Work\\New.lsq');
    expect([...bridge.files.keys()]).toEqual([recentFile]);
  });

  it('persists project entries to native recent.json atomically', async () => {
    const store = new RecentProjectsStore(bridge as any, recentFile, () => 1000);
    await store.load();

    await store.add({
      path: 'C:\\Work\\Photo1.aistudio',
      name: 'Photo1.aistudio',
      lastOpenedAt: 1000,
    });

    expect(bridge.files.has(recentFile)).toBe(true);
    const content = JSON.parse(bridge.files.get(recentFile)!);
    expect(content.version).toBe(1);
    expect(content.items).toHaveLength(1);
    expect(content.items[0].path).toBe('C:\\Work\\Photo1.aistudio');

    // Reload from a new store instance pointing to same file
    const store2 = new RecentProjectsStore(bridge as any, recentFile, () => 2000);
    const loaded = await store2.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Photo1.aistudio');
  });

  it('performs one-time idempotent migration from legacy localStorage to recent.json', async () => {
    // Populate legacy localStorage
    const legacyData = [
      { path: 'C:\\Legacy\\Old1.aistudio', name: 'Old1.aistudio', lastOpenedAt: 500 },
      { path: 'C:\\Legacy\\Old2.psd', name: 'Old2.psd', lastOpenedAt: 600 },
    ];
    globalThis.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacyData));

    const store = new RecentProjectsStore(bridge as any, recentFile, () => 1000);
    const items = await store.load();

    expect(items).toHaveLength(2);
    expect(items[0].path).toBe('C:\\Legacy\\Old2.psd');
    expect(items[1].path).toBe('C:\\Legacy\\Old1.aistudio');

    // Native file should be populated
    expect(bridge.files.has(recentFile)).toBe(true);
    // Legacy localStorage key should be cleaned
    expect(globalThis.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

    // Re-instantiate: Idempotent check
    const store2 = new RecentProjectsStore(bridge as any, recentFile, () => 1000);
    const reloaded = await store2.load();
    expect(reloaded).toHaveLength(2);
  });

  it('recovers gracefully from corrupted JSON and backs up corrupt file', async () => {
    bridge.files.set(recentFile, '{ corrupted json payload broken ...');

    const store = new RecentProjectsStore(bridge as any, recentFile);
    const items = await store.load();

    // App does not crash, returns empty items
    expect(items).toEqual([]);

    // Check that a corrupt backup was created
    const backupKeys = Array.from(bridge.files.keys()).filter(k => k.includes('.corrupt_'));
    expect(backupKeys.length).toBeGreaterThanOrEqual(1);
    expect(bridge.files.get(backupKeys[0])).toContain('corrupted json');
  });

  it('supports marking missing items, removing items, and clearing', async () => {
    const store = new RecentProjectsStore(bridge as any, recentFile, () => 1000);
    await store.load();

    await store.add({ path: 'C:\\Work\\A.aistudio', name: 'A', lastOpenedAt: 1000 });
    await store.add({ path: 'C:\\Work\\B.psd', name: 'B', lastOpenedAt: 1001 });

    // Mark missing
    store.markMissing('C:\\Work\\A.aistudio', true);
    expect(store.getAll()[1].missing).toBe(true);

    // Remove
    await store.remove('C:\\Work\\A.aistudio');
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].path).toBe('C:\\Work\\B.psd');

    // Clear
    await store.clear();
    expect(store.getAll()).toHaveLength(0);
  });
});
