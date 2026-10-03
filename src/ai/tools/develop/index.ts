// src/ai/tools/develop/index.ts
import { CanonicalTool, IToolContext } from '../CanonicalTool';
import { CanonicalToolSchema, ToolResult } from '../../types';
import { DevelopOperationService, DevelopParameterId, MaskParameterChange } from '../../../develop/DevelopOperationService';
import { ColorChannel } from '../../../types/common';
import { DevelopMask, ToneCurves, WhiteBalanceSettings } from '../../../types/develop';
import { DEVELOP_SETTINGS_GROUPS, DevelopSettingsGroup } from '../../../develop/DevelopSettingsClipboard';
import { PARAM_DEFINITIONS } from '../../../ui/shared/parameterDefinitions';
import { DevelopAutoToneService } from '../../../develop/DevelopAutoToneService';

const parameterIds: DevelopParameterId[] = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint',
  'texture', 'clarity', 'dehaze', 'vibrance', 'saturation', 'sharpenAmount', 'sharpenRadius',
  'sharpenThreshold', 'lumaDenoise', 'chromaDenoise', 'vignetteAmount', 'vignetteMidpoint',
  'hslHue', 'hslSat', 'hslLum',
];
const colorChannels: ColorChannel[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const localParameters: MaskParameterChange['parameterId'][] = [
  'exposure', 'contrast', 'highlights', 'shadows', 'temperature', 'saturation',
];

function errorResult(toolCallId: string, code: NonNullable<ToolResult['error']>['code'], message: string): ToolResult {
  return { success: false, toolCallId, renderRequired: false, error: { code, message } };
}

function documentFor(context: IToolContext, args: Record<string, any>) {
  const documentId = args.documentId ?? context.documentManager.getActiveDocument()?.id;
  return typeof documentId === 'string' ? context.documentManager.getDevelopDocument(documentId) : null;
}

function serviceError(toolCallId: string, cause: unknown): ToolResult {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.startsWith('Develop document not found:')) return errorResult(toolCallId, 'NO_DOCUMENT', message);
  if (cause instanceof RangeError || /^(Unknown develop parameter|Channel required|Unsupported|Mask not found|Mask name|Mask inverted)/.test(message)) {
    return errorResult(toolCallId, 'INVALID_ARGUMENT', message);
  }
  return errorResult(toolCallId, 'COMMAND_FAILED', message);
}

async function applyParameter(context: IToolContext, args: Record<string, any>, toolCallId: string,
  parameterId: unknown, value: unknown): Promise<ToolResult> {
  const doc = documentFor(context, args);
  if (!doc) return errorResult(toolCallId, 'NO_DOCUMENT', 'No active develop document found');
  if (typeof parameterId !== 'string' || !parameterIds.includes(parameterId as DevelopParameterId)) {
    return errorResult(toolCallId, 'INVALID_ARGUMENT', 'Unknown develop parameter');
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return errorResult(toolCallId, 'INVALID_ARGUMENT', `${parameterId} must be a finite number`);
  }
  const isHsl = ['hslHue', 'hslSat', 'hslLum'].includes(parameterId);
  if (isHsl && !colorChannels.includes(args.channel)) return errorResult(toolCallId, 'INVALID_ARGUMENT', `Channel required for ${parameterId}`);
  if (args.channel !== undefined && !colorChannels.includes(args.channel)) return errorResult(toolCallId, 'INVALID_ARGUMENT', 'Unknown color channel');
  const before = structuredClone(doc.settings);
  try {
    const commandId = new DevelopOperationService(context.documentManager, context.commandBus).setParameter({
      documentId: doc.id, parameterId: parameterId as DevelopParameterId, value, source: 'ai',
      channel: isHsl ? args.channel as ColorChannel : undefined,
    });
    return { success: true, toolCallId, commandId, changedDocumentId: doc.id, before,
      after: context.documentManager.getDevelopDocument(doc.id)?.settings, renderRequired: true };
  } catch (cause) { return serviceError(toolCallId, cause); }
}

export class CreateRawVariantTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_create_raw_variant',
    description: 'Create a separate v2 float RAW document with camera correction or uncorrected inspection. Original document stays intact. Rejects local masks because lens coordinates change. Undo closes the variant; redo decodes fresh. Read its rawState before inspecting/exporting.',
    workspace: 'develop', category: 'develop', riskLevel: 'normal',
    parameters: { type: 'object', properties: {
      documentId: { type: 'string', description: 'Explicit RAW document ID.' },
      mode: { type: 'string', enum: ['camera', 'uncorrected'], description: 'Camera embedded correction or float inspection without distortion/CA/shading; both use the active crop.' },
    }, required: ['documentId', 'mode'] },
  };
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    if (typeof args.documentId !== 'string' || !args.documentId.trim() || !['camera', 'uncorrected'].includes(args.mode)) {
      return errorResult(toolCallId, 'INVALID_ARGUMENT', 'Explicit documentId and valid correction mode are required');
    }
    try {
      const result = await new DevelopOperationService(context.documentManager, context.commandBus).createRawVariant(args.documentId, args.mode);
      return { success: true, toolCallId, commandId: result.commandId, changedDocumentId: result.documentId,
        after: { documentId: result.documentId, rawProcessingVersion: 2, rawCorrectionMode: args.mode, rawState: 'unloaded' }, renderRequired: true };
    } catch (error) { return serviceError(toolCallId, error); }
  }
}

export class AutoDevelopToneTool extends CanonicalTool {
  constructor(private readonly service:(context:IToolContext)=>DevelopAutoToneService=
    context=>new DevelopAutoToneService(context.documentManager,context.commandBus)){super();}
  readonly schema:CanonicalToolSchema={name:'develop_auto_tone',
    description:'Apply natural balanced automatic color from bounded working float samples: eight controls (exposure, contrast, highlights, shadows, whites, blacks, saturation, vibrance) in one undo for v2 photos. Legacy rendering retains six tonal controls. Preserve white balance, curves, HSL, masks and optics. Evidence includes rounded recipe safety; native spatial detail remains unverified until region inspection.',
    workspace:'develop',category:'develop',riskLevel:'normal',parameters:{type:'object',properties:{
      documentId:{type:'string',description:'Optional active develop document ID.'}},required:[]}};
  async execute(context:IToolContext,args:Record<string,any>,toolCallId:string):Promise<ToolResult>{
    const doc=documentFor(context,args);
    if(!doc)return errorResult(toolCallId,'NO_DOCUMENT','No active develop document found');
    if(context.signal?.aborted)return errorResult(toolCallId,'STALE_SOURCE','Automatic tone cancelled');
    if(context.documentManager.getActiveDocument()?.id!==doc.id)return errorResult(toolCallId,'STALE_SOURCE','Automatic tone requires the current document');
    try {
      const result=await this.service(context).applyWithResult(doc.id,()=>!context.signal?.aborted,context.signal);
      if(!result)return errorResult(toolCallId,'STALE_SOURCE','Automatic tone cancelled because the document, source or task changed');
      return {success:true,toolCallId,commandId:result.commandId,changedDocumentId:doc.id,
        after:result,renderRequired:Boolean(result.commandId)};
    }catch(error){return serviceError(toolCallId,error);}
  }
}

export class UpgradeDevelopRenderingTool extends CanonicalTool {
  readonly schema:CanonicalToolSchema={name:'develop_upgrade_rendering',
    description:'Explicitly create a separate RAW copy using current tone/detail rendering. Preserve decoder, correction coordinates, masks and original document; the copy owns a fresh decode. Wait for ready before editing/observing it.',
    workspace:'develop',category:'develop',riskLevel:'normal',parameters:{type:'object',properties:{
      documentId:{type:'string',description:'Explicit source RAW document ID.'}},required:['documentId']}};
  async execute(context:IToolContext,args:Record<string,any>,toolCallId:string):Promise<ToolResult>{
    if(typeof args.documentId!=='string'||!args.documentId.trim())return errorResult(toolCallId,'INVALID_ARGUMENT','Explicit documentId is required');
    try {
      const result=await new DevelopOperationService(context.documentManager,context.commandBus).createRenderingUpgrade(args.documentId,context.signal);
      return {success:true,toolCallId,commandId:result.commandId,changedDocumentId:result.documentId,
        after:{documentId:result.documentId,renderingVersion:2,rawState:'unloaded'},renderRequired:true};
    }catch(error){return serviceError(toolCallId,error);}
  }
}

export class ResetDevelopGroupTool extends CanonicalTool {
  readonly schema:CanonicalToolSchema={name:'develop_reset_group',description:'Reset one named photo settings group as one undo. Preserve masks and rendering/decoder versions; color includes white balance while retaining camera multipliers.',
    workspace:'develop',category:'develop',riskLevel:'normal',parameters:{type:'object',properties:{
      documentId:{type:'string',description:'Optional active develop document ID.'},
      group:{type:'string',description:'Settings group.',enum:[...DEVELOP_SETTINGS_GROUPS]}},required:['group']}};
  async execute(context:IToolContext,args:Record<string,any>,toolCallId:string):Promise<ToolResult>{
    const doc=documentFor(context,args);if(!doc)return errorResult(toolCallId,'NO_DOCUMENT','No active develop document found');
    if(!DEVELOP_SETTINGS_GROUPS.includes(args.group))return errorResult(toolCallId,'INVALID_ARGUMENT','Valid settings group is required');
    try {
      const commandId=new DevelopOperationService(context.documentManager,context.commandBus).resetGroup(doc.id,args.group,'ai');
      return {success:true,toolCallId,commandId,changedDocumentId:doc.id,after:{group:args.group},renderRequired:true};
    }catch(error){return serviceError(toolCallId,error);}
  }
}

export class SetWhiteBalanceTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_white_balance',
    description: 'Set as-shot/manual WB or analyze unedited source pixels for a conservative automatic correction. Auto returns confidence and may retain as-shot colors. This corrects camera-balanced linear sRGB, not sensor WB.',
    workspace: 'develop', category: 'develop', riskLevel: 'normal',
    parameters: { type: 'object', properties: {
      mode: { type: 'string', description: 'White balance mode; default custom.', enum: ['as-shot', 'auto', 'custom'] },
      temperature: { type: 'number', description: 'Custom temperature from 2000 to 12000 K.' },
      tint: { type: 'number', description: 'Custom tint from -150 to 150.' },
      documentId: { type: 'string', description: 'Optional document ID.' },
    }, required: [] },
  };
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const doc = documentFor(context, args);
    if (!doc) return errorResult(toolCallId, 'NO_DOCUMENT', 'No active develop document found');
    const mode = args.mode ?? 'custom';
    if (!['as-shot', 'auto', 'custom'].includes(mode) ||
        (args.temperature !== undefined && typeof args.temperature !== 'number') ||
        (args.tint !== undefined && typeof args.tint !== 'number')) {
      return errorResult(toolCallId, 'INVALID_ARGUMENT', 'Invalid white balance arguments');
    }
    const before = structuredClone(doc.settings.whiteBalance);
    try {
      const operations = new DevelopOperationService(context.documentManager, context.commandBus);
      const commandId = mode === 'auto' ? await operations.resolveAutoWhiteBalance(doc.id, 'ai') :
        operations.setWhiteBalance(doc.id, { mode, temperature: args.temperature, tint: args.tint } as WhiteBalanceSettings, 'ai');
      return { success: true, toolCallId, commandId, changedDocumentId: doc.id, before,
        after: context.documentManager.getDevelopDocument(doc.id)?.settings.whiteBalance, renderRequired: true };
    } catch (cause) { return serviceError(toolCallId, cause); }
  }
}

export class GetDevelopSettingsTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_develop_settings',
    description: 'Get current photographic develop parameters (exposure, contrast, WB temperature, tint, highlights, shadows, saturation).',
    workspace: 'develop',
    category: 'read',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'Optional document ID. If omitted, uses current active develop document.',
        },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getDevelopDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active develop document found' },
      };
    }

    return {
      success: true,
      toolCallId,
      changedDocumentId: doc.id,
      after: {
        fileName: doc.fileName,
        isRaw: doc.isRaw,
        settings: doc.settings,
        exif: doc.exif,
      },
      renderRequired: false,
    };
  }
}

export class GetDevelopParameterSpecsTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_develop_parameter_specs', description: 'Get exact min/max, step, and unit for selected develop parameters; omit IDs for all.',
    workspace: 'develop', category: 'read', riskLevel: 'safe',
    parameters: { type: 'object', properties: {
      parameterIds: { type: 'array', description: 'Parameter IDs to inspect; omit for the full catalog.',
        items: { type: 'string', description: 'Develop parameter ID.', enum: parameterIds } },
    }, required: [] },
  };
  async execute(_context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const ids: unknown = args.parameterIds ?? parameterIds;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !parameterIds.includes(id as DevelopParameterId))) {
      return errorResult(toolCallId, 'INVALID_ARGUMENT', 'Unknown develop parameter ID');
    }
    const data = Object.fromEntries(ids.map(id => {
      const definition = PARAM_DEFINITIONS[id as string];
      return [id, { min: definition.min, max: definition.max, step: definition.step, ...(definition.unit ? { unit: definition.unit } : {}) }];
    }));
    return { success: true, toolCallId, renderRequired: false, data };
  }
}

export class SetExposureTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_exposure',
    description: 'Set photographic exposure compensation in photographic EV units (-5.0 to +5.0 EV). +1 EV doubles brightness in linear working space.',
    workspace: 'develop',
    category: 'develop',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        exposure: {
          type: 'number',
          description: 'Exposure compensation value in EV (e.g. 0.5, -0.7, 1.2).',
        },
        value: {
          type: 'number',
          description: 'Alias for exposure compensation value in EV.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID. Defaults to active develop document.',
        },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getDevelopDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active develop document found' },
      };
    }

    const rawVal = args.exposure !== undefined ? args.exposure : args.value;
    const exposureVal = Number(rawVal);
    if (typeof rawVal !== 'number' || !Number.isFinite(exposureVal)) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Exposure must be a valid number' },
      };
    }

    return applyParameter(context, args, toolCallId, 'exposure', exposureVal);
  }
}

export class SetContrastTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_contrast',
    description: 'Set tone curve contrast (-100 to +100). 0 is neutral.',
    workspace: 'develop',
    category: 'develop',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        contrast: {
          type: 'number',
          description: 'Contrast value between -100 and 100.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['contrast'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getDevelopDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active develop document found' },
      };
    }

    const contrastVal = Number(args.contrast);
    if (typeof args.contrast !== 'number' || !Number.isFinite(contrastVal)) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Contrast must be a valid number' },
      };
    }

    return applyParameter(context, args, toolCallId, 'contrast', contrastVal);
  }
}

export class SetTemperatureTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_temperature',
    description: 'Set white balance color temperature in Kelvin (2000K to 12000K). Higher is warmer, lower is cooler.',
    workspace: 'develop',
    category: 'develop',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        temperature: {
          type: 'number',
          description: 'Color temperature in Kelvin (e.g. 5500, 6500, 3200).',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['temperature'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getDevelopDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active develop document found' },
      };
    }

    const tempVal = Number(args.temperature);
    if (typeof args.temperature !== 'number' || !Number.isFinite(tempVal)) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Temperature must be a valid number' },
      };
    }

    return applyParameter(context, args, toolCallId, 'temperature', tempVal);
  }
}

export class SetTintTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_tint',
    description: 'Set white balance tint from Green (-150) to Magenta (+150).',
    workspace: 'develop',
    category: 'develop',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        tint: {
          type: 'number',
          description: 'Tint value between -150 (green) and +150 (magenta).',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['tint'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getDevelopDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active develop document found' },
      };
    }

    const tintVal = Number(args.tint);
    if (typeof args.tint !== 'number' || !Number.isFinite(tintVal)) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Tint must be a valid number' },
      };
    }

    return applyParameter(context, args, toolCallId, 'tint', tintVal);
  }
}

export class SetSaturationTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_saturation',
    description: 'Adjust overall color saturation (-100 to +100). -100 produces monochrome black and white.',
    workspace: 'develop',
    category: 'develop',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        saturation: {
          type: 'number',
          description: 'Saturation value between -100 and +100.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['saturation'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getDevelopDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active develop document found' },
      };
    }

    const satVal = Number(args.saturation);
    if (typeof args.saturation !== 'number' || !Number.isFinite(satVal)) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Saturation must be a valid number' },
      };
    }

    return applyParameter(context, args, toolCallId, 'saturation', satVal);
  }
}

export class SetHighlightsTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_highlights',
    description: 'Recover or boost highlights in image (-100 to +100). Negative recovers blown highlights.',
    workspace: 'develop',
    category: 'develop',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        highlights: {
          type: 'number',
          description: 'Highlights recovery/boost value between -100 and +100.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['highlights'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getDevelopDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active develop document found' },
      };
    }

    const highVal = Number(args.highlights);
    if (typeof args.highlights !== 'number' || !Number.isFinite(highVal)) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Highlights must be a valid number' },
      };
    }

    return applyParameter(context, args, toolCallId, 'highlights', highVal);
  }
}

export class SetShadowsTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_shadows',
    description: 'Lift shadows or deepen dark areas (-100 to +100). Positive lifts shadow details.',
    workspace: 'develop',
    category: 'develop',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        shadows: {
          type: 'number',
          description: 'Shadows lift/deepen value between -100 and +100.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['shadows'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getDevelopDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active develop document found' },
      };
    }

    const shadVal = Number(args.shadows);
    if (typeof args.shadows !== 'number' || !Number.isFinite(shadVal)) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Shadows must be a valid number' },
      };
    }

    return applyParameter(context, args, toolCallId, 'shadows', shadVal);
  }
}

export class ResetDevelopSettingsTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_reset_settings',
    description: 'Reset all develop parameters to default camera baseline values.',
    workspace: 'develop',
    category: 'develop',
    riskLevel: 'dangerous',
    parameters: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getDevelopDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active develop document found' },
      };
    }

    const beforeSettings = structuredClone(doc.settings);
    const commandId = new DevelopOperationService(context.documentManager, context.commandBus).resetAll(doc.id, 'ai');

    return {
      success: true,
      toolCallId,
      commandId,
      changedDocumentId: doc.id,
      before: beforeSettings,
      after: context.documentManager.getDevelopDocument(doc.id)?.settings,
      renderRequired: true,
    };
  }
}

export class GetHistogramTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_histogram',
    description: 'Retrieve RGB and Luminance tonal distribution histogram bins (256 levels) for analyzing exposure, clipping, and dynamic range.',
    workspace: 'any',
    category: 'read',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  async execute(context: IToolContext, _args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const hist = context.visionSnapshot?.histogram;
    if (!hist) {
      return {
        success: true,
        toolCallId,
        after: {
          available: false,
          message: 'Histogram data not currently cached. Performing visual estimation.',
        },
        renderRequired: false,
      };
    }

    return {
      success: true,
      toolCallId,
      after: {
        available: true,
        histogram: hist,
      },
      renderRequired: false,
    };
  }
}

const documentIdProperty = { type: 'string' as const, description: 'Optional document ID. Defaults to active develop document.' };
const maskIdProperty = { type: 'string' as const, description: 'Local mask ID.' };
const explicitDocumentIdProperty = { type: 'string' as const, description: 'Required source/target develop document ID.' };
function explicitDocumentError(args: Record<string, any>, toolCallId: string): ToolResult | null {
  return typeof args.documentId === 'string' && args.documentId.trim() ? null : errorResult(toolCallId, 'INVALID_ARGUMENT', 'Explicit documentId is required');
}

export class SetDevelopCurvesTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_curves', description: 'Set normalized ordered tone curve points on RGB, red, green, blue. Each channel needs at least two finite points with strictly increasing X in 0–1.',
    workspace: 'develop', category: 'develop', riskLevel: 'normal',
    parameters: { type: 'object', properties: {
      documentId: explicitDocumentIdProperty,
      curves: { type: 'object', description: 'All four normalized tone curves.', required: ['rgb', 'red', 'green', 'blue'],
        properties: Object.fromEntries(['rgb', 'red', 'green', 'blue'].map(channel => [channel, {
          type: 'array' as const, description: `${channel} ordered points.`, items: { type: 'object' as const, description: 'Normalized point.',
            properties: { x: { type: 'number' as const, description: 'Input 0–1, strictly increasing.' }, y: { type: 'number' as const, description: 'Output 0–1.' } }, required: ['x', 'y'] },
        }])) },
    }, required: ['documentId', 'curves'] },
  };
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const invalidId = explicitDocumentError(args, toolCallId);
    if (invalidId) return invalidId;
    const doc = documentFor(context, args);
    if (!doc) return errorResult(toolCallId, 'NO_DOCUMENT', 'No active develop document found');
    const before = structuredClone(doc.settings.curves);
    try {
      const commandId = new DevelopOperationService(context.documentManager, context.commandBus).setCurves(doc.id, args.curves as ToneCurves, 'ai');
      return { success: true, toolCallId, commandId, changedDocumentId: doc.id, before, after: context.documentManager.getDevelopDocument(doc.id)!.settings.curves, renderRequired: true };
    } catch (cause) { return serviceError(toolCallId, cause); }
  }
}

export class CopyDevelopSettingsTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_copy_settings', description: 'Copy explicit or active photo settings to the shared session clipboard. Read-only: excludes camera multipliers, automatic matrices, masks and resources.',
    workspace: 'develop', category: 'read', riskLevel: 'safe',
    parameters: { type: 'object', properties: { documentId: explicitDocumentIdProperty }, required: ['documentId'] },
  };
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const invalidId = explicitDocumentError(args, toolCallId);
    if (invalidId) return invalidId;
    const doc = documentFor(context, args);
    if (!doc) return errorResult(toolCallId, 'NO_DOCUMENT', 'No active develop document found');
    try {
      const data = new DevelopOperationService(context.documentManager, context.commandBus, undefined, undefined, context.developSettingsClipboard).copySettings(doc.id);
      return { success: true, toolCallId, data, renderRequired: false };
    } catch (cause) { return serviceError(toolCallId, cause); }
  }
}

export class PasteDevelopSettingsTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_paste_settings', description: 'Paste selected groups from the shared clipboard in one undoable action. WB excluded by default; includeWB copies custom temperature/tint or resolves auto/as-shot for the target photo. Never transfers camera multipliers or source auto matrix.',
    workspace: 'develop', category: 'develop', riskLevel: 'normal',
    parameters: { type: 'object', properties: { documentId: explicitDocumentIdProperty,
      groups: { type: 'array', description: 'Groups to apply.', items: { type: 'string', description: 'Settings group.', enum: [...DEVELOP_SETTINGS_GROUPS] } },
      includeWB: { type: 'boolean', description: 'Explicitly include white balance.', default: false },
    }, required: ['documentId', 'groups'] },
  };
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const invalidId = explicitDocumentError(args, toolCallId);
    if (invalidId) return invalidId;
    const doc = documentFor(context, args);
    if (!doc) return errorResult(toolCallId, 'NO_DOCUMENT', 'No active develop document found');
    const before = structuredClone(doc.settings);
    try {
      const commandId = await new DevelopOperationService(context.documentManager, context.commandBus, undefined, undefined, context.developSettingsClipboard)
        .pasteSettings(doc.id, args.groups as DevelopSettingsGroup[], args.includeWB ?? false);
      return { success: true, toolCallId, commandId, changedDocumentId: doc.id, before, after: context.documentManager.getDevelopDocument(doc.id)!.settings, renderRequired: true };
    } catch (cause) { return serviceError(toolCallId, cause); }
  }
}

export class SetDevelopParameterTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_parameter', description: 'Set a develop parameter, including detail, optics, or per-channel HSL.',
    workspace: 'develop', category: 'develop', riskLevel: 'normal',
    parameters: { type: 'object', properties: {
      parameterId: { type: 'string', description: 'Develop parameter ID.', enum: parameterIds },
      value: { type: 'number', description: 'New value within the parameter range.' },
      channel: { type: 'string', description: 'Required for HSL parameters.', enum: colorChannels },
      documentId: documentIdProperty,
    }, required: ['parameterId', 'value'] },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    return applyParameter(context, args, toolCallId, args.parameterId, args.value);
  }
}

function validateMaskId(args: Record<string, any>, toolCallId: string): ToolResult | null {
  return typeof args.maskId === 'string' && args.maskId.trim()
    ? null : errorResult(toolCallId, 'INVALID_ARGUMENT', 'Mask ID is required');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalized(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validPoint(value: unknown): boolean {
  return isObject(value) && normalized(value.x) && normalized(value.y);
}

function validGeometry(value: unknown): value is DevelopMask['geometry'] {
  if (!isObject(value)) return false;
  for (const key of ['start', 'end', 'center']) {
    if (value[key] !== undefined && !validPoint(value[key])) return false;
  }
  for (const key of ['radiusX', 'radiusY', 'feather']) {
    if (value[key] !== undefined && !normalized(value[key])) return false;
  }
  return true;
}

function validStrokes(value: unknown): value is NonNullable<DevelopMask['strokes']> {
  return Array.isArray(value) && value.every((stroke) => isObject(stroke) &&
    Array.isArray(stroke.points) && stroke.points.every(validPoint) &&
    normalized(stroke.radius) && normalized(stroke.feather));
}

export class CreateDevelopMaskTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_create_mask', description: 'Create a local linear, radial, or brush adjustment mask.',
    workspace: 'develop', category: 'develop', riskLevel: 'normal',
    parameters: { type: 'object', properties: {
      kind: { type: 'string', description: 'Mask shape.', enum: ['linear', 'radial', 'brush'] },
      name: { type: 'string', description: 'Mask name.' },
      geometry: { type: 'object', description: 'Mask geometry in normalized image coordinates.' },
      strokes: { type: 'array', description: 'Brush strokes in normalized image coordinates.', items: { type: 'object', description: 'Stroke.' } },
      documentId: documentIdProperty,
    }, required: ['kind', 'name', 'geometry'] },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const doc = documentFor(context, args);
    if (!doc) return errorResult(toolCallId, 'NO_DOCUMENT', 'No active develop document found');
    if (!['linear', 'radial', 'brush'].includes(args.kind) || typeof args.name !== 'string' ||
      !args.name.trim() || !validGeometry(args.geometry) || (args.strokes !== undefined && !validStrokes(args.strokes))) {
      return errorResult(toolCallId, 'INVALID_ARGUMENT', 'Valid mask kind, name, and geometry are required');
    }
    try {
      const { maskId, commandId } = await new DevelopOperationService(context.documentManager, context.commandBus).createMaskWithResult({
        documentId: doc.id, kind: args.kind, name: args.name,
        geometry: args.geometry as DevelopMask['geometry'], strokes: args.strokes, source: 'ai',
      });
      return { success: true, toolCallId, commandId, changedDocumentId: doc.id, after: { maskId }, renderRequired: true };
    } catch (cause) { return serviceError(toolCallId, cause); }
  }
}

export class UpdateDevelopMaskTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_update_mask', description: 'Change a local mask name, opacity, inversion, geometry, or brush strokes.',
    workspace: 'develop', category: 'develop', riskLevel: 'normal',
    parameters: { type: 'object', properties: {
      maskId: maskIdProperty, name: { type: 'string', description: 'New mask name.' },
      opacity: { type: 'number', description: 'Opacity from 0 to 1.' },
      inverted: { type: 'boolean', description: 'Invert the mask.' },
      geometry: { type: 'object', description: 'Normalized mask geometry.' },
      strokes: { type: 'array', description: 'Brush strokes.', items: { type: 'object', description: 'Stroke.' } },
      documentId: documentIdProperty,
    }, required: ['maskId'] },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const doc = documentFor(context, args);
    if (!doc) return errorResult(toolCallId, 'NO_DOCUMENT', 'No active develop document found');
    const idError = validateMaskId(args, toolCallId);
    if (idError) return idError;
    const patch: Partial<Pick<DevelopMask, 'name' | 'opacity' | 'inverted' | 'geometry' | 'strokes'>> = {};
    for (const key of ['name', 'opacity', 'inverted', 'geometry', 'strokes'] as const) {
      if (args[key] !== undefined) (patch as Record<string, unknown>)[key] = args[key];
    }
    if (!Object.keys(patch).length || (patch.name !== undefined && typeof patch.name !== 'string') ||
      (patch.opacity !== undefined && (typeof patch.opacity !== 'number' || !Number.isFinite(patch.opacity))) ||
      (patch.inverted !== undefined && typeof patch.inverted !== 'boolean') ||
      (patch.geometry !== undefined && !validGeometry(patch.geometry)) ||
      (patch.strokes !== undefined && !validStrokes(patch.strokes))) {
      return errorResult(toolCallId, 'INVALID_ARGUMENT', 'A valid mask change is required');
    }
    try {
      const commandId = await new DevelopOperationService(context.documentManager, context.commandBus).updateMask(doc.id, args.maskId, patch, 'ai');
      return { success: true, toolCallId, commandId, changedDocumentId: doc.id, after: { maskId: args.maskId }, renderRequired: true };
    } catch (cause) { return serviceError(toolCallId, cause); }
  }
}

export class DeleteDevelopMaskTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_delete_mask', description: 'Delete a local adjustment mask.',
    workspace: 'develop', category: 'develop', riskLevel: 'normal',
    parameters: { type: 'object', properties: { maskId: maskIdProperty, documentId: documentIdProperty }, required: ['maskId'] },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const doc = documentFor(context, args);
    if (!doc) return errorResult(toolCallId, 'NO_DOCUMENT', 'No active develop document found');
    const idError = validateMaskId(args, toolCallId);
    if (idError) return idError;
    try {
      const commandId = new DevelopOperationService(context.documentManager, context.commandBus).deleteMask(doc.id, args.maskId, 'ai');
      return { success: true, toolCallId, commandId, changedDocumentId: doc.id, after: { maskId: args.maskId }, renderRequired: true };
    } catch (cause) { return serviceError(toolCallId, cause); }
  }
}

export class SetDevelopMaskParameterTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'develop_set_mask_parameter', description: 'Set a local adjustment value on a mask.',
    workspace: 'develop', category: 'develop', riskLevel: 'normal',
    parameters: { type: 'object', properties: {
      maskId: maskIdProperty,
      parameterId: { type: 'string', description: 'Local adjustment parameter.', enum: localParameters },
      value: { type: 'number', description: 'Local adjustment value.' }, documentId: documentIdProperty,
    }, required: ['maskId', 'parameterId', 'value'] },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const doc = documentFor(context, args);
    if (!doc) return errorResult(toolCallId, 'NO_DOCUMENT', 'No active develop document found');
    const idError = validateMaskId(args, toolCallId);
    if (idError) return idError;
    if (!localParameters.includes(args.parameterId) || typeof args.value !== 'number' || !Number.isFinite(args.value)) {
      return errorResult(toolCallId, 'INVALID_ARGUMENT', 'Valid local parameter and finite value are required');
    }
    try {
      const commandId = new DevelopOperationService(context.documentManager, context.commandBus).setMaskParameter({
        documentId: doc.id, maskId: args.maskId, parameterId: args.parameterId, value: args.value, source: 'ai',
      });
      return { success: true, toolCallId, commandId, changedDocumentId: doc.id,
        after: { maskId: args.maskId, [args.parameterId]: args.value }, renderRequired: true };
    } catch (cause) { return serviceError(toolCallId, cause); }
  }
}
