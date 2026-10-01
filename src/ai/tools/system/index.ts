import { observeLegacyPreview } from './observationTools';
// src/ai/tools/system/index.ts
import { CanonicalTool, IToolContext } from '../CanonicalTool';
import { CanonicalToolSchema, ToolResult } from '../../types';
import { defaultCapabilityRouter } from '../../capabilities/CapabilityRouter';
import { createDocumentOperations } from '../../../app/DocumentOperationService';
import { APP_NAME, APP_VERSION } from '../../../core/brand';
import { defaultImageExportService, type ImageExportService } from '../../../app/ImageExportService';
import { defaultProjectOperations, type ProjectOperationService } from '../../../app/ProjectOperationService';

export class SystemUndoTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'system_undo',
    description: 'Undo the last performed editing command in history.',
    workspace: 'any',
    category: 'system',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  async execute(context: IToolContext, _args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const undone = context.commandBus.undo();
    return {
      success: undone,
      toolCallId,
      after: {
        undone,
      },
      renderRequired: true,
    };
  }
}

export class SystemRedoTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'system_redo',
    description: 'Redo the previously undone editing command in history.',
    workspace: 'any',
    category: 'system',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  async execute(context: IToolContext, _args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const redone = context.commandBus.redo();
    return {
      success: redone,
      toolCallId,
      after: {
        redone,
      },
      renderRequired: true,
    };
  }
}

export class GetWorkspaceTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_workspace',
    description: 'Get the currently active studio workspace ("develop" for RAW photographic negative editing or "edit" for Photoshop-style multi-layer compositing).',
    workspace: 'any',
    category: 'system',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  async execute(context: IToolContext, _args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    return {
      success: true,
      toolCallId,
      after: {
        workspace: context.currentWorkspace,
      },
      renderRequired: false,
    };
  }
}

export class GetActiveDocumentTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_active_document',
    description: 'Inspect basic status of the currently active document.',
    workspace: 'any',
    category: 'system',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  async execute(context: IToolContext, _args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const doc = context.documentManager.getActiveDocument();
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No document currently open' },
      };
    }

    const docName = doc.kind === 'develop' ? doc.fileName : doc.name;
    return {
      success: true,
      toolCallId,
      changedDocumentId: doc.id,
      after: {
        id: doc.id,
        name: docName,
        kind: doc.kind,
        width: doc.width,
        height: doc.height,
        isDirty: doc.isDirty,
        updatedAt: doc.updatedAt,
      },
      renderRequired: false,
    };
  }
}

export class ListOpenDocumentsTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'list_open_documents',
    description: 'List documents currently open in this desktop session so one can be selected by ID.',
    workspace: 'any', category: 'system', riskLevel: 'safe',
    parameters: { type: 'object', properties: {}, required: [] },
  };

  async execute(context: IToolContext, _args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const activeId = context.documentManager.getActiveDocument()?.id;
    return { success: true, toolCallId, renderRequired: false, data: {
      documents: context.documentManager.getOpenDocuments().map(doc => ({
        id: doc.id, name: doc.kind === 'edit' ? doc.name : doc.fileName,
        kind: doc.kind, width: doc.width, height: doc.height, active: doc.id === activeId,
      })),
    } };
  }
}

export class ActivateDocumentTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'activate_document',
    description: 'Switch the active document to another document already open in this desktop session.',
    workspace: 'any', category: 'system', riskLevel: 'normal',
    parameters: { type: 'object', properties: { documentId: { type: 'string', description: 'ID returned by list_open_documents.' } }, required: ['documentId'] },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    try {
      const doc = createDocumentOperations(context.documentManager).activate(String(args.documentId || ''));
      return { success: true, toolCallId, changedDocumentId: doc.id, renderRequired: true,
        after: { documentId: doc.id, kind: doc.kind, name: doc.kind === 'edit' ? doc.name : doc.fileName } };
    } catch (reason) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: reason instanceof Error ? reason.message : String(reason) } };
    }
  }
}

export class GetDocumentContextTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_document_context',
    description: 'Inspect comprehensive structured state: workspace, document dimensions, layers, develop settings, histogram, and selection.',
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
    const doc = context.documentManager.getActiveDocument();
    if (!doc) {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'NO_DOCUMENT', message: 'No active document found' },
      };
    }

    const resultData: Record<string, any> = {
      workspace: context.currentWorkspace,
      documentId: doc.id,
      kind: doc.kind,
      width: doc.width,
      height: doc.height,
    };

    if (doc.kind === 'develop') {
      const devDoc = context.documentManager.getDevelopDocument(doc.id);
      resultData.developSettings = devDoc?.settings;
    } else {
      const editDoc = context.documentManager.getEditDocument(doc.id);
      resultData.layers = editDoc?.layers.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode,
      }));
      resultData.selection = editDoc?.selection ? {
        active: editDoc.selection.active,
        bounds: editDoc.selection.bounds,
      } : null;
    }

    if (context.visionSnapshot?.histogram) {
      resultData.histogramAvailable = true;
    }

    return {
      success: true,
      toolCallId,
      data: resultData,
      after: resultData,
      renderRequired: false,
    };
  }
}

export class GetPreviewTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_preview',
    description: 'Get downsampled JPEG preview image (512px default, max 1024px) for visual inspection. Never returns full-resolution RAW sensor data.',
    workspace: 'any',
    category: 'read',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {
        maxDimension: {
          type: 'number',
          description: 'Maximum preview dimension in pixels (512 or 1024). Default is 512.',
          enum: [512, 1024],
          default: 512,
        },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    return observeLegacyPreview(context, args, toolCallId);
  }
}

export class GetSelectionTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_selection',
    description: 'Get current active selection state, bounds, and feather radius.',
    workspace: 'edit',
    category: 'read',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  async execute(context: IToolContext, _args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const doc = context.documentManager.getActiveDocument();
    if (!doc || doc.kind !== 'edit') {
      return {
        success: false,
        toolCallId,
        renderRequired: false,
        error: { code: 'WRONG_WORKSPACE', message: 'Selection is only applicable in Edit workspace.' },
      };
    }

    const editDoc = context.documentManager.getEditDocument(doc.id);
    const sel = editDoc?.selection;

    return {
      success: true,
      toolCallId,
      data: sel ? {
        active: sel.active,
        bounds: sel.bounds,
        feather: sel.feather,
      } : { active: false },
      after: sel ? { active: sel.active, bounds: sel.bounds } : { active: false },
      renderRequired: false,
    };
  }
}

export class GetCapabilitiesTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'get_capabilities',
    description: 'Inspect studio capabilities, available workspaces, active document status, and AI capabilities.',
    workspace: 'any',
    category: 'system',
    riskLevel: 'safe',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  async execute(context: IToolContext, _args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const activeDoc = context.documentManager.getActiveDocument();
    const stack = defaultCapabilityRouter.getStackConfig();

    return {
      success: true,
      toolCallId,
      data: {
        app: APP_NAME,
        version: APP_VERSION,
        workspace: context.currentWorkspace,
        activeDocument: activeDoc ? {
          id: activeDoc.id,
          kind: activeDoc.kind,
          width: activeDoc.width,
          height: activeDoc.height,
        } : null,
        capabilities: {
          developWorkspace: true,
          editWorkspace: true,
          rawProcessing: true,
          selectionEngine: true,
          maskEngine: true,
          generatedPatchLayer: true,
          mcpServer: true,
          aiStack: {
            agentProvider: stack.agentProviderId,
            visionProvider: stack.visionProviderId,
            segmentationProvider: stack.segmentationProviderId,
            imageEditProvider: stack.imageEditProviderId,
          },
        },
      },
      renderRequired: false,
    };
  }
}

export class CreateDocumentTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema = {
    name: 'create_document',
    description: 'Create and open a new document in AI Creative Studio (either "edit" for multi-layer compositing or "develop" for RAW photographic negative editing).',
    workspace: 'any',
    category: 'system',
    riskLevel: 'normal',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'Document kind: "edit" (default) or "develop".',
          enum: ['edit', 'develop'],
        },
        name: {
          type: 'string',
          description: 'Document file name or title (e.g. "Poster.psd", "Landscape.arw").',
        },
        width: {
          type: 'number',
          description: 'Document width in pixels (default: 1920).',
        },
        height: {
          type: 'number',
          description: 'Document height in pixels (default: 1080).',
        },
      },
      required: [],
    },
  };

  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const kind = args.kind === 'develop' ? 'develop' : 'edit';
    const name = args.name || (kind === 'develop' ? 'Photo_001.arw' : 'Untitled-1.psd');
    const width = args.width === undefined ? 1920 : Number(args.width);
    const height = args.height === undefined ? 1080 : Number(args.height);
    const operations = createDocumentOperations(context.documentManager);
    let doc;
    try {
      doc = operations.create({ kind, name, width, height });
    } catch (reason) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: reason instanceof Error ? reason.message : String(reason) } };
    }

    return {
      success: true,
      toolCallId,
      changedDocumentId: doc.id,
      after: {
        documentId: doc.id,
        kind: doc.kind,
        name: doc.kind === 'develop' ? doc.fileName : doc.name,
        width: doc.width,
        height: doc.height,
      },
      renderRequired: true,
    };
  }
}

export class ExportImageTool extends CanonicalTool {
  constructor(private readonly operation: Pick<ImageExportService, 'export'> = defaultImageExportService) { super(); }
  readonly schema: CanonicalToolSchema = {
    name: 'system_export_image',
    description: 'Export the specified open document as a rendered JPEG or PNG. Requires a local absolute output path; project state is unchanged.',
    workspace: 'any', category: 'system', riskLevel: 'dangerous',
    parameters: { type: 'object', properties: {
      documentId: { type: 'string', description: 'Exact open document ID.' },
      path: { type: 'string', description: 'Absolute local .jpg/.jpeg or .png output path.' },
      format: { type: 'string', description: 'Output format.', enum: ['jpeg', 'png'] },
      quality: { type: 'integer', description: 'JPEG quality 1–100; default 90.' },
      width: { type: 'integer', description: 'Output width in pixels; default document width.' },
      height: { type: 'integer', description: 'Output height in pixels; default document height.' },
    }, required: ['documentId', 'path', 'format'] },
  };
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const doc = typeof args.documentId === 'string' ? context.documentManager.getDocument(args.documentId) : null;
    if (!doc) return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'Document not found.' } };
    if (typeof args.path !== 'string' || !['jpeg', 'png'].includes(args.format)) return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: 'A local path and JPEG or PNG format are required.' } };
    try {
      await this.operation.export(doc, args.path, { format: args.format,
        quality: args.quality ?? 90, width: args.width ?? doc.width, height: args.height ?? doc.height });
      return { success: true, toolCallId, renderRequired: false, data: { path: args.path, format: args.format } };
    } catch (reason) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'COMMAND_FAILED', message: reason instanceof Error ? reason.message : String(reason) } };
    }
  }
}

export class SaveStudioProjectTool extends CanonicalTool {
  constructor(private readonly operation: Pick<ProjectOperationService, 'save'> = defaultProjectOperations) { super(); }
  readonly schema: CanonicalToolSchema = {
    name: 'system_save_project',
    description: 'Save the specified open document as an editable .aistudio project at a local absolute path.',
    workspace: 'any', category: 'system', riskLevel: 'dangerous',
    parameters: { type: 'object', properties: {
      documentId: { type: 'string', description: 'Exact open document ID.' },
      path: { type: 'string', description: 'Absolute local .aistudio output path.' },
    }, required: ['documentId', 'path'] },
  };
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    const doc = typeof args.documentId === 'string' ? context.documentManager.getDocument(args.documentId) : null;
    if (!doc) return { success: false, toolCallId, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'Document not found.' } };
    if (typeof args.path !== 'string') return { success: false, toolCallId, renderRequired: false, error: { code: 'INVALID_ARGUMENT', message: 'A local project path is required.' } };
    try {
      await this.operation.save(doc, args.path);
      return { success: true, toolCallId, renderRequired: false, data: { path: args.path } };
    } catch (reason) {
      return { success: false, toolCallId, renderRequired: false, error: { code: 'COMMAND_FAILED', message: reason instanceof Error ? reason.message : String(reason) } };
    }
  }
}
