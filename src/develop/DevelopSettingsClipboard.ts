import { DevelopDocument, DevelopSettings, ToneCurves, WhiteBalanceSettings } from '../types/develop';
import { PARAM_DEFINITIONS } from '../ui/shared/parameterDefinitions';

export const DEVELOP_SETTINGS_GROUPS = ['basic', 'color', 'curves', 'detail', 'optics'] as const;
export type DevelopSettingsGroup = typeof DEVELOP_SETTINGS_GROUPS[number];
const basicKeys = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const;
const colorKeys = ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'] as const;
const hslChannels = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;

export interface DevelopSettingsSnapshot {
  version: 1;
  copiedAt: number;
  sourceDocumentId: string;
  sourceName: string;
  groups: {
    basic: Pick<DevelopSettings, typeof basicKeys[number]>;
    color: Pick<DevelopSettings, typeof colorKeys[number] | 'hsl'>;
    curves: ToneCurves;
    detail: DevelopSettings['detail'];
    optics: DevelopSettings['optics'];
  };
  whiteBalance: Pick<WhiteBalanceSettings, 'mode' | 'temperature' | 'tint'>;
}

export function validateToneCurves(curves: ToneCurves, maximum = Infinity, requireEndpoints = false): void {
  for (const channel of ['rgb', 'red', 'green', 'blue'] as const) {
    const points = curves?.[channel];
    if (!Array.isArray(points) || points.length < 2 || points.length > maximum || points.some((point, index) =>
      !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 ||
      point.y < 0 || point.y > 1 || (index > 0 && point.x <= points[index - 1].x))) {
      throw new RangeError(`Invalid ${channel} tone curve`);
    }
    if (requireEndpoints && (points[0].x !== 0 || points[points.length - 1].x !== 1)) throw new RangeError(`Invalid ${channel} curve endpoints: reset the curve to edit (X must be 0 and 1)`);
  }
}

function numberFor(parameter: string, value: number): number {
  const { min, max } = PARAM_DEFINITIONS[parameter];
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${parameter} in copied settings`);
  return value;
}

/** One session clipboard shared by manual controls and canonical AI tools. No document resources. */
export class DevelopSettingsClipboard {
  private snapshot: DevelopSettingsSnapshot | null = null;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): DevelopSettingsSnapshot | null => this.snapshot ? structuredClone(this.snapshot) : null;

  copy(document: DevelopDocument): DevelopSettingsSnapshot {
    const settings = document.settings;
    validateToneCurves(settings.curves, 128);
    const pick = <K extends keyof DevelopSettings>(keys: readonly K[]) => Object.fromEntries(keys.map(key => [key, numberFor(key as string, settings[key] as number)])) as Pick<DevelopSettings, K>;
    const hsl = Object.fromEntries(hslChannels.map(channel => [channel, {
      hue: numberFor('hslHue', settings.hsl[channel].hue),
      saturation: numberFor('hslSat', settings.hsl[channel].saturation),
      luminance: numberFor('hslLum', settings.hsl[channel].luminance),
    }])) as DevelopSettings['hsl'];
    const detail = {
      sharpenAmount: numberFor('sharpenAmount', settings.detail.sharpenAmount),
      sharpenRadius: numberFor('sharpenRadius', settings.detail.sharpenRadius),
      sharpenThreshold: numberFor('sharpenThreshold', settings.detail.sharpenThreshold),
      lumaDenoise: numberFor('lumaDenoise', settings.detail.lumaDenoise),
      chromaDenoise: numberFor('chromaDenoise', settings.detail.chromaDenoise),
    };
    const optics = { vignetteAmount: numberFor('vignetteAmount', settings.optics.vignetteAmount), vignetteMidpoint: numberFor('vignetteMidpoint', settings.optics.vignetteMidpoint) };
    const wb = settings.whiteBalance;
    if (!['custom', 'auto', 'as-shot'].includes(wb.mode)) throw new RangeError('Invalid source white balance mode');
    const whiteBalance: DevelopSettingsSnapshot['whiteBalance'] = wb.mode === 'custom'
      ? { mode: 'custom', temperature: numberFor('temperature', wb.temperature as number), tint: numberFor('tint', wb.tint as number) }
      : { mode: wb.mode };
    const next: DevelopSettingsSnapshot = { version: 1, copiedAt: Date.now(), sourceDocumentId: document.id.slice(0, 256), sourceName: document.fileName.slice(0, 512),
      groups: { basic: pick(basicKeys), color: { ...pick(colorKeys), hsl },
        curves: Object.fromEntries(['rgb', 'red', 'green', 'blue'].map(channel => [channel, settings.curves[channel as keyof ToneCurves].map(point => ({ x: point.x, y: point.y }))])) as unknown as ToneCurves,
        detail, optics }, whiteBalance };
    if (JSON.stringify(next).length > 32768) throw new RangeError('Copied settings exceed the clipboard size limit');
    this.snapshot = structuredClone(next);
    this.listeners.forEach(listener => listener());
    return structuredClone(next);
  }

  selectedPatch(groups: DevelopSettingsGroup[]): { snapshot: DevelopSettingsSnapshot; patch: Partial<DevelopSettings> } {
    if (!this.snapshot) throw new RangeError('Settings clipboard is empty');
    if (!Array.isArray(groups) || !groups.length || groups.some(group => !DEVELOP_SETTINGS_GROUPS.includes(group))) throw new RangeError('Select valid settings groups');
    const snapshot = this.getSnapshot()!;
    const patch: Partial<DevelopSettings> = {};
    for (const group of new Set(groups)) {
      if (group === 'basic' || group === 'color') Object.assign(patch, snapshot.groups[group]);
      else Object.assign(patch, { [group]: snapshot.groups[group] });
    }
    return { snapshot, patch };
  }
}

export const defaultDevelopSettingsClipboard = new DevelopSettingsClipboard();
