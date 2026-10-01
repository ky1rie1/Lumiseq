import { defaultAssetManager } from '../../../assets/AssetManager';
import { findLayerById } from '../../../document/EditDocument';
// src/ai/tools/edit/selectionTools.ts
//! Phase 4 AI Agent Tools: Select Subject, Select Object, Remove Object, Generative Fill

import { CanonicalTool, IToolContext } from '../CanonicalTool';
import { CanonicalToolSchema, ToolResult } from '../../types';
import { defaultSelectionManager } from '../../../selection/SelectionManager';
import { CreateSelectionCommand, ClearSelectionCommand } from '../../../selection/SelectionCommands';
import { defaultInpaintingService } from '../../inpainting/InpaintingService';
import { AddGeneratedPatchLayerCommand } from '../../../commands/edit/AddGeneratedPatchLayerCommand';
import { defaultCapabilityRouter } from '../../capabilities/CapabilityRouter';

import type { EditDocument } from '../../../types/edit';
import { defaultImageEngine } from '../../../engine/WebGLImageEngine';
import { renderCutoutSource } from '../../../cutout/CutoutService';
import { findLayer } from '../../../cutout/ApplyCutoutMaskCommand';
import { maskBounds } from '../../../cutout/cutoutMath';

type SelectionOperation = 'subject' | 'object' | 'background' | 'sky';

/** Read actual pixels at document resolution. Never substitute synthetic content. */
async function readSelectionPixels(doc: EditDocument, target: unknown): Promise<ImageData> {
  if (typeof document === 'undefined') throw new Error('Browser pixel rendering is unavailable.');
  if (!Number.isSafeInteger(doc.width) || !Number.isSafeInteger(doc.height) || doc.width < 1 || doc.height < 1 || doc.width * doc.height > 40_000_000) throw new Error('Selection supports canvases up to 40 million pixels.');
  let canvas: HTMLCanvasElement;
  if (target === 'active_layer') {
    const layer = doc.selectedLayerId && findLayer(doc.layers, doc.selectedLayerId);
    if (!layer) throw new Error('No active source layer is selected.');
    canvas = await renderCutoutSource(doc, layer);
  } else {
    if (target !== undefined && target !== 'composite') throw new Error('Unknown segmentation source target.');
    canvas = document.createElement('canvas'); canvas.width = doc.width; canvas.height = doc.height;
    await defaultImageEngine.renderEdit({ ...doc, backgroundColor: 'rgba(0,0,0,0)' }, canvas);
  }
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Source pixel rendering is unavailable.');
  return context.getImageData(0, 0, doc.width, doc.height);
}

async function selectRealPixels(context: IToolContext, args: Record<string, any>, toolCallId: string, operation: SelectionOperation): Promise<ToolResult> {
  const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
  const doc = docId ? context.documentManager.getEditDocument(docId) : null;
  const failure = (code: NonNullable<ToolResult['error']>['code'], message: string): ToolResult => ({ success: false, toolCallId, renderRequired: false, error: { code, message } });
  if (!doc) return failure('NO_DOCUMENT', 'No active edit document found');
  const fingerprint = JSON.stringify(doc);
  const snapshot: EditDocument = structuredClone(doc);
  let pixels: ImageData;
  try { pixels = await readSelectionPixels(snapshot, args.target); }
  catch (error) { return failure('SOURCE_UNAVAILABLE', error instanceof Error ? error.message : String(error)); }
  const stale = () => JSON.stringify(context.documentManager.getEditDocument(doc.id)) !== fingerprint;
  if (stale()) return failure('STALE_SOURCE', 'The document changed while reading source pixels. Please retry.');
  try {
    const provider = defaultCapabilityRouter.resolveSegmentation();
    const options = { signal: args.signal as AbortSignal | undefined };
    let result;
    if (operation === 'sky') result = await provider.segmentSky(pixels, options);
    else if (operation === 'object' && (args.box || (typeof args.x === 'number' && typeof args.y === 'number'))) result = await provider.segmentObject(pixels, args.box || { x: args.x, y: args.y }, options);
    else if (operation === 'background' && provider.segmentBackground) result = await provider.segmentBackground(pixels, options);
    else result = await provider.segmentSubject(pixels, options);
    options.signal?.throwIfAborted();
    if (stale()) return failure('STALE_SOURCE', 'The document changed during segmentation. Please retry.');
    if (result.width !== doc.width || result.height !== doc.height || result.mask.length !== doc.width * doc.height) throw new Error('Segmentation returned invalid document dimensions.');
    let alpha = result.mask;
    if (operation === 'background' && !provider.segmentBackground) alpha = Uint8ClampedArray.from(alpha, value => 255 - value);
    const bounds = maskBounds(alpha, doc.width, doc.height);
    const feather = args.feather ?? (operation === 'sky' ? 2 : 0);
    if (!Number.isFinite(feather) || feather < 0 || feather > 100) throw new Error('Invalid selection feather radius.');
    const command = new CreateSelectionCommand(doc.id, { rawMask: alpha, bounds, feather, mode: args.mode ?? 'replace', validateSource: () => {
      options.signal?.throwIfAborted();
      if (stale()) throw new Error('The document changed while creating the selection. Please retry.');
    } }, context.documentManager);
    await context.commandBus.execute(command);
    const selectionId = context.documentManager.getEditDocument(doc.id)?.selection?.id || command.id;
    const data = { selectionId, bounds, confidence: result.confidence, provider: result.provider, model: result.model, durationMs: result.durationMs, ...(operation === 'background' ? { selectionType: 'background' } : {}) };
    return { success: true, toolCallId, commandId: command.id, changedDocumentId: doc.id, data, after: data, renderRequired: true };
  } catch (error) { return failure('SEGMENTATION_UNAVAILABLE', error instanceof Error ? error.message : String(error)); }
}

/**
 * 1. edit_select_subject (Section 21)
 */
export class SelectSubjectTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_select_subject',
    description: 'Use the AI segmentation model to automatically detect and select the primary subject/foreground in the canvas.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['active_layer', 'composite'],
          description: 'Segmentation target: "composite" evaluates all visible layers, "active_layer" targets selected layer.',
        },
        feather: {
          type: 'number',
          description: 'Optional edge feather radius in pixels.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    return selectRealPixels(context, args, toolCallId, 'subject');
  }
}

/**
 * 2. edit_select_object (Section 22 & 23)
 */
export class SelectObjectTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_select_object',
    description: 'Select an object using local color heuristics with a point or box; without a prompt, use the local foreground model.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'X coordinate of click seed in document space.',
        },
        y: {
          type: 'number',
          description: 'Y coordinate of click seed in document space.',
        },
        box: {
          type: 'object',
          description: 'Bounding box prompt { x, y, width, height } in document coordinates.',
          properties: {
            x: { type: 'number', description: 'Left coordinate.' },
            y: { type: 'number', description: 'Top coordinate.' },
            width: { type: 'number', description: 'Width of box.' },
            height: { type: 'number', description: 'Height of box.' },
          },
        },
        feather: {
          type: 'number',
          description: 'Edge feathering radius in pixels.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    return selectRealPixels(context, args, toolCallId, 'object');
  }
}

/**
 * 3. edit_select_background (Section 24)
 */
export class SelectBackgroundTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_select_background',
    description: 'Use AI subject segmentation and invert the mask to isolate and select the background region.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        feather: {
          type: 'number',
          description: 'Optional edge feather radius in pixels.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    return selectRealPixels(context, args, toolCallId, 'background');
  }
}

/**
 * 4. edit_select_sky (Section 25)
 */
export class SelectSkyTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_select_sky',
    description: 'Use local color and position heuristics to select sky pixels; this is not neural sky segmentation.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        feather: {
          type: 'number',
          description: 'Optional edge feather radius in pixels.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    return selectRealPixels(context, args, toolCallId, 'sky');
  }
}

/**
 * 5. edit_remove_selected_object (Section 28, 29, 37)
 * Requires active selection. Generates non-destructive GeneratedPatchLayer.
 */
export class RemoveSelectedObjectTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_remove_selected_object',
    description: 'Context-aware AI inpainting to remove the currently selected object, outputting a non-destructive patch layer.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Optional guidance prompt for inpainting background synthesis.',
        },
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
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active edit document found' },
      };
    }

    // Pre-condition: Check if active selection exists
    const activeSelection = doc.selection || defaultSelectionManager.getSelection(doc.id);
    if (!activeSelection || !activeSelection.active || activeSelection.bounds.width <= 0) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: {
          code: 'NO_SELECTION',
          message: 'No active selection found. Please select an object with edit_select_object or edit_select_subject before calling remove.',
        },
      };
    }

    const targetLayer = (doc.selectedLayerId ? findLayerById(doc.layers, doc.selectedLayerId) : null) || doc.layers[0];
    if (!targetLayer) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_LAYER', message: 'No target layer available for inpainting.' },
      };
    }

    // Execute Context-Aware Inpainting
    const inpaintResult = await defaultInpaintingService.executeInpaint(
      doc,
      targetLayer.id,
      activeSelection.bounds,
      activeSelection.assetId,
      { prompt: args.prompt }
    );

    // Create non-destructive GeneratedPatchLayer
    const patchLayer = await defaultInpaintingService.createPatchLayer(
      inpaintResult,
      'Removed Object Patch'
    );

    // Insert layer via CommandBus
    const cmd = new AddGeneratedPatchLayerCommand(doc.id, patchLayer, context.documentManager, doc);
    try { await context.commandBus.execute(cmd); }
    catch (error) { defaultAssetManager.releaseAsset(patchLayer.sourceAssetId); defaultAssetManager.releaseAsset(patchLayer.maskAssetId); throw error; }

    // Clear active selection after removal
    const clearCmd = new ClearSelectionCommand(doc.id, context.documentManager);
    await context.commandBus.execute(clearCmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      data: {
        patchLayerId: patchLayer.id,
        bounds: patchLayer.bounds,
        provider: inpaintResult.metadata.provider,
      },
      after: {
        patchLayerId: patchLayer.id,
        bounds: patchLayer.bounds,
        provider: inpaintResult.metadata.provider,
      },
      renderRequired: true,
    };
  }
}

/**
 * 6. edit_generative_fill (Section 34 & 38)
 */
export class GenerativeFillTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_generative_fill',
    description: 'Synthesize new visual elements inside the selected region guided by a text prompt, creating a non-destructive patch layer.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of what to generate in the selected region.',
        },
        negativePrompt: {
          type: 'string',
          description: 'Optional description of what to avoid.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['prompt'],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const docId = args.documentId || context.documentManager.getActiveDocument()?.id;
    const doc = docId ? context.documentManager.getEditDocument(docId) : null;
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active edit document found' },
      };
    }

    if (!args.prompt) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Parameter "prompt" is required for Generative Fill.' },
      };
    }

    const activeSelection = doc.selection || defaultSelectionManager.getSelection(doc.id);
    if (!activeSelection || !activeSelection.active || activeSelection.bounds.width <= 0) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: {
          code: 'NO_SELECTION',
          message: 'Generative Fill requires an active selection. Please select an area first before generating content.',
        },
      };
    }

    const targetLayer = (doc.selectedLayerId ? findLayerById(doc.layers, doc.selectedLayerId) : null) || doc.layers[0];
    if (!targetLayer) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_LAYER', message: 'No target layer available for generative fill.' },
      };
    }

    const inpaintResult = await defaultInpaintingService.executeInpaint(
      doc,
      targetLayer.id,
      activeSelection.bounds,
      activeSelection.assetId,
      { prompt: String(args.prompt) }
    );

    const patchLayer = await defaultInpaintingService.createPatchLayer(
      inpaintResult,
      `GenFill: ${String(args.prompt).substring(0, 16)}`
    );

    const cmd = new AddGeneratedPatchLayerCommand(doc.id, patchLayer, context.documentManager, doc);
    try { await context.commandBus.execute(cmd); }
    catch (error) { defaultAssetManager.releaseAsset(patchLayer.sourceAssetId); defaultAssetManager.releaseAsset(patchLayer.maskAssetId); throw error; }

    // Clear active selection
    const clearCmd = new ClearSelectionCommand(doc.id, context.documentManager);
    await context.commandBus.execute(clearCmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      data: {
        patchLayerId: patchLayer.id,
        prompt: args.prompt,
        bounds: patchLayer.bounds,
        provider: inpaintResult.metadata.provider,
      },
      after: {
        patchLayerId: patchLayer.id,
        bounds: patchLayer.bounds,
        prompt: args.prompt,
        provider: inpaintResult.metadata.provider,
      },
      renderRequired: true,
    };
  }
}
