import { findLayerById, flattenLayerTree } from '../../../document/EditDocument';
import { locateLayer, isLayerLocked } from '../../../edit/LayerTree';
// src/ai/tools/edit/index.ts
import { CanonicalTool, IToolContext } from '../CanonicalTool';
import { CanonicalToolSchema, ToolResult } from '../../types';
import { CreateLayerCommand } from '../../../commands/edit/CreateLayerCommand';
import { DeleteLayerCommand } from '../../../commands/edit/DeleteLayerCommand';
import { RenameLayerCommand } from '../../../commands/edit/RenameLayerCommand';
import { SetLayerOpacityCommand } from '../../../commands/edit/SetLayerOpacityCommand';
import { ToggleLayerVisibilityCommand } from '../../../commands/edit/ToggleLayerVisibilityCommand';
import { SetLayerBlendModeCommand } from '../../../commands/edit/SetLayerBlendModeCommand';
import { MoveLayerOrderCommand } from '../../../commands/edit/MoveLayerOrderCommand';
import { TextLayer, ImageLayer, BlendMode } from '../../../types/edit';

let aiCreatedLayerSerial = 0;

export class GetEditDocumentTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_edit_document',
    description: 'Inspect Edit document canvas dimensions, active layer stack, and composition properties.',
    workspace: 'edit',
    category: 'read',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'Optional document ID. Defaults to active edit document.',
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

    return {
      success: true,
      toolCallId,
      changedDocumentId: doc.id,
      after: {
        id: doc.id,
        name: doc.name,
        width: doc.width,
        height: doc.height,
        selectedLayerId: doc.selectedLayerId,
        layerCount: flattenLayerTree(doc.layers).length,
        layers: flattenLayerTree(doc.layers).map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type,
          visible: l.visible,
          parentId: locateLayer(doc.layers, l.id)?.parent?.id ?? null,
          locked: l.locked ?? false,
          effectiveLocked: isLayerLocked(doc, l.id),
          opacity: l.opacity,
          blendMode: l.blendMode,
          transform: l.transform,
        })),
      },
      renderRequired: false,
    };
  }
}

export class CreateTextLayerTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_create_text_layer',
    description: 'Create a new typography/text layer on the canvas with customizable text, font size, color, and position.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text string to display.',
        },
        name: {
          type: 'string',
          description: 'Layer name in layer panel.',
        },
        fontSize: {
          type: 'number',
          description: 'Font size in pixels (default 48).',
        },
        color: {
          type: 'string',
          description: 'Hex color string (e.g. "#ffffff", "#3b82f6").',
        },
        x: {
          type: 'number',
          description: 'X coordinate on canvas (default centered or 100).',
        },
        y: {
          type: 'number',
          description: 'Y coordinate on canvas (default centered or 100).',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['text'],
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

    const textContent = String(args.text);
    const layerName = args.name || `Text: ${textContent.slice(0, 16)}`;
    const fontSize = args.fontSize ? Number(args.fontSize) : 48;
    const color = args.color || '#ffffff';
    const x = args.x !== undefined ? Number(args.x) : 100;
    const y = args.y !== undefined ? Number(args.y) : 100;

    const layerId = `layer_text_${Date.now()}_${++aiCreatedLayerSerial}`;
    const textLayer: TextLayer = {
      id: layerId,
      name: layerName,
      type: 'text',
      visible: true,
      opacity: 1.0,
      blendMode: 'normal',
      transform: {
        x,
        y,
        width: fontSize * textContent.length * 0.6,
        height: fontSize * 1.2,
        rotation: 0,
        scaleX: 1.0,
        scaleY: 1.0,
      },
      text: textContent,
      fontSize,
      fontFamily: 'Inter',
      color,
      align: 'left',
      letterSpacing: 0,
    };

    const cmd = new CreateLayerCommand(doc.id, textLayer, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: {
        createdLayerId: layerId,
        layer: textLayer,
      },
      renderRequired: true,
    };
  }
}

export class CreateImageLayerTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_create_image_layer',
    description: 'Add an existing asset as a new image layer to the composition.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        assetId: {
          type: 'string',
          description: 'Asset ID registered in AssetManager.',
        },
        name: {
          type: 'string',
          description: 'Layer name.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['assetId'],
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

    const assetId = String(args.assetId);
    const layerId = `layer_img_${Date.now()}_${++aiCreatedLayerSerial}`;
    const imageLayer: ImageLayer = {
      id: layerId,
      name: args.name || '图像图层',
      type: 'image',
      visible: true,
      opacity: 1.0,
      blendMode: 'normal',
      transform: {
        x: 0,
        y: 0,
        width: doc.width,
        height: doc.height,
        rotation: 0,
        scaleX: 1.0,
        scaleY: 1.0,
      },
      sourceAssetId: assetId,
      naturalWidth: doc.width,
      naturalHeight: doc.height,
    };

    const cmd = new CreateLayerCommand(doc.id, imageLayer, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: {
        createdLayerId: layerId,
        layer: imageLayer,
      },
      renderRequired: true,
    };
  }
}

export class DeleteLayerTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_delete_layer',
    description: 'Delete a layer from the composition. (Considered normal risk, requires confirmation under ask mode).',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: {
          type: 'string',
          description: 'ID of layer to remove.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['layerId'],
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

    const layerId = String(args.layerId);
    const layer = findLayerById(doc.layers, layerId);
    if (!layer) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: `Layer "${layerId}" not found in document` },
      };
    }

    const cmd = new DeleteLayerCommand(doc.id, layerId, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      before: { deletedLayer: layer },
      renderRequired: true,
    };
  }
}

export class RenameLayerTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_rename_layer',
    description: 'Rename a layer in the document layer stack.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {
        layerId: {
          type: 'string',
          description: 'Target layer ID.',
        },
        newName: {
          type: 'string',
          description: 'New layer display name.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['layerId', 'newName'],
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

    const layerId = String(args.layerId);
    const newName = String(args.newName);
    const layer = findLayerById(doc.layers, layerId);
    if (!layer) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: `Layer "${layerId}" not found` },
      };
    }

    const cmd = new RenameLayerCommand(doc.id, layerId, newName, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      before: { name: layer.name },
      after: { name: newName },
      renderRequired: false,
    };
  }
}

export class SetLayerOpacityTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_set_layer_opacity',
    description: 'Set layer opacity between 0.0 (completely transparent) and 1.0 (fully opaque).',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {
        layerId: {
          type: 'string',
          description: 'Layer ID to adjust.',
        },
        opacity: {
          type: 'number',
          description: 'Opacity float from 0.0 to 1.0 (e.g. 0.7 for 70%).',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['layerId', 'opacity'],
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

    const layerId = String(args.layerId);
    const layer = findLayerById(doc.layers, layerId);
    if (!layer) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: `Layer "${layerId}" not found` },
      };
    }

    const opacity = Math.max(0, Math.min(1, Number(args.opacity)));
    const cmd = new SetLayerOpacityCommand(doc.id, layerId, opacity, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      before: { opacity: layer.opacity },
      after: { opacity },
      renderRequired: true,
    };
  }
}

export class SetLayerBlendModeTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_set_blend_mode',
    description: 'Set layer compositing blend mode.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {
        layerId: {
          type: 'string',
          description: 'Target layer ID.',
        },
        blendMode: {
          type: 'string',
          enum: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'],
          description: 'Blend mode algorithm.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['layerId', 'blendMode'],
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

    const layerId = String(args.layerId);
    const blendMode = args.blendMode as BlendMode;
    const layer = findLayerById(doc.layers, layerId);
    if (!layer) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: `Layer "${layerId}" not found` },
      };
    }

    const cmd = new SetLayerBlendModeCommand(doc.id, layerId, blendMode, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      before: { blendMode: layer.blendMode },
      after: { blendMode },
      renderRequired: true,
    };
  }
}

export class SetLayerVisibilityTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_set_visibility',
    description: 'Toggle or set layer visibility.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {
        layerId: {
          type: 'string',
          description: 'Target layer ID.',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['layerId'],
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

    const layerId = String(args.layerId);
    const layer = findLayerById(doc.layers, layerId);
    if (!layer) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'INVALID_ARGUMENT', message: `Layer "${layerId}" not found` },
      };
    }

    const cmd = new ToggleLayerVisibilityCommand(doc.id, layerId, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      before: { visible: layer.visible },
      after: { visible: !layer.visible },
      renderRequired: true,
    };
  }
}

export class MoveLayerOrderTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'edit_move_layer_order',
    description: 'Reorder a layer to a new index in the layer stack.',
    workspace: 'edit',
    category: 'edit',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        layerId: {
          type: 'string',
          description: 'Target layer ID.',
        },
        toIndex: {
          type: 'integer',
          description: 'Target index in the layer list (0 is bottom).',
        },
        documentId: {
          type: 'string',
          description: 'Optional document ID.',
        },
      },
      required: ['layerId', 'toIndex'],
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

    const layerId = String(args.layerId);
    const toIndex = Number(args.toIndex);
    const cmd = new MoveLayerOrderCommand(doc.id, layerId, toIndex, context.documentManager);
    context.commandBus.execute(cmd);

    return {
      success: true,
      toolCallId,
      commandId: cmd.id,
      changedDocumentId: doc.id,
      after: { toIndex },
      renderRequired: true,
    };
  }
}

export * from './selectionTools';
export * from './professionalTools';
