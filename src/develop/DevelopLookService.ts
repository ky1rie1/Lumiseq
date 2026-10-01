import type { DevelopDocument, DevelopSettings, DevelopPreset, DevelopSettingsSnapshot } from '../types/develop';
import type { IDocumentManager } from '../types/document';
import type { ICommandBus } from '../types/history';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultCommandBus } from '../history/CommandBus';
import { BaseCommand } from '../history/Command';
import { PARAM_DEFINITIONS } from '../ui/shared/parameterDefinitions';
import { defaultNativePresetStore, sanitizeDevelopSettingsForPreset } from './NativePresetStore';

export * from './NativePresetStore';
export const DEFAULT_DEVELOP_PRESETS: DevelopPreset[] = [];
const clone = <T,>(value: T): T => structuredClone(value);

function validateNumber(parameter: string, value: unknown): asserts value is number {
  const definition = PARAM_DEFINITIONS[parameter];
  if (typeof value !== 'number' || !Number.isFinite(value) || !definition || value < definition.min || value > definition.max) {
    throw new Error(`预设参数无效：${parameter}`);
  }
}

function sample(points: { x: number; y: number }[], x: number): number {
  if (x <= points[0].x) return points[0].y;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].x) {
      const a = points[i - 1], b = points[i];
      return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
    }
  }
  return points[points.length - 1].y;
}

/** Presets change supported global adjustments only; masks never travel between photos. */
export function blendDevelopPreset(base: DevelopSettings, preset: DevelopPreset, strength: number, includeWhiteBalance = false): DevelopSettings {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new RangeError('预设强度必须为 0–100%。');
  const result = clone(base);
  if (strength === 0) return result;
  const source = preset.settings;
  for (const key of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation'] as const) {
    const value = source[key];
    if (value !== undefined) {
      if (!Number.isFinite(value) || value < PARAM_DEFINITIONS[key].min || value > PARAM_DEFINITIONS[key].max) throw new Error('预设参数无效');
      result[key] = base[key] + (value - base[key]) * strength;
    }
  }
  for (const key of ['hsl', 'detail', 'optics'] as const) {
    if (source[key]) {
      const blend = (a: any, b: any): any => Object.fromEntries(Object.entries(a).map(([k, v]) => {
        if (typeof v === 'number' && b?.[k] !== undefined) {
          const parameter = key === 'hsl' ? ({ hue: 'hslHue', saturation: 'hslSat', luminance: 'hslLum' } as Record<string, string>)[k] : k;
          validateNumber(parameter, b[k]);
          return [k, v + (b[k] - v) * strength];
        }
        return [k, typeof v === 'object' ? blend(v, b?.[k]) : v];
      }));
      (result as any)[key] = blend(base[key], source[key]);
    }
  }
  if (source.curves) {
    for (const channel of ['rgb', 'red', 'green', 'blue'] as const) {
      const target = source.curves[channel];
      const current = base.curves[channel];
      if (!target || target.length < 2 || target.some((p, i) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || (i > 0 && p.x <= target[i - 1].x))) {
        throw new Error('预设曲线无效');
      }
      const xs = [...new Set([...current, ...target].map(p => p.x))].sort((a, b) => a - b);
      result.curves[channel] = strength === 1 ? clone(target) : xs.map(x => ({ x, y: sample(current, x) * (1 - strength) + sample(target, x) * strength }));
    }
  }
  if (includeWhiteBalance && source.whiteBalance) {
    if (!['as-shot', 'auto', 'custom'].includes(source.whiteBalance.mode)) throw new Error('预设白平衡模式无效');
    result.whiteBalance = { ...base.whiteBalance, mode: source.whiteBalance.mode };
    for (const key of ['temperature', 'tint'] as const) {
      const value = source.whiteBalance[key];
      if (value !== undefined) {
        validateNumber(key, value);
        result.whiteBalance[key] = (base.whiteBalance[key] ?? (key === 'temperature' ? 5500 : 0)) * (1 - strength) + value * strength;
      }
    }
  }
  return result;
}

class DevelopLookCommand extends BaseCommand {
  private before?: Pick<DevelopDocument, 'settings' | 'settingsSnapshots'>;
  constructor(id: string, name: string, private patch: Partial<Pick<DevelopDocument, 'settings' | 'settingsSnapshots'>>, private docs: IDocumentManager) {
    super(name, id);
  }
  execute() {
    const doc = this.docs.getDevelopDocument(this.documentId);
    if (!doc) throw new Error('调色文档已关闭');
    this.before = clone({ settings: doc.settings, settingsSnapshots: doc.settingsSnapshots });
    this.docs.updateDocument({ ...doc, ...clone(this.patch) }, this.name);
  }
  undo() {
    const doc = this.docs.getDevelopDocument(this.documentId);
    if (doc && this.before) this.docs.updateDocument({ ...doc, ...clone(this.before) }, `Undo ${this.name}`);
  }
}

export class DevelopLookService {
  constructor(private docs: IDocumentManager = defaultDocumentManager, private history: ICommandBus = defaultCommandBus) {}
  private doc(id: string) {
    const doc = this.docs.getDevelopDocument(id);
    if (!doc) throw new Error('调色文档已关闭');
    return doc;
  }
  applyPreset(id: string, preset: DevelopPreset, strength: number, includeWhiteBalance = false) {
    this.history.execute(new DevelopLookCommand(id, `Apply ${preset.name}`, { settings: blendDevelopPreset(this.doc(id).settings, preset, strength, includeWhiteBalance) }, this.docs));
  }
  saveSnapshot(id: string, name: string): DevelopSettingsSnapshot {
    if (!name.trim()) throw new Error('请输入快照名称');
    const doc = this.doc(id);
    if ((doc.settingsSnapshots?.length ?? 0) >= 64) throw new Error('每张照片最多保存 64 个快照');
    const snapshot = { id: crypto.randomUUID(), name: name.trim().slice(0, 120), createdAt: Date.now(), settings: clone(doc.settings) };
    this.history.execute(new DevelopLookCommand(id, `Save snapshot ${snapshot.name}`, { settingsSnapshots: [...(doc.settingsSnapshots ?? []), snapshot] }, this.docs));
    return snapshot;
  }
  restoreSnapshot(id: string, snapshotId: string) {
    const snapshot = this.doc(id).settingsSnapshots?.find(s => s.id === snapshotId);
    if (!snapshot) throw new Error('快照不存在');
    this.history.execute(new DevelopLookCommand(id, `Restore ${snapshot.name}`, { settings: clone(snapshot.settings) }, this.docs));
  }
  deleteSnapshot(id: string, snapshotId: string) {
    this.history.execute(new DevelopLookCommand(id, 'Delete snapshot', { settingsSnapshots: (this.doc(id).settingsSnapshots ?? []).filter(s => s.id !== snapshotId) }, this.docs));
  }
}

const PRESET_KEY = 'aistudio.develop-presets.v1';

export function loadCustomDevelopPresets(storage?: Pick<Storage, 'getItem'>): DevelopPreset[] {
  if (storage) {
    try {
      const value = JSON.parse(storage.getItem(PRESET_KEY) ?? '[]');
      return Array.isArray(value) ? value.filter(p => typeof p.id === 'string' && typeof p.name === 'string' && p.settings && typeof p.settings === 'object').slice(0, 64) : [];
    } catch {
      return [];
    }
  }
  const nativePresets = defaultNativePresetStore.getPresetsSync();
  if (nativePresets.length > 0) return nativePresets;
  if (typeof localStorage !== 'undefined') {
    try {
      const value = JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]');
      return Array.isArray(value) ? value.filter(p => typeof p.id === 'string' && typeof p.name === 'string' && p.settings && typeof p.settings === 'object').slice(0, 64) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function saveCustomDevelopPresets(presets: DevelopPreset[], storage?: Pick<Storage, 'setItem'>) {
  if (storage) {
    storage.setItem(PRESET_KEY, JSON.stringify(presets.slice(0, 64)));
    return;
  }
  for (const preset of presets) {
    void defaultNativePresetStore.savePreset(preset).catch(() => {});
  }
}

export function createCustomDevelopPreset(name: string, settings: DevelopSettings): DevelopPreset {
  if (!name.trim()) throw new Error('请输入预设名称');
  const global = sanitizeDevelopSettingsForPreset(settings);
  return { id: crypto.randomUUID(), name: name.trim().slice(0, 120), settings: global as DevelopSettings };
}

export const defaultDevelopLooks = new DevelopLookService();
