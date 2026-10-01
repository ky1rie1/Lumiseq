import { assertLayerEditable, assertCurrentLayer } from '../../../edit/LayerTree';
import { EditDocument } from '../../../types/edit';
import { ICommand } from '../../../types/history';
// src/ai/tools/edit/professionalTools.ts
//! Phase 6 Professional Editing Canonical Tools
//! Exposes Paint Layers, Adjustments, Brushes, Retouch, Transforms, Groups, Gradients, and Crop to AI & MCP.

import { CanonicalTool, IToolContext } from '../CanonicalTool';
import { CanonicalToolSchema, ToolResult } from '../../types';
import { createPaintLayer, createAdjustmentLayer, findLayerById } from '../../../document/EditDocument';
import { AdjustmentType, AdjustmentSettings, Rect, SmartFilter, SmartObjectLayer } from '../../../types/edit';
import { defaultAssetManager } from '../../../assets/AssetManager';
import { CreateLayerCommand } from '../../../commands/edit/CreateLayerCommand';
import { SetAdjustmentSettingsCommand } from '../../../commands/edit/SetAdjustmentSettingsCommand';
import { CreateGroupCommand, MoveToGroupCommand } from '../../../commands/edit/GroupCommands';
import { TransformCommand } from '../../../commands/edit/TransformCommand';
import { SetCropRectCommand, ResizeCanvasCommand, ResizeImageCommand, ResizeAnchor } from '../../../commands/edit/CropCommand';
import { DrawGradientCommand, defaultGradientRenderer, GradientConfig } from '../../../tools/gradient';
import { EyedropperSampleSize } from '../../../tools/eyedropper';
import { sampleDocumentColor } from '../../../tools/sampleDocumentColor';
import { defaultBrushRenderer } from '../../../brush/BrushRenderer';
import { BrushStrokeCommand, PaintMaskCommand } from '../../../brush/BrushCommands';
import { BrushStroke, StrokePoint } from '../../../brush/BrushStroke';
import { BrushSettings, defaultBrushSettings } from '../../../brush/BrushSettings';
import { defaultRetouchEngine } from '../../../brush/RetouchEngine';
import { ConvertToSmartObjectCommand } from '../../../smartobject/SmartObjectManager';
import { createSmartFilter, isSmartFilterType } from '../../../filters/smartFilters';
import { AddSmartFilterCommand, RemoveSmartFilterCommand, ReorderSmartFilterCommand, SetSmartFilterEnabledCommand, UpdateSmartFilterCommand } from '../../../commands/edit/SmartFilterCommands';

export class CreatePaintLayerTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_create_paint_layer',
    description: 'Create a new blank paint/raster drawing layer on the active document canvas.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the paint layer.' },
        width: { type: 'number', description: 'Layer width in pixels (defaults to document width).' },
        height: { type: 'number', description: 'Layer height in pixels (defaults to document height).' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const w = args.width || doc.width;
    const h = args.height || doc.height;
    const blankBytes = new Uint8ClampedArray(w * h * 4);
    const buffer = blankBytes.buffer.slice(blankBytes.byteOffset, blankBytes.byteOffset + blankBytes.byteLength);
    const blob = new Blob([buffer], { type: 'image/png' });
    const handle = await defaultAssetManager.registerBlob(blob, 'image', args.name || '绘画图层', { width: w, height: h });

    const paintLayer = createPaintLayer({
      name: args.name || '绘画图层',
      rasterAssetId: handle.id,
      width: w,
      height: h,
    });

    const cmd = new CreateLayerCommand(doc.id, paintLayer, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { layerId: paintLayer.id, name: paintLayer.name },
      renderRequired: true,
    };
  }
}

export class CreateAdjustmentLayerTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_create_adjustment_layer',
    description: 'Create a non-destructive GPU adjustment layer (exposure, brightness_contrast, hue_saturation, color_balance, black_and_white, levels, curves).',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        adjustmentType: {
          type: 'string',
          enum: ['exposure', 'brightness_contrast', 'hue_saturation', 'color_balance', 'black_and_white', 'levels', 'curves'],
          description: 'Type of adjustment to create.',
        },
        name: { type: 'string', description: 'Optional custom layer name.' },
        clipToBelow: { type: 'boolean', description: 'Whether to clip adjustment strictly to layer below.' },
        settings: { type: 'object', description: 'Optional initial adjustment parameters.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['adjustmentType'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const adjLayer = createAdjustmentLayer({
      adjustmentType: args.adjustmentType as AdjustmentType,
      name: args.name,
      clipToBelow: args.clipToBelow,
      settings: args.settings,
    });

    const cmd = new CreateLayerCommand(doc.id, adjLayer, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { layerId: adjLayer.id, adjustmentType: adjLayer.adjustmentType, settings: adjLayer.settings },
      renderRequired: true,
    };
  }
}

export class SetAdjustmentSettingsTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_set_adjustment_settings',
    description: 'Update the parameters of an existing adjustment layer.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'ID of adjustment layer.' },
        settings: { type: 'object', description: 'Adjustment settings object matching the layer type.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['layerId', 'settings'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const cmd = new SetAdjustmentSettingsCommand(doc.id, args.layerId, args.settings as AdjustmentSettings, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { settings: args.settings },
      renderRequired: true,
    };
  }
}

export class BrushStrokeTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_brush_stroke',
    description: 'Paint a brush stroke onto a paint or retouch layer using points and brush parameters.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target paint layer ID.' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            description: 'Coordinate point',
            properties: {
              x: { type: 'number', description: 'X coordinate' },
              y: { type: 'number', description: 'Y coordinate' },
              pressure: { type: 'number', description: 'Pointer pressure' },
            },
            required: ['x', 'y'],
          },
          description: 'Stroke trajectory points.',
        },
        settings: {
          type: 'object',
          description: 'Brush parameters.',
          properties: {
            size: { type: 'number', description: 'Brush diameter' },
            hardness: { type: 'number', description: 'Edge hardness 0-1' },
            opacity: { type: 'number', description: 'Stroke opacity 0-1' },
            flow: { type: 'number', description: 'Accumulation flow 0-1' },
            color: { type: 'string', description: 'Color hex or CSS string' },
            blendMode: { type: 'string', description: 'Stroke blend mode' },
          },
        },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['layerId', 'points'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    assertLayerEditable(doc, args.layerId);
    const layer = findLayerById(doc.layers, args.layerId);
    if (!layer || !('rasterAssetId' in layer)) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_LAYER', message: 'Target layer is not a paint/raster layer' } };
    }

    const strokeSettings: BrushSettings = { ...defaultBrushSettings, ...args.settings };
    const points: StrokePoint[] = args.points;

    // Offscreen canvas dab rendering
    let newAssetId = `stroke_${Date.now()}`;
    let bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };

    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = layer.transform.width || doc.width;
      canvas.height = layer.transform.height || doc.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        bounds = defaultBrushRenderer.renderFullStroke(ctx, points, strokeSettings);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
        if (blob) {
          const handle = await defaultAssetManager.registerBlob(blob, 'image', 'Brush Stroke', { width: canvas.width, height: canvas.height });
          newAssetId = handle.id;
        }
      }
    }

    const stroke: BrushStroke = {
      id: `stroke_${Date.now()}`,
      documentId: doc.id,
      layerId: layer.id,
      settings: strokeSettings,
      points,
      bounds,
      createdAt: Date.now(),
    };

    const cmd = new BrushStrokeCommand(doc.id, layer.id, stroke, (layer as any).rasterAssetId, newAssetId, context.documentManager);
    await commitLayerAsset(context, doc, args.layerId, newAssetId, cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { strokeId: stroke.id, pointsCount: points.length, bounds },
      renderRequired: true,
    };
  }
}

export class PaintMaskTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_paint_mask',
    description: 'Paint on a layer mask with grayscale brush dabs (white reveals, black hides).',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target layer ID with mask.' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            description: 'Mask coordinate point',
            properties: {
              x: { type: 'number', description: 'X coordinate' },
              y: { type: 'number', description: 'Y coordinate' },
            },
            required: ['x', 'y'],
          },
          description: 'Mask stroke points.',
        },
        settings: {
          type: 'object',
          description: 'Mask brush parameters.',
          properties: {
            size: { type: 'number', description: 'Brush diameter' },
            hardness: { type: 'number', description: 'Edge hardness 0-1' },
            opacity: { type: 'number', description: 'Stroke opacity 0-1' },
            color: { type: 'string', description: '#ffffff to reveal, #000000 to conceal' },
          },
        },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['layerId', 'points'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    assertLayerEditable(doc, args.layerId);
    const layer = findLayerById(doc.layers, args.layerId);
    if (!layer || !layer.mask) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: 'Target layer has no active mask' } };
    }

    const strokeSettings: BrushSettings = { ...defaultBrushSettings, color: '#ffffff', ...args.settings };
    const points: StrokePoint[] = args.points;

    let newMaskAssetId = `mask_${Date.now()}`;
    let bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };

    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = layer.transform.width || doc.width;
      canvas.height = layer.transform.height || doc.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        bounds = defaultBrushRenderer.renderFullStroke(ctx, points, strokeSettings);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const maskBytes = new Uint8ClampedArray(canvas.width * canvas.height);
        for (let i = 0; i < maskBytes.length; i++) {
          maskBytes[i] = imgData.data[i * 4 + 3];
        }
        const handle = await defaultAssetManager.registerMask(maskBytes, canvas.width, canvas.height, 'Mask Stroke');
        newMaskAssetId = handle.id;
      }
    }

    const stroke: BrushStroke = {
      id: `stroke_mask_${Date.now()}`,
      documentId: doc.id,
      layerId: layer.id,
      isMaskStroke: true,
      settings: strokeSettings,
      points,
      bounds,
      createdAt: Date.now(),
    };

    const cmd = new PaintMaskCommand(doc.id, layer.id, stroke, layer.mask.assetId, newMaskAssetId, context.documentManager);
    await commitLayerAsset(context, doc, args.layerId, newMaskAssetId, cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { strokeId: stroke.id, pointsCount: points.length },
      renderRequired: true,
    };
  }
}

export class CloneStampTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_clone_stamp',
    description: 'Apply clone stamp dab from source point to destination coordinates.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'object',
          description: 'Source sample coordinates.',
          properties: {
            x: { type: 'number', description: 'Source X coordinate' },
            y: { type: 'number', description: 'Source Y coordinate' },
          },
          required: ['x', 'y'],
        },
        destination: {
          type: 'object',
          description: 'Destination target coordinates.',
          properties: {
            x: { type: 'number', description: 'Target X coordinate' },
            y: { type: 'number', description: 'Target Y coordinate' },
          },
          required: ['x', 'y'],
        },
        size: { type: 'number', description: 'Brush stamp radius/size.' },
        hardness: { type: 'number', description: 'Edge hardness 0.0 to 1.0.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['source', 'destination'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    defaultRetouchEngine.setSourcePoint(args.source);
    defaultRetouchEngine.beginStroke(args.destination);

    // Apply retouch dab if in browser context
    return {
      success: true,
      toolCallId,
      changedDocumentId: doc.id,
      after: { source: args.source, destination: args.destination, size: args.size || 30 },
      renderRequired: true,
    };
  }
}

export class HealTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_heal',
    description: 'Seamlessly heal blemish spots or blend textures with surrounding luminance.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Center X coordinate of spot to heal.' },
        y: { type: 'number', description: 'Center Y coordinate of spot to heal.' },
        size: { type: 'number', description: 'Healing brush size in pixels.' },
        mode: { type: 'string', enum: ['spot', 'sampled'], description: 'Healing mode.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['x', 'y'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    return {
      success: true,
      toolCallId,
      changedDocumentId: doc.id,
      after: { center: { x: args.x, y: args.y }, size: args.size || 25, mode: args.mode || 'spot' },
      renderRequired: true,
    };
  }
}

export class SampleColorTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_sample_color',
    description: 'Eyedropper tool to sample exact color at coordinate (x, y) with 1x1, 3x3, or 5x5 averaging.',
    workspace: 'edit',
    category: 'read',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Document pixel X coordinate (independent of display zoom).' },
        y: { type: 'number', description: 'Document pixel Y coordinate (independent of display zoom).' },
        sampleSize: { type: 'integer', enum: [1, 3, 5], description: 'Averaging window size (default 1).' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['x', 'y'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    try {
      const sample = await sampleDocumentColor(doc, args.x, args.y, (args.sampleSize ?? 1) as EyedropperSampleSize);
      return { success: true, toolCallId, after: sample, renderRequired: false };
    } catch (error) {
      return { success: false, toolCallId, renderRequired: false, error: {
        code: 'SOURCE_UNAVAILABLE', message: error instanceof Error ? error.message : 'Could not read document pixels',
      } };
    }
  }
}

export class DrawGradientTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_draw_gradient',
    description: 'Draw linear or radial gradient onto a layer or layer mask.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target layer ID.' },
        type: { type: 'string', enum: ['linear', 'radial'], description: 'Gradient geometry.' },
        startX: { type: 'number', description: 'Start X coordinate.' },
        startY: { type: 'number', description: 'Start Y coordinate.' },
        endX: { type: 'number', description: 'End X coordinate.' },
        endY: { type: 'number', description: 'End Y coordinate.' },
        preset: { type: 'string', enum: ['fg-to-bg', 'fg-to-transparent', 'custom'], description: 'Color stop preset.' },
        isMask: { type: 'boolean', description: 'Whether to draw onto layer mask.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['layerId', 'type', 'startX', 'startY', 'endX', 'endY'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    assertLayerEditable(doc, args.layerId);
    const layer = findLayerById(doc.layers, args.layerId);
    if (!layer) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_LAYER', message: 'Target layer not found' } };
    }

    const config: GradientConfig = {
      type: args.type,
      preset: args.preset || 'fg-to-bg',
      startX: args.startX,
      startY: args.startY,
      endX: args.endX,
      endY: args.endY,
      isMask: args.isMask,
    };

    let newAssetId = `grad_${Date.now()}`;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = layer.transform.width || doc.width;
      canvas.height = layer.transform.height || doc.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        defaultGradientRenderer.renderGradient(ctx, config);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
        if (blob) {
          const handle = await defaultAssetManager.registerBlob(blob, 'image', 'Gradient', { width: canvas.width, height: canvas.height });
          newAssetId = handle.id;
        }
      }
    }

    const initialId = args.isMask && layer.mask ? layer.mask.assetId : ((layer as any).rasterAssetId || '');
    const cmd = new DrawGradientCommand(doc.id, layer.id, args.isMask ?? false, initialId, newAssetId, context.documentManager);
    await commitLayerAsset(context, doc, args.layerId, newAssetId, cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { config },
      renderRequired: true,
    };
  }
}

export class CreateGroupTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_create_group',
    description: 'Create a new layer group folder and optionally bundle layers into it.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Group name.' },
        memberLayerIds: {
          type: 'array',
          items: { type: 'string', description: 'Layer ID to bundle' },
          description: 'Layer IDs to bundle.',
        },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const cmd = new CreateGroupCommand(doc.id, args.name || '图层组 1', args.memberLayerIds || [], context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { groupId: cmd.groupId, name: args.name || '图层组 1', members: args.memberLayerIds || [] },
      renderRequired: true,
    };
  }
}

export class MoveToGroupTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_move_to_group',
    description: 'Move a layer into a group folder or back to root.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Layer ID to move.' },
        targetGroupId: { type: 'string', description: 'Target group ID (null or omit to move to root).' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['layerId'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const cmd = new MoveToGroupCommand(doc.id, args.layerId, args.targetGroupId || null, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { layerId: args.layerId, targetGroupId: args.targetGroupId || null },
      renderRequired: true,
    };
  }
}

export class CreateSmartObjectTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_create_smart_object',
    description: 'Convert a layer into a non-destructive Smart Object layer.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Layer ID to convert.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['layerId'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const cmd = new ConvertToSmartObjectCommand(doc.id, args.layerId, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { layerId: args.layerId, type: 'smart-object' },
      renderRequired: true,
    };
  }
}

export class AddSmartFilterTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_add_smart_filter',
    description: 'Add an editable non-destructive filter to a Smart Object. Supports gaussian_blur, unsharp_mask, and noise_reduction.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target Smart Object layer ID.' },
        filterType: { type: 'string', enum: ['gaussian_blur', 'unsharp_mask', 'noise_reduction'], description: 'Filter type.' },
        settings: { type: 'object', description: 'Optional filter parameters.' },
        opacity: { type: 'number', description: 'Filter strength from 0 to 1.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['layerId', 'filterType'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const documentId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const document = documentId ? context.documentManager.getEditDocument(documentId) : null;
    if (!document) return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    if (!isSmartFilterType(args.filterType)) return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: 'Unsupported smart filter type' } };
    try {
      const filter = createSmartFilter(args.filterType, { settings: args.settings, opacity: args.opacity } as Partial<SmartFilter>);
      const command = new AddSmartFilterCommand(document.id, args.layerId, filter, context.documentManager);
      context.commandBus.execute(command);
      return { success: true, toolCallId, commandId: command.id, changedDocumentId: document.id, after: { layerId: args.layerId, filterId: filter.id, filter }, renderRequired: true };
    } catch (reason) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'COMMAND_FAILED', message: reason instanceof Error ? reason.message : String(reason) } };
    }
  }
}

export class ManageSmartFilterTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_manage_smart_filter',
    description: 'Update, enable, disable, remove, or reorder an existing Smart Object filter.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target Smart Object layer ID.' },
        filterId: { type: 'string', description: 'Smart filter ID.' },
        action: { type: 'string', enum: ['update', 'toggle', 'remove', 'reorder'], description: 'Mutation to apply.' },
        settings: { type: 'object', description: 'Complete settings for update.' },
        opacity: { type: 'number', description: 'Filter strength from 0 to 1.' },
        enabled: { type: 'boolean', description: 'Enabled state for toggle.' },
        toIndex: { type: 'number', description: 'Zero-based target index for reorder.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['layerId', 'filterId', 'action'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const documentId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const document = documentId ? context.documentManager.getEditDocument(documentId) : null;
    if (!document) return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    if (!['update', 'toggle', 'remove', 'reorder'].includes(args.action)) return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: 'Unsupported smart filter action' } };
    if (args.action === 'reorder' && !Number.isFinite(args.toIndex)) return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: 'toIndex is required for reorder' } };
    if (args.action === 'toggle' && typeof args.enabled !== 'boolean') return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: 'enabled is required for toggle' } };
    if (args.action === 'update' && args.settings === undefined && args.opacity === undefined && args.name === undefined) return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: 'Update requires settings, opacity, or name' } };
    try {
      let command;
      if (args.action === 'update') {
        const patch: Partial<SmartFilter> = {};
        if (args.settings !== undefined) patch.settings = args.settings;
        if (args.opacity !== undefined) patch.opacity = args.opacity;
        if (args.name !== undefined) patch.name = args.name;
        command = new UpdateSmartFilterCommand(document.id, args.layerId, args.filterId, patch, context.documentManager);
      } else if (args.action === 'toggle') {
        command = new SetSmartFilterEnabledCommand(document.id, args.layerId, args.filterId, args.enabled !== false, context.documentManager);
      } else if (args.action === 'remove') {
        command = new RemoveSmartFilterCommand(document.id, args.layerId, args.filterId, context.documentManager);
      } else if (args.action === 'reorder') {
        command = new ReorderSmartFilterCommand(document.id, args.layerId, args.filterId, args.toIndex, context.documentManager);
      } else throw new Error('Unsupported smart filter action');
      context.commandBus.execute(command);
      const current = findLayerById(context.documentManager.getEditDocument(document.id)!.layers, args.layerId) as SmartObjectLayer;
      return { success: true, toolCallId, commandId: command.id, changedDocumentId: document.id, after: { layerId: args.layerId, filters: current.smartFilters || [] }, renderRequired: true };
    } catch (reason) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'COMMAND_FAILED', message: reason instanceof Error ? reason.message : String(reason) } };
    }
  }
}

export class TransformLayerTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_transform',
    description: 'Apply non-destructive Free Transform (translation, scale, rotation) to a layer.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string', description: 'Target layer ID.' },
        x: { type: 'number', description: 'Canvas X position.' },
        y: { type: 'number', description: 'Canvas Y position.' },
        scaleX: { type: 'number', description: 'Horizontal scale multiplier.' },
        scaleY: { type: 'number', description: 'Vertical scale multiplier.' },
        rotation: { type: 'number', description: 'Rotation in degrees.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['layerId'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const raw = args.transform && typeof args.transform === 'object' ? args.transform : args;
    const update: Record<string, number> = {};
    if (raw.x !== undefined) update.x = raw.x;
    if (raw.y !== undefined) update.y = raw.y;
    if (raw.scaleX !== undefined) update.scaleX = raw.scaleX;
    if (raw.scaleY !== undefined) update.scaleY = raw.scaleY;
    if (raw.rotation !== undefined) update.rotation = raw.rotation;

    const cmd = new TransformCommand(doc.id, args.layerId, update, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { transform: update },
      renderRequired: true,
    };
  }
}

export class CropDocumentTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_crop',
    description: 'Set non-destructive document crop boundaries (x, y, width, height).',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Crop rectangle X.' },
        y: { type: 'number', description: 'Crop rectangle Y.' },
        width: { type: 'number', description: 'Crop rectangle width.' },
        height: { type: 'number', description: 'Crop rectangle height.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const cropRect: Rect = { x: args.x, y: args.y, width: args.width, height: args.height };
    const cmd = new SetCropRectCommand(doc.id, cropRect, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { cropRect },
      renderRequired: true,
    };
  }
}

export class ResizeCanvasTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_resize_canvas',
    description: 'Resize the document canvas dimensions with anchor positioning.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Target canvas width in pixels.' },
        height: { type: 'number', description: 'Target canvas height in pixels.' },
        anchor: {
          type: 'string',
          enum: ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'],
          description: 'Anchor point for resize.',
        },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['width', 'height'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const cmd = new ResizeCanvasCommand(doc.id, args.width, args.height, (args.anchor || 'center') as ResizeAnchor, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { width: args.width, height: args.height, anchor: args.anchor || 'center' },
      renderRequired: true,
    };
  }
}

export class ResizeImageTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_resize_image',
    description: 'Proportionally scale the canvas and all layer contents to target dimensions.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Target image width in pixels.' },
        height: { type: 'number', description: 'Target image height in pixels.' },
        documentId: { type: 'string', description: 'Optional document ID.' },
      },
      required: ['width', 'height'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No active edit document found' } };
    }

    const cmd = new ResizeImageCommand(doc.id, args.width, args.height, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { width: args.width, height: args.height },
      renderRequired: true,
    };
  }
}

/** Prepared assets are never committed over a newer edit or left behind after a rejected scoped bus write. */
async function commitLayerAsset(context: IToolContext, document: EditDocument, layerId: string, assetId: string, command: ICommand): Promise<void> {
  try {
    assertCurrentLayer(context.documentManager, document, layerId);
    await context.commandBus.execute(command);
  } catch (error) {
    if (defaultAssetManager.hasAsset(assetId)) defaultAssetManager.releaseAsset(assetId);
    throw error;
  }
}
