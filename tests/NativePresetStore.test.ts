// tests/NativePresetStore.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { NativePresetStore, LEGACY_PRESET_KEY, PRESET_FILE_FORMAT } from '../src/develop/NativePresetStore';
import type { IPlatformBridge } from '../src/platform/IPlatformBridge';
import type { DevelopSettings } from '../src/types/develop';

class MockPlatformBridge implements Partial<IPlatformBridge> {
  public files = new Map<string, string>();
  public saveDialogTarget: string | null = null;
  public openDialogSelected: string | null = null;

  async readTextFile(path: string): Promise<string> {
    if (this.files.has(path)) {
      return this.files.get(path)!;
    }
    throw new Error(`File not found: ${path}`);
  }

  async writeTextFileAtomic(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async listDirFiles(dirPath: string, extensionFilter?: string): Promise<string[]> {
    const matched: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(dirPath)) {
        if (!extensionFilter || key.endsWith(`.${extensionFilter}`)) {
          matched.push(key);
        }
      }
    }
    return matched;
  }

  async deleteFile(path: string): Promise<boolean> {
    return this.files.delete(path);
  }

  async openFileDialog(): Promise<any> {
    if (this.openDialogSelected) {
      return { path: this.openDialogSelected };
    }
    return null;
  }

  async saveFileDialog(): Promise<string | null> {
    return this.saveDialogTarget;
  }
}

function mockSettings(): DevelopSettings {
  return {
    exposure: 0.5,
    contrast: 10,
    highlights: -20,
    shadows: 15,
    whites: 5,
    blacks: -5,
    texture: 10,
    clarity: 5,
    dehaze: 0,
    vibrance: 12,
    saturation: -2,
    curves: { rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }], red: [], green: [], blue: [] },
    hsl: {
      hue: { red: 0, orange: 0, yellow: 0, green: 0, aqua: 0, blue: 0, purple: 0, magenta: 0 },
      saturation: { red: 0, orange: 0, yellow: 0, green: 0, aqua: 0, blue: 0, purple: 0, magenta: 0 },
      luminance: { red: 0, orange: 0, yellow: 0, green: 0, aqua: 0, blue: 0, purple: 0, magenta: 0 },
    },
    detail: { sharpening: 40, radius: 1, detail: 25, noiseReduction: 10 },
    optics: { vignette: 0 },
    whiteBalance: {
      mode: 'custom',
      temperature: 6000,
      tint: 5,
      cameraMultipliers: [1.8, 1.0, 1.5, 0], // camera specific hardware multiplier
    },
    masks: [
      { id: 'mask-1', name: 'Subject', type: 'brush', inverted: false, opacity: 1, settings: {} as any },
    ],
  };
}

describe('NativePresetStore (Stage 1A)', () => {
  let bridge: MockPlatformBridge;
  const presetsDir = 'C:\\Users\\Test\\AppData\\Roaming\\AI-Creative-Studio\\presets';

  beforeEach(() => {
    bridge = new MockPlatformBridge();
    (globalThis as any).localStorage = {
      store: new Map<string, string>(),
      getItem(k: string) { return this.store.get(k) ?? null; },
      setItem(k: string, v: string) { this.store.set(k, v); },
      removeItem(k: string) { this.store.delete(k); },
    };
  });

  it('saves preset into individual JSON file and strips photo-specific states (Rule 9)', async () => {
    const store = new NativePresetStore(bridge as any, presetsDir);
    const settings = mockSettings();

    const targetPath = await store.savePreset({
      id: 'p1',
      name: 'Cinematic Teal',
      settings,
    }, 'Teal and orange cinematic tone');

    expect(targetPath).toBe(`${presetsDir}\\Cinematic Teal.json`);
    expect(bridge.files.has(targetPath)).toBe(true);

    const savedJson = JSON.parse(bridge.files.get(targetPath)!);
    expect(savedJson.format).toBe(PRESET_FILE_FORMAT);
    expect(savedJson.version).toBe(1);
    expect(savedJson.name).toBe('Cinematic Teal');
    expect(savedJson.description).toBe('Teal and orange cinematic tone');
    expect(savedJson.settings.exposure).toBe(0.5);

    // Verify Rule 9: masks and cameraMultipliers must NOT be saved in presets
    expect(savedJson.settings.masks).toBeUndefined();
    expect(savedJson.settings.whiteBalance.cameraMultipliers).toBeUndefined();
    expect(savedJson.settings.whiteBalance.temperature).toBe(6000);
  });

  it('loads presets and ignores corrupted files without crashing', async () => {
    // Valid preset
    bridge.files.set(`${presetsDir}\\Valid.json`, JSON.stringify({
      format: PRESET_FILE_FORMAT,
      version: 1,
      name: 'Valid Preset',
      settings: { exposure: 1.0 },
    }));

    // Corrupted file
    bridge.files.set(`${presetsDir}\\Broken.json`, '{ invalid json broken...');

    const store = new NativePresetStore(bridge as any, presetsDir);
    const presets = await store.loadPresets();

    // Only valid preset loaded, broken file ignored
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe('Valid Preset');
  });

  it('migrates legacy localStorage presets to native files and deletes old key', async () => {
    const legacyPresets = [
      { id: 'leg-1', name: 'Legacy Warm', settings: { exposure: 0.2 } },
      { id: 'leg-2', name: 'Legacy Cool', settings: { exposure: -0.3 } },
    ];
    globalThis.localStorage.setItem(LEGACY_PRESET_KEY, JSON.stringify(legacyPresets));

    const store = new NativePresetStore(bridge as any, presetsDir);
    const presets = await store.loadPresets();

    expect(presets).toHaveLength(2);
    expect(bridge.files.has(`${presetsDir}\\Legacy Warm.json`)).toBe(true);
    expect(bridge.files.has(`${presetsDir}\\Legacy Cool.json`)).toBe(true);

    // Old localStorage key should be removed
    expect(globalThis.localStorage.getItem(LEGACY_PRESET_KEY)).toBeNull();
  });

  it('supports native export and import of preset files', async () => {
    const store = new NativePresetStore(bridge as any, presetsDir);
    const preset = { id: 'exp-1', name: 'Golden Hour', settings: mockSettings() };

    // Test Export
    bridge.saveDialogTarget = 'D:\\Backups\\Golden Hour.json';
    const exportedPath = await store.exportPreset(preset);
    expect(exportedPath).toBe('D:\\Backups\\Golden Hour.json');
    expect(bridge.files.has('D:\\Backups\\Golden Hour.json')).toBe(true);

    // Test Import
    bridge.openDialogSelected = 'D:\\Backups\\Golden Hour.json';
    const imported = await store.importPreset();
    expect(imported).not.toBeNull();
    expect(imported!.name).toBe('Golden Hour');
    expect(bridge.files.has(`${presetsDir}\\Golden Hour.json`)).toBe(true);
  });
});
