// src/ai/tools/ToolRegistry.ts
import { CanonicalTool } from './CanonicalTool';
import { creativeTools } from './system/creativeTools';
import { InspectDocumentTool, InspectRegionTool, GetObservationTool } from './system/observationTools';
import { DiscoverToolsTool, ReadGuideTool } from './system/guideTools';
import { CanonicalToolSchema } from '../types';
import { LayerOperationTool } from './edit/layerOperationTools';
import { assertLayerEditable, LayerLockedError, locateLayer } from '../../edit/LayerTree';
import { OpenAISchemaAdapter, OpenAIToolDefinition } from './schemaAdapters/OpenAISchemaAdapter';
import { ClaudeSchemaAdapter, ClaudeToolDefinition } from './schemaAdapters/ClaudeSchemaAdapter';
import { GeminiSchemaAdapter, GeminiFunctionDeclaration } from './schemaAdapters/GeminiSchemaAdapter';
import { MCPSchemaAdapter, MCPToolDefinition } from './schemaAdapters/MCPSchemaAdapter';

import {
  GetDevelopSettingsTool,
  GetDevelopParameterSpecsTool,
  SetExposureTool,
  SetContrastTool,
  SetTemperatureTool,
  SetWhiteBalanceTool,
  SetTintTool,
  SetSaturationTool,
  SetHighlightsTool,
  SetShadowsTool,
  ResetDevelopSettingsTool,
  GetHistogramTool,
  SetDevelopParameterTool,
  SetDevelopCurvesTool,
  CopyDevelopSettingsTool,
  PasteDevelopSettingsTool,
  CreateDevelopMaskTool,
  UpdateDevelopMaskTool,
  DeleteDevelopMaskTool,
  SetDevelopMaskParameterTool,
} from './develop';

import {
  GetEditDocumentTool,
  CreateTextLayerTool,
  CreateImageLayerTool,
  DeleteLayerTool,
  RenameLayerTool,
  SetLayerOpacityTool,
  SetLayerBlendModeTool,
  SetLayerVisibilityTool,
  MoveLayerOrderTool,
  SelectSubjectTool,
  SelectObjectTool,
  SelectBackgroundTool,
  SelectSkyTool,
  RemoveSelectedObjectTool,
  GenerativeFillTool,
  CreatePaintLayerTool,
  CreateAdjustmentLayerTool,
  SetAdjustmentSettingsTool,
  BrushStrokeTool,
  PaintMaskTool,
  CloneStampTool,
  HealTool,
  SampleColorTool,
  DrawGradientTool,
  CreateGroupTool,
  MoveToGroupTool,
  CreateSmartObjectTool,
  AddSmartFilterTool,
  ManageSmartFilterTool,
  TransformLayerTool,
  CropDocumentTool,
  ResizeCanvasTool,
  ResizeImageTool,
} from './edit';

import {
  SystemUndoTool,
  SystemRedoTool,
  GetWorkspaceTool,
  GetActiveDocumentTool,
  ListOpenDocumentsTool,
  ActivateDocumentTool,
  GetDocumentContextTool,
  GetPreviewTool,
  GetSelectionTool,
  GetCapabilitiesTool,
  CreateDocumentTool,
  ExportImageTool,
  SaveStudioProjectTool,
} from './system';

export class ToolRegistry {
  private tools = new Map<string, CanonicalTool>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults() {
    for (const tool of creativeTools()) this.register(tool);
    this.register(new DiscoverToolsTool(this));
    this.register(new ReadGuideTool(this));
    // Develop tools
    this.register(new GetDevelopSettingsTool());
    this.register(new GetDevelopParameterSpecsTool());
    this.register(new SetExposureTool());
    this.register(new SetContrastTool());
    this.register(new SetTemperatureTool());
    this.register(new SetWhiteBalanceTool());
    this.register(new SetTintTool());
    this.register(new SetSaturationTool());
    this.register(new SetHighlightsTool());
    this.register(new SetShadowsTool());
    this.register(new ResetDevelopSettingsTool());
    this.register(new GetHistogramTool());
    this.register(new SetDevelopParameterTool());
    this.register(new SetDevelopCurvesTool());
    this.register(new CopyDevelopSettingsTool());
    this.register(new PasteDevelopSettingsTool());
    this.register(new CreateDevelopMaskTool());
    this.register(new UpdateDevelopMaskTool());
    this.register(new DeleteDevelopMaskTool());
    this.register(new SetDevelopMaskParameterTool());

    // Edit tools
    for (const operation of ['duplicate', 'setLocked', 'align', 'flip'] as const) this.register(new LayerOperationTool(operation));
    this.register(new GetEditDocumentTool());
    this.register(new CreateTextLayerTool());
    this.register(new CreateImageLayerTool());
    this.register(new DeleteLayerTool());
    this.register(new RenameLayerTool());
    this.register(new SetLayerOpacityTool());
    this.register(new SetLayerBlendModeTool());
    this.register(new SetLayerVisibilityTool());
    this.register(new MoveLayerOrderTool());
    // Phase 4 Selection, Segmentation & Inpainting tools
    this.register(new SelectSubjectTool());
    this.register(new SelectObjectTool());
    this.register(new SelectBackgroundTool());
    this.register(new SelectSkyTool());
    this.register(new RemoveSelectedObjectTool());
    this.register(new GenerativeFillTool());

    // Phase 6 Professional Editing Core tools
    this.register(new CreatePaintLayerTool(), ['create_paint_layer']);
    this.register(new CreateAdjustmentLayerTool(), ['create_adjustment_layer']);
    this.register(new SetAdjustmentSettingsTool(), ['set_adjustment_settings']);
    this.register(new BrushStrokeTool(), ['brush_stroke']);
    this.register(new PaintMaskTool(), ['paint_mask']);
    this.register(new CloneStampTool(), ['clone_stamp']);
    this.register(new HealTool(), ['heal']);
    this.register(new SampleColorTool(), ['sample_color']);
    this.register(new DrawGradientTool(), ['draw_gradient']);
    this.register(new CreateGroupTool(), ['create_group']);
    this.register(new MoveToGroupTool(), ['move_to_group']);
    this.register(new CreateSmartObjectTool(), ['create_smart_object']);
    this.register(new AddSmartFilterTool(), ['add_smart_filter']);
    this.register(new ManageSmartFilterTool(), ['manage_smart_filter']);
    this.register(new TransformLayerTool(), ['transform_layer']);
    this.register(new CropDocumentTool(), ['crop_document']);
    this.register(new ResizeCanvasTool(), ['resize_canvas']);
    this.register(new ResizeImageTool(), ['resize_image']);

    // System tools
    this.register(new SystemUndoTool());
    this.register(new SystemRedoTool());
    this.register(new GetWorkspaceTool());
    this.register(new GetActiveDocumentTool());
    this.register(new ListOpenDocumentsTool());
    this.register(new ActivateDocumentTool());
    this.register(new GetDocumentContextTool());
    this.register(new GetPreviewTool());
    this.register(new InspectDocumentTool());
    this.register(new InspectRegionTool());
    this.register(new GetObservationTool());
    this.register(new GetSelectionTool());
    this.register(new GetCapabilitiesTool());
    this.register(new CreateDocumentTool());
    this.register(new ExportImageTool());
    this.register(new SaveStudioProjectTool());
  }

  register(tool: CanonicalTool, aliases: string[] = []): void {
    const execute = tool.execute.bind(tool);
    tool.execute = async (context, args, toolCallId) => {
      try {
        const documentId = args.documentId || context.documentManager.getActiveDocument()?.id;
        const doc = documentId ? context.documentManager.getEditDocument(documentId) : null;
        const name = tool.schema.name;
        const layerId = args.layerId || (['edit_clone_stamp', 'edit_heal', 'edit_remove_selected_object', 'edit_generative_fill'].includes(name) ? doc?.selectedLayerId : undefined);
        if (doc && layerId && locateLayer(doc.layers, layerId) && tool.schema.category === 'edit'
          && !['edit_set_visibility', 'edit_duplicate_layer', 'edit_set_layer_locked'].includes(name)) {
          assertLayerEditable(doc, layerId);
        }
        return await execute(context, args, toolCallId);
      } catch (error) {
        if (!(error instanceof LayerLockedError)) throw error;
        return { success: false, toolCallId, renderRequired: false, error: { code: error.code, message: error.message } };
      }
    };
    this.tools.set(tool.schema.name, tool);
    for (const alias of aliases) {
      this.tools.set(alias, tool);
    }
  }

  get(name: string): CanonicalTool | undefined {
    if (this.tools.has(name)) {
      return this.tools.get(name);
    }
    return (
      this.tools.get(`develop_${name}`) ||
      this.tools.get(`edit_${name}`) ||
      this.tools.get(`system_${name}`) ||
      this.tools.get(name.replace(/^develop_|^edit_|^system_/, ''))
    );
  }

  getTool(name: string): CanonicalTool | undefined {
    return this.get(name);
  }

  getAll(): CanonicalTool[] {
    return Array.from(new Set(this.tools.values()));
  }

  getForWorkspace(workspace: 'develop' | 'edit'): CanonicalTool[] {
    return this.getAll().filter(
      (t) => t.schema.workspace === 'any' || t.schema.workspace === workspace
    );
  }

  /** Compact catalog sent to conversational models. Public tool names remain callable via MCP. */
  getForAgent(workspace: 'develop' | 'edit'): CanonicalTool[] {
    const duplicateDevelopTools = new Set([
      'develop_set_exposure', 'develop_set_contrast', 'develop_set_temperature',
      'develop_set_tint', 'develop_set_saturation', 'develop_set_highlights', 'develop_set_shadows',
    ]);
    return this.getForWorkspace(workspace).filter(tool => !duplicateDevelopTools.has(tool.schema.name));
  }

  getSchemas(workspace?: 'develop' | 'edit'): CanonicalToolSchema[] {
    const list = workspace ? this.getForWorkspace(workspace) : this.getAll();
    return list.map((t) => t.schema);
  }

  getOpenAISchemas(workspace?: 'develop' | 'edit'): OpenAIToolDefinition[] {
    return OpenAISchemaAdapter.adaptAll(this.getSchemas(workspace));
  }

  getClaudeSchemas(workspace?: 'develop' | 'edit'): ClaudeToolDefinition[] {
    return ClaudeSchemaAdapter.adaptAll(this.getSchemas(workspace));
  }

  getGeminiSchemas(workspace?: 'develop' | 'edit'): GeminiFunctionDeclaration[] {
    return GeminiSchemaAdapter.adaptAll(this.getSchemas(workspace));
  }

  getMCPSchemas(workspace?: 'develop' | 'edit'): MCPToolDefinition[] {
    return MCPSchemaAdapter.adaptAll(this.getSchemas(workspace));
  }
}

export const defaultToolRegistry = new ToolRegistry();
