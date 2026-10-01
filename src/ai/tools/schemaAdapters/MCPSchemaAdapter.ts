// src/ai/tools/schemaAdapters/MCPSchemaAdapter.ts
//! Model Context Protocol (MCP) Tool Schema Adapter (Phase 5)
//! Adapts CanonicalToolSchema to the official Model Context Protocol tool specification.

import { CanonicalToolSchema } from '../../types';

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

export class MCPSchemaAdapter {
  /**
   * Converts canonical tool name to standard studio_* MCP tool name.
   */
  static canonicalToMcpName(canonicalName: string): string {
    if (canonicalName.startsWith('studio_') || canonicalName.startsWith('studio.')) {
      return canonicalName.replace('.', '_');
    }

    // Special mappings
    const mapping: Record<string, string> = {
      'get_workspace': 'studio_get_workspace',
      'get_active_document': 'studio_get_active_document',
      'get_document_context': 'studio_get_document_context',
      'get_develop_settings': 'studio_get_develop_settings',
      'get_histogram': 'studio_get_histogram',
      'get_edit_document': 'studio_get_layers',
      'get_layers': 'studio_get_layers',
      'get_selection': 'studio_get_selection',
      'get_preview': 'studio_get_preview',
      'get_capabilities': 'studio_get_capabilities',
      'create_document': 'studio_create_document',
      'develop_set_exposure': 'studio_set_exposure',
      'develop_set_curves': 'studio_set_curves',
      'develop_copy_settings': 'studio_copy_settings',
      'develop_paste_settings': 'studio_paste_settings',
      'set_exposure': 'studio_set_exposure',
      'develop_set_contrast': 'studio_set_contrast',
      'set_contrast': 'studio_set_contrast',
      'develop_set_temperature': 'studio_set_temperature',
      'set_temperature': 'studio_set_temperature',
      'develop_set_tint': 'studio_set_tint',
      'set_tint': 'studio_set_tint',
      'develop_set_saturation': 'studio_set_saturation',
      'set_saturation': 'studio_set_saturation',
      'develop_set_highlights': 'studio_set_highlights',
      'set_highlights': 'studio_set_highlights',
      'develop_set_shadows': 'studio_set_shadows',
      'set_shadows': 'studio_set_shadows',
      'develop_reset_settings': 'studio_reset_develop_settings',
      'reset_develop_settings': 'studio_reset_develop_settings',
      'edit_create_text_layer': 'studio_create_text_layer',
      'create_text_layer': 'studio_create_text_layer',
      'edit_create_image_layer': 'studio_create_image_layer',
      'create_image_layer': 'studio_create_image_layer',
      'edit_duplicate_layer': 'studio_duplicate_layer',
      'edit_set_layer_locked': 'studio_set_layer_locked',
      'edit_align_layer': 'studio_align_layer',
      'edit_flip_layer': 'studio_flip_layer',
      'edit_delete_layer': 'studio_delete_layer',
      'delete_layer': 'studio_delete_layer',
      'edit_rename_layer': 'studio_rename_layer',
      'rename_layer': 'studio_rename_layer',
      'edit_set_layer_opacity': 'studio_set_layer_opacity',
      'set_layer_opacity': 'studio_set_layer_opacity',
      'edit_set_visibility': 'studio_set_layer_visibility',
      'set_layer_visibility': 'studio_set_layer_visibility',
      'edit_set_blend_mode': 'studio_set_layer_blend_mode',
      'set_layer_blend_mode': 'studio_set_layer_blend_mode',
      'edit_move_layer_order': 'studio_move_layer_order',
      'move_layer_order': 'studio_move_layer_order',
      'edit_select_subject': 'studio_select_subject',
      'select_subject': 'studio_select_subject',
      'edit_select_object': 'studio_select_object',
      'select_object': 'studio_select_object',
      'edit_select_background': 'studio_select_background',
      'select_background': 'studio_select_background',
      'edit_select_sky': 'studio_select_sky',
      'select_sky': 'studio_select_sky',
      'edit_remove_selected_object': 'studio_remove_selected_object',
      'remove_selected_object': 'studio_remove_selected_object',
      'edit_generative_fill': 'studio_generative_fill',
      'generative_fill': 'studio_generative_fill',
      'clear_selection': 'studio_clear_selection',
      'create_mask_from_selection': 'studio_create_mask',
      'edit_create_paint_layer': 'studio_create_paint_layer',
      'create_paint_layer': 'studio_create_paint_layer',
      'edit_create_adjustment_layer': 'studio_create_adjustment_layer',
      'create_adjustment_layer': 'studio_create_adjustment_layer',
      'edit_set_adjustment_settings': 'studio_set_adjustment_settings',
      'set_adjustment_settings': 'studio_set_adjustment_settings',
      'edit_brush_stroke': 'studio_brush_stroke',
      'brush_stroke': 'studio_brush_stroke',
      'edit_paint_mask': 'studio_paint_mask',
      'paint_mask': 'studio_paint_mask',
      'edit_clone_stamp': 'studio_clone_stamp',
      'clone_stamp': 'studio_clone_stamp',
      'edit_heal': 'studio_heal',
      'heal': 'studio_heal',
      'edit_sample_color': 'studio_sample_color',
      'sample_color': 'studio_sample_color',
      'edit_draw_gradient': 'studio_draw_gradient',
      'draw_gradient': 'studio_draw_gradient',
      'edit_create_group': 'studio_create_group',
      'create_group': 'studio_create_group',
      'edit_move_to_group': 'studio_move_to_group',
      'move_to_group': 'studio_move_to_group',
      'edit_create_smart_object': 'studio_create_smart_object',
      'create_smart_object': 'studio_create_smart_object',
      'edit_add_smart_filter': 'studio_add_smart_filter',
      'add_smart_filter': 'studio_add_smart_filter',
      'edit_manage_smart_filter': 'studio_manage_smart_filter',
      'manage_smart_filter': 'studio_manage_smart_filter',
      'edit_transform': 'studio_transform',
      'transform': 'studio_transform',
      'edit_crop': 'studio_crop',
      'crop': 'studio_crop',
      'edit_resize_canvas': 'studio_resize_canvas',
      'resize_canvas': 'studio_resize_canvas',
      'edit_resize_image': 'studio_resize_image',
      'resize_image': 'studio_resize_image',
      'system_undo': 'studio_undo',
      'undo': 'studio_undo',
      'system_redo': 'studio_redo',
      'redo': 'studio_redo',
    };

    if (mapping[canonicalName]) {
      return mapping[canonicalName];
    }

    return `studio_${canonicalName}`;
  }

  /**
   * Resolves an MCP tool name back to its canonical registry name.
   */
  static mcpToCanonicalName(mcpName: string): string {
    const cleanName = mcpName.replace(/^studio[\._]/, '');

    const reverseMapping: Record<string, string> = {
      'get_workspace': 'get_workspace',
      'get_active_document': 'get_active_document',
      'get_document_context': 'get_document_context',
      'get_develop_settings': 'get_develop_settings',
      'get_layers': 'get_edit_document',
      'get_selection': 'get_selection',
      'get_preview': 'get_preview',
      'get_capabilities': 'get_capabilities',
      'create_document': 'create_document',
      'set_exposure': 'set_exposure',
      'set_curves': 'develop_set_curves',
      'copy_settings': 'develop_copy_settings',
      'paste_settings': 'develop_paste_settings',
      'develop_set_exposure': 'develop_set_exposure',
      'set_contrast': 'set_contrast',
      'develop_set_contrast': 'develop_set_contrast',
      'set_temperature': 'set_temperature',
      'develop_set_temperature': 'develop_set_temperature',
      'set_tint': 'set_tint',
      'develop_set_tint': 'develop_set_tint',
      'set_saturation': 'set_saturation',
      'develop_set_saturation': 'develop_set_saturation',
      'set_highlights': 'set_highlights',
      'develop_set_highlights': 'develop_set_highlights',
      'set_shadows': 'set_shadows',
      'develop_set_shadows': 'develop_set_shadows',
      'reset_develop_settings': 'reset_develop_settings',
      'develop_reset_settings': 'develop_reset_settings',
      'create_text_layer': 'create_text_layer',
      'edit_create_text_layer': 'edit_create_text_layer',
      'create_image_layer': 'create_image_layer',
      'edit_create_image_layer': 'edit_create_image_layer',
      'duplicate_layer': 'edit_duplicate_layer',
      'set_layer_locked': 'edit_set_layer_locked',
      'align_layer': 'edit_align_layer',
      'flip_layer': 'edit_flip_layer',
      'delete_layer': 'delete_layer',
      'edit_delete_layer': 'edit_delete_layer',
      'rename_layer': 'rename_layer',
      'edit_rename_layer': 'edit_rename_layer',
      'set_layer_opacity': 'set_layer_opacity',
      'edit_set_layer_opacity': 'edit_set_layer_opacity',
      'set_layer_visibility': 'set_layer_visibility',
      'edit_set_visibility': 'edit_set_visibility',
      'set_layer_blend_mode': 'set_layer_blend_mode',
      'edit_set_blend_mode': 'edit_set_blend_mode',
      'move_layer_order': 'move_layer_order',
      'edit_move_layer_order': 'edit_move_layer_order',
      'select_subject': 'edit_select_subject',
      'select_object': 'edit_select_object',
      'select_background': 'edit_select_background',
      'select_sky': 'edit_select_sky',
      'remove_selected_object': 'edit_remove_selected_object',
      'generative_fill': 'edit_generative_fill',
      'create_mask': 'create_mask_from_selection',
      'clear_selection': 'clear_selection',
      'create_paint_layer': 'edit_create_paint_layer',
      'edit_create_paint_layer': 'edit_create_paint_layer',
      'create_adjustment_layer': 'edit_create_adjustment_layer',
      'edit_create_adjustment_layer': 'edit_create_adjustment_layer',
      'set_adjustment_settings': 'edit_set_adjustment_settings',
      'edit_set_adjustment_settings': 'edit_set_adjustment_settings',
      'brush_stroke': 'edit_brush_stroke',
      'edit_brush_stroke': 'edit_brush_stroke',
      'paint_mask': 'edit_paint_mask',
      'edit_paint_mask': 'edit_paint_mask',
      'clone_stamp': 'edit_clone_stamp',
      'edit_clone_stamp': 'edit_clone_stamp',
      'heal': 'edit_heal',
      'edit_heal': 'edit_heal',
      'sample_color': 'edit_sample_color',
      'edit_sample_color': 'edit_sample_color',
      'draw_gradient': 'edit_draw_gradient',
      'edit_draw_gradient': 'edit_draw_gradient',
      'create_group': 'edit_create_group',
      'edit_create_group': 'edit_create_group',
      'move_to_group': 'edit_move_to_group',
      'edit_move_to_group': 'edit_move_to_group',
      'create_smart_object': 'edit_create_smart_object',
      'edit_create_smart_object': 'edit_create_smart_object',
      'add_smart_filter': 'edit_add_smart_filter',
      'edit_add_smart_filter': 'edit_add_smart_filter',
      'manage_smart_filter': 'edit_manage_smart_filter',
      'edit_manage_smart_filter': 'edit_manage_smart_filter',
      'transform': 'edit_transform',
      'edit_transform': 'edit_transform',
      'crop': 'edit_crop',
      'edit_crop': 'edit_crop',
      'resize_canvas': 'edit_resize_canvas',
      'edit_resize_canvas': 'edit_resize_canvas',
      'resize_image': 'edit_resize_image',
      'edit_resize_image': 'edit_resize_image',
      'undo': 'system_undo',
      'redo': 'system_redo',
    };

    if(['read_guide','discover_tools', 'build_creative_brief', 'get_taste_preferences', 'save_taste_preference',
      'create_candidates', 'list_candidates', 'choose_candidate', 'discard_candidate'].includes(cleanName))return `studio_${cleanName}`;
    return reverseMapping[cleanName] || cleanName;
  }

  static adapt(schema: CanonicalToolSchema): MCPToolDefinition {
    const properties = { ...schema.parameters.properties };
    if (schema.name === 'develop_set_exposure' || schema.name === 'set_exposure') {
      if (!properties.value) {
        properties.value = {
          type: 'number',
          description: 'Exposure compensation value in EV (e.g. 0.5, -0.7, 1.2).',
        };
      }
    }
    return {
      name: this.canonicalToMcpName(schema.name),
      description: schema.description,
      inputSchema: {
        type: 'object',
        properties,
        required: schema.parameters.required,
      },
    };
  }

  static adaptAll(schemas: CanonicalToolSchema[]): MCPToolDefinition[] {
    return schemas.map((s) => this.adapt(s));
  }
}
