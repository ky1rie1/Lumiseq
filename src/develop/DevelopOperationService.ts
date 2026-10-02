import { UpdateDevelopSettingsCommand } from '../commands/develop/UpdateDevelopSettingsCommand';
import { CreateRawVariantCommand } from '../commands/develop/CreateRawVariantCommand';
import { ResetDevelopSettingsCommand } from '../commands/develop/ResetDevelopSettingsCommand';
import { defaultAssetManager } from '../assets/AssetManager';
import { defaultDocumentManager } from '../document/DocumentManager';
import { createDefaultDevelopSettings, createDevelopDocument } from '../document/DevelopDocument';
import { defaultCommandBus } from '../history/CommandBus';
import { ColorChannel } from '../types/common';
import { IAssetManager } from '../types/asset';
import { IDocumentManager } from '../types/document';
import { DevelopDocument, DevelopMask, DevelopSettings, RawCorrectionMode, ToneCurves, WhiteBalanceSettings } from '../types/develop';
import { ICommandBus, TransactionToken } from '../types/history';
import { PARAM_DEFINITIONS } from '../ui/shared/parameterDefinitions';
import { rasterizeDevelopMask } from './maskRaster';
import { isResolvedAutoWhiteBalance, resolveAutomaticWhiteBalance } from '../engine/developColorMath';
import { readAutoWhiteBalanceSource } from './autoWhiteBalanceSource';
import { DevelopSettingsClipboard, DevelopSettingsGroup, defaultDevelopSettingsClipboard, validateToneCurves } from './DevelopSettingsClipboard';

const PARAMETER_PATHS = {
  exposure: 'exposure', contrast: 'contrast', highlights: 'highlights', shadows: 'shadows',
  whites: 'whites', blacks: 'blacks', temperature: 'whiteBalance.temperature',
  tint: 'whiteBalance.tint', texture: 'texture', clarity: 'clarity', dehaze: 'dehaze',
  vibrance: 'vibrance', saturation: 'saturation', sharpenAmount: 'detail.sharpenAmount',
  sharpenRadius: 'detail.sharpenRadius', sharpenThreshold: 'detail.sharpenThreshold',
  lumaDenoise: 'detail.lumaDenoise', chromaDenoise: 'detail.chromaDenoise',
  vignetteAmount: 'optics.vignetteAmount', vignetteMidpoint: 'optics.vignetteMidpoint',
  hslHue: 'hsl.{channel}.hue', hslSat: 'hsl.{channel}.saturation',
  hslLum: 'hsl.{channel}.luminance',
} as const;

export type DevelopParameterId = keyof typeof PARAMETER_PATHS;
export type DevelopOperationSource = 'manual' | 'ai';
export interface ParameterChange {
  documentId: string;
  parameterId: DevelopParameterId;
  value: number;
  source: DevelopOperationSource;
  channel?: ColorChannel;
  description?: string;
}

export interface CreateMaskRequest {
  documentId: string;
  kind: DevelopMask['kind'];
  name: string;
  geometry: DevelopMask['geometry'];
  strokes?: DevelopMask['strokes'];
  source: DevelopOperationSource;
}

export interface MaskParameterChange {
  documentId: string;
  maskId: string;
  parameterId: 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'temperature' | 'saturation';
  value: number;
  source: DevelopOperationSource;
}

const CHANNELS = new Set<ColorChannel>([
  'red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta',
]);

function pathFor(parameterId: DevelopParameterId, channel?: ColorChannel): string {
  const template = PARAMETER_PATHS[parameterId];
  if (!template) throw new Error(`Unknown develop parameter: ${parameterId}`);
  if (template.includes('{channel}')) {
    if (!channel || !CHANNELS.has(channel)) throw new Error(`Channel required for ${parameterId}`);
    return template.replace('{channel}', channel);
  }
  return template;
}

function patchAtPath(settings: DevelopSettings, path: string, value: number): Partial<DevelopSettings> {
  const [top, second, third] = path.split('.');
  if (top === 'whiteBalance' && second) {
    return { whiteBalance: { ...settings.whiteBalance, mode: 'custom', [second]: value } };
  }
  if (top === 'detail' && second) return { detail: { ...settings.detail, [second]: value } };
  if (top === 'optics' && second) return { optics: { ...settings.optics, [second]: value } };
  if (top === 'hsl' && second && third && CHANNELS.has(second as ColorChannel)) {
    const channel = second as ColorChannel;
    return { hsl: { ...settings.hsl, [channel]: { ...settings.hsl[channel], [third]: value } } };
  }
  if (path in settings) return { [top]: value } as Partial<DevelopSettings>;
  throw new Error(`Unsupported develop parameter path: ${path}`);
}

/** Single validated command entry point for sliders, shortcuts, and AI. */
export class DevelopOperationService {
  constructor(
    private readonly documents: IDocumentManager = defaultDocumentManager,
    private readonly history: ICommandBus = defaultCommandBus,
    private readonly assets: IAssetManager = defaultAssetManager,
    private readonly readWhiteBalanceSource: (doc: DevelopDocument, assets: IAssetManager) => Promise<number[][]> = readAutoWhiteBalanceSource,
    readonly clipboard: DevelopSettingsClipboard = defaultDevelopSettingsClipboard,
  ) {}

  private pendingAuto = new Map<string, number>();
  private curveDocumentId: string | null = null;
  private unsubscribeCurve: (() => void) | null = null;
  private curveToken: TransactionToken | null = null;

  async createRawVariant(documentId: string, mode: RawCorrectionMode): Promise<{ commandId: string; documentId: string }> {
    if (mode !== 'camera' && mode !== 'uncorrected') throw new RangeError('Unsupported RAW correction mode');
    const original = this.requireDocument(documentId);
    if (!original.isRaw) throw new RangeError('This operation requires a RAW source');
    if (original.settings.masks.length) throw new RangeError('照片包含局部蒙版，不能复制到不同的镜头坐标。请从原始 RAW 新建。');
    const exif = structuredClone(original.exif);
    delete exif.opticalCorrection;
    const variant = createDevelopDocument({ sourceUri: original.sourceUri,
      fileName: `${original.fileName} · ${mode === 'camera' ? '校正副本' : '未校正副本'}`,
      fileSizeBytes: original.fileSizeBytes, width: original.width, height: original.height,
      isRaw: true, rawProcessingVersion: 2, rawCorrectionMode: mode,
      exif, settings: structuredClone(original.settings) });
    const command = new CreateRawVariantCommand(variant, original.id, this.documents);
    await this.history.execute(command);
    return { commandId: command.id, documentId: variant.id };
  }

  private releaseCurveChange(): void {
    this.unsubscribeCurve?.();
    this.unsubscribeCurve = null; this.curveToken = null; this.curveDocumentId = null;
  }

  copySettings(documentId: string) {
    return this.clipboard.copy(this.requireDocument(documentId));
  }

  async pasteSettings(documentId: string, groups: DevelopSettingsGroup[], includeWB = false): Promise<string> {
    if (typeof includeWB !== 'boolean') throw new RangeError('Include white balance must be boolean');
    const doc = this.requireDocument(documentId);
    const { snapshot, patch } = this.clipboard.selectedPatch(groups);
    if (includeWB) {
      const wb = snapshot.whiteBalance;
      if (wb.mode === 'auto') {
        const activeId = this.documents.getActiveDocument()?.id;
        let cancelled = false;
        const unsubscribe = this.documents.subscribe(event => {
          if ((event.type === 'activated' && event.documentId !== activeId) || (event.type === 'closed' && event.documentId === documentId)) cancelled = true;
        });
        try {
          const samples = await this.readWhiteBalanceSource(doc, this.assets);
          const fresh = this.requireDocument(documentId);
          if (cancelled || fresh.settings !== doc.settings || fresh.sourceAssetId !== doc.sourceAssetId || fresh.nativeAssetId !== doc.nativeAssetId || this.documents.getActiveDocument()?.id !== activeId) {
            throw new Error('Settings paste cancelled because the target document changed');
          }
          patch.whiteBalance = { ...doc.settings.whiteBalance, mode: 'auto', temperature: 5500, tint: 0, resolvedAuto: resolveAutomaticWhiteBalance(samples) };
        } finally { unsubscribe(); }
      } else {
        if (wb.mode === 'as-shot') {
          const multipliers = doc.settings.whiteBalance.cameraMultipliers;
          // LibRaw cam_mul has three active RGB channels; zero may mark unused G2.
          if (!doc.isRaw || !Array.isArray(multipliers) || multipliers.length !== 4 || multipliers.some((value, index) => !Number.isFinite(value) || (index < 3 ? value <= 0 : value < 0))) {
            throw new RangeError('Target as-shot white balance requires resolved RAW camera data');
          }
        }
        patch.whiteBalance = { ...doc.settings.whiteBalance, ...wb, temperature: wb.mode === 'custom' ? wb.temperature : 5500,
          tint: wb.mode === 'custom' ? wb.tint : 0, resolvedAuto: undefined };
      }
    }
    const command = new UpdateDevelopSettingsCommand(documentId, patch, 'Paste Develop Settings', this.documents);
    // Each paste is a distinct action even when two photos are pasted in quick succession.
    command.mergeWith = () => false;
    this.history.execute(command);
    return command.id;
  }

  beginCurveChange(documentId: string): void {
    this.requireDocument(documentId);
    this.abortCurveChange();
    this.curveToken = this.history.beginTransaction('Adjust Tone Curves', documentId);
    this.curveDocumentId = documentId;
    this.unsubscribeCurve = this.documents.subscribe(event => {
      if ((event.type === 'activated' && event.documentId !== documentId) || (event.type === 'closed' && event.documentId === documentId)) this.abortCurveChange();
    });
  }

  previewCurves(documentId: string, curves: ToneCurves): void {
    if (this.curveDocumentId !== documentId || !this.curveToken) throw new Error('No active curve transaction for this document');
    this.history.preview(this.curveCommand(documentId, curves), this.curveToken);
  }

  commitCurveChange(): void {
    if (!this.curveToken) return;
    const token = this.curveToken;
    this.releaseCurveChange();
    this.history.commitTransaction(token);
  }

  abortCurveChange(): void {
    if (!this.curveToken) return;
    const token = this.curveToken;
    this.releaseCurveChange();
    this.history.abortTransaction(token);
  }

  async resolveAutoWhiteBalance(documentId: string, source: DevelopOperationSource): Promise<string> {
    const doc = this.requireDocument(documentId);
    const settings = doc.settings;
    const activeId = this.documents.getActiveDocument()?.id;
    const request = (this.pendingAuto.get(documentId) ?? 0) + 1;
    this.pendingAuto.set(documentId, request);
    let cancelled = false;
    const unsubscribe = this.documents.subscribe(event => {
      if ((event.type === 'activated' && event.documentId !== activeId) ||
          (event.type === 'closed' && event.documentId === documentId)) cancelled = true;
    });
    try {
      const samples = await this.readWhiteBalanceSource(doc, this.assets);
      const current = this.requireDocument(documentId);
      if (cancelled || this.pendingAuto.get(documentId) !== request || current.settings !== settings ||
          current.nativeAssetId !== doc.nativeAssetId || current.sourceAssetId !== doc.sourceAssetId ||
          this.documents.getActiveDocument()?.id !== activeId) {
        throw new Error('Automatic white balance cancelled because the document changed');
      }
      const resolvedAuto = resolveAutomaticWhiteBalance(samples);
      return this.setWhiteBalance(documentId, { mode: 'auto', resolvedAuto }, source);
    } finally { unsubscribe(); }
  }

  private requireDocument(documentId: string) {
    const doc = this.documents.getDevelopDocument(documentId);
    if (!doc) throw new Error(`Develop document not found: ${documentId}`);
    return doc;
  }

  private writeMasks(documentId: string, masks: DevelopMask[], name: string): string {
    const command = new UpdateDevelopSettingsCommand(documentId, { masks }, name, this.documents);
    this.history.execute(command);
    return command.id;
  }

  setWhiteBalance(documentId: string, whiteBalance: WhiteBalanceSettings, _source: DevelopOperationSource): string {
    const doc = this.requireDocument(documentId);
    if (!['as-shot', 'auto', 'custom'].includes(whiteBalance.mode)) throw new Error('Invalid white balance mode');
    if (whiteBalance.mode === 'auto' && !isResolvedAutoWhiteBalance(whiteBalance.resolvedAuto)) {
      throw new Error('自动白平衡需要已解析的原始图像校正');
    }
    const temperature = whiteBalance.temperature ?? doc.settings.whiteBalance.temperature ?? 5500;
    const tint = whiteBalance.tint ?? doc.settings.whiteBalance.tint ?? 0;
    if (!Number.isFinite(temperature) || temperature < 2000 || temperature > 12000 ||
        !Number.isFinite(tint) || tint < -150 || tint > 150) {
      throw new RangeError('White balance temperature or tint is outside its supported range');
    }
    this.pendingAuto.set(documentId, (this.pendingAuto.get(documentId) ?? 0) + 1);
    const command = new UpdateDevelopSettingsCommand(documentId, {
      whiteBalance: { ...doc.settings.whiteBalance, ...structuredClone(whiteBalance), temperature, tint,
        resolvedAuto: whiteBalance.mode === 'auto' ? structuredClone(whiteBalance.resolvedAuto) : undefined },
    }, 'Adjust White Balance', this.documents);
    this.history.execute(command);
    return command.id;
  }

  setCurves(documentId: string, curves: ToneCurves, _source: DevelopOperationSource): string {
    const command = this.curveCommand(documentId, curves);
    this.history.execute(command);
    return command.id;
  }

  private curveCommand(documentId: string, curves: ToneCurves): UpdateDevelopSettingsCommand {
    this.requireDocument(documentId);
    validateToneCurves(curves, Infinity, true);
    const command = new UpdateDevelopSettingsCommand(documentId, { curves: structuredClone(curves) }, 'Adjust Tone Curves', this.documents);
    command.mergeWith = () => false;
    return command;
  }

  resetSection(documentId: string, sectionId: string, _source: DevelopOperationSource): string {
    const doc = this.requireDocument(documentId);
    const defaults = createDefaultDevelopSettings(doc.isRaw);
    const sections: Record<string, { name: string; patch: Partial<DevelopSettings> }> = {
      basic: { name: 'Reset Basic Tone', patch: {
        exposure: defaults.exposure, contrast: defaults.contrast, highlights: defaults.highlights,
        shadows: defaults.shadows, whites: defaults.whites, blacks: defaults.blacks,
      } },
      wb: { name: 'Reset White Balance', patch: { whiteBalance: defaults.whiteBalance } },
      presence: { name: 'Reset Presence & Color', patch: {
        texture: defaults.texture, clarity: defaults.clarity, dehaze: defaults.dehaze,
        vibrance: defaults.vibrance, saturation: defaults.saturation,
      } },
      curves: { name: 'Reset Tone Curves', patch: { curves: defaults.curves } },
      hsl: { name: 'Reset HSL Mixer', patch: { hsl: defaults.hsl } },
      detail: { name: 'Reset Detail & Sharpening', patch: { detail: defaults.detail } },
      optics: { name: 'Reset Optics & Vignette', patch: { optics: defaults.optics } },
    };
    const section = sections[sectionId];
    if (!section) throw new Error(`Unknown develop section: ${sectionId}`);
    const command = new UpdateDevelopSettingsCommand(documentId, section.patch, section.name, this.documents);
    this.history.execute(command);
    return command.id;
  }

  resetAll(documentId: string, _source: DevelopOperationSource): string {
    this.requireDocument(documentId);
    const command = new ResetDevelopSettingsCommand(documentId, this.documents);
    this.history.execute(command);
    return command.id;
  }

  private makeMaskParameterCommand(change: MaskParameterChange): UpdateDevelopSettingsCommand {
    const allowed = new Set(['exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'saturation']);
    if (!allowed.has(change.parameterId)) throw new Error(`Unsupported local parameter: ${change.parameterId}`);
    const definition = PARAM_DEFINITIONS[change.parameterId];
    const minimum = change.parameterId === 'temperature' ? -100 : definition.min;
    const maximum = change.parameterId === 'temperature' ? 100 : definition.max;
    if (!Number.isFinite(change.value) || change.value < minimum || change.value > maximum) {
      throw new RangeError(`${change.parameterId} must be between ${minimum} and ${maximum}`);
    }
    const doc = this.requireDocument(change.documentId);
    if (!doc.settings.masks.some((mask) => mask.id === change.maskId)) throw new Error(`Mask not found: ${change.maskId}`);
    const masks = doc.settings.masks.map((mask) => mask.id === change.maskId ? { ...mask, [change.parameterId]: change.value } : mask);
    return new UpdateDevelopSettingsCommand(doc.id, { masks }, `Adjust local ${definition.label}`, this.documents);
  }

  async createMask(request: CreateMaskRequest): Promise<string> {
    return (await this.createMaskWithResult(request)).maskId;
  }

  async createMaskWithResult(request: CreateMaskRequest): Promise<{ maskId: string; commandId: string }> {
    const doc = this.requireDocument(request.documentId);
    if (!['linear', 'radial', 'brush'].includes(request.kind)) throw new Error('Unsupported mask kind');
    if (!request.name.trim()) throw new Error('Mask name cannot be empty');
    const mask: DevelopMask = {
      id: `devmask_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: request.name.trim(), maskAssetId: '', kind: request.kind,
      geometry: structuredClone(request.geometry), strokes: structuredClone(request.strokes ?? []),
      inverted: false, opacity: 1, exposure: 0, contrast: 0, highlights: 0,
      shadows: 0, temperature: 0, saturation: 0,
    };
    const bytes = rasterizeDevelopMask(mask);
    const asset = await this.assets.registerMask(bytes, 512, 512, mask.name);
    mask.maskAssetId = asset.id;
    // Re-read after the async asset registration in case another operation changed the document.
    const fresh = this.requireDocument(doc.id);
    const commandId = this.writeMasks(doc.id, [...fresh.settings.masks, mask], `Create ${mask.name} mask`);
    return { maskId: mask.id, commandId };
  }

  async updateMask(
    documentId: string, maskId: string,
    patch: Partial<Pick<DevelopMask, 'name' | 'inverted' | 'opacity' | 'geometry' | 'strokes'>>,
    _source: DevelopOperationSource,
  ): Promise<string> {
    if (patch.opacity !== undefined && (!Number.isFinite(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)) {
      throw new RangeError('Mask opacity must be between 0 and 1');
    }
    if (patch.name !== undefined && !patch.name.trim()) throw new Error('Mask name cannot be empty');
    if (patch.inverted !== undefined && typeof patch.inverted !== 'boolean') throw new Error('Mask inverted must be boolean');
    const doc = this.requireDocument(documentId);
    const original = doc.settings.masks.find((mask) => mask.id === maskId);
    if (!original) throw new Error(`Mask not found: ${maskId}`);
    const updated: DevelopMask = { ...original, ...patch };
    if (patch.geometry || patch.strokes) {
      const bytes = rasterizeDevelopMask(updated);
      const asset = await this.assets.registerMask(bytes, 512, 512, updated.name);
      updated.maskAssetId = asset.id;
    }
    const fresh = this.requireDocument(documentId);
    return this.writeMasks(documentId, fresh.settings.masks.map((mask) => mask.id === maskId ? updated : mask), `Edit ${updated.name} mask`);
  }

  deleteMask(documentId: string, maskId: string, _source: DevelopOperationSource): string {
    const doc = this.requireDocument(documentId);
    if (!doc.settings.masks.some((mask) => mask.id === maskId)) throw new Error(`Mask not found: ${maskId}`);
    // Keep the asset resident so undo can restore the same mask without re-rasterizing.
    return this.writeMasks(documentId, doc.settings.masks.filter((mask) => mask.id !== maskId), 'Delete local mask');
  }

  setMaskParameter(change: MaskParameterChange): string {
    const command = this.makeMaskParameterCommand(change);
    this.history.execute(command);
    return command.id;
  }

  beginMaskParameterChange(documentId: string, maskId: string, parameterId: MaskParameterChange['parameterId']): void {
    const doc = this.requireDocument(documentId);
    if (!doc.settings.masks.some((mask) => mask.id === maskId)) throw new Error(`Mask not found: ${maskId}`);
    this.commitCurveChange();
    this.history.beginTransaction(`Adjust local ${PARAM_DEFINITIONS[parameterId].label}`, documentId);
  }

  previewMaskParameterChange(change: MaskParameterChange): void {
    this.history.preview(this.makeMaskParameterCommand(change));
  }

  private makeCommand(change: ParameterChange): UpdateDevelopSettingsCommand {
    const definition = PARAM_DEFINITIONS[change.parameterId];
    if (!definition) throw new Error(`Unknown develop parameter: ${change.parameterId}`);
    if (!Number.isFinite(change.value) || change.value < definition.min || change.value > definition.max) {
      throw new RangeError(`${change.parameterId} must be between ${definition.min} and ${definition.max}`);
    }
    const doc = this.documents.getDevelopDocument(change.documentId);
    if (!doc) throw new Error(`Develop document not found: ${change.documentId}`);
    const path = pathFor(change.parameterId, change.channel);
    return new UpdateDevelopSettingsCommand(
      doc.id, patchAtPath(doc.settings, path, change.value),
      change.description || `Adjust ${definition.label}`, this.documents,
    );
  }

  setParameter(change: ParameterChange): string {
    const command = this.makeCommand(change);
    this.history.execute(command);
    return command.id;
  }

  beginParameterChange(documentId: string, parameterId: DevelopParameterId, channel?: ColorChannel): void {
    const path = pathFor(parameterId, channel);
    const definition = PARAM_DEFINITIONS[parameterId];
    if (!definition) throw new Error(`Unknown develop parameter: ${parameterId}`);
    this.commitCurveChange();
    this.history.beginTransaction(`Adjust ${definition.label} (${path})`, documentId);
  }

  previewParameterChange(documentId: string, parameterId: DevelopParameterId, value: number, channel?: ColorChannel): void {
    const command = this.makeCommand({ documentId, parameterId, value, channel, source: 'manual' });
    this.history.preview(command);
  }

  commitParameterChange(): void {
    this.history.commitTransaction();
  }

  beginNamedChange(documentId: string, description: string): void {
    this.commitCurveChange();
    this.history.beginTransaction(description, documentId);
  }

  abortParameterChange(): void {
    this.history.abortTransaction();
  }
}

export const defaultDevelopOperations = new DevelopOperationService();

export function parameterForPath(path: string): { parameterId: DevelopParameterId; channel?: ColorChannel } | null {
  for (const [parameterId, template] of Object.entries(PARAMETER_PATHS) as [DevelopParameterId, string][]) {
    if (path === template) return { parameterId };
    if (template.includes('{channel}')) {
      const match = /^hsl\.(red|orange|yellow|green|aqua|blue|purple|magenta)\.(hue|saturation|luminance)$/.exec(path);
      if (match && template.replace('{channel}', match[1]) === path) {
        return { parameterId, channel: match[1] as ColorChannel };
      }
    }
  }
  return null;
}
