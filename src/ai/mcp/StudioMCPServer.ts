// src/ai/mcp/StudioMCPServer.ts
//! AI Creative Studio - Model Context Protocol (MCP) Server (Phase 5)
//! Built using the official @modelcontextprotocol/sdk.
//! Enforces: MCP Client -> PermissionGuard -> CanonicalTool -> Command -> CommandBus -> Document Engine.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry, defaultToolRegistry } from '../tools/ToolRegistry';
import { MCPSchemaAdapter } from '../tools/schemaAdapters/MCPSchemaAdapter';
import { PermissionGuard, defaultPermissionGuard } from '../permissions/PermissionGuard';
import { DocumentManager, defaultDocumentManager } from '../../document/DocumentManager';
import { CommandBus, defaultCommandBus } from '../../history/CommandBus';
import { VisionInspector, defaultVisionInspector } from '../vision/VisionInspector';
import { IToolContext } from '../tools/CanonicalTool';
import { PermissionLevel } from '../types';
import { DocumentObservationService } from '../vision/DocumentObservationService';
import { metadataOnly, normalizeImageMessages, DEFAULT_IMAGE_LIMITS, serializeImageRequest } from '../providers/imageTransport';
import { APP_VERSION } from '../../core/brand';
import { guideResources } from '../harness/OperationGuide';
import { CandidateService } from '../harness/CandidateService';
import { defaultTastePreferences, type TastePreferences } from '../harness/TastePreferences';

export interface StudioMCPServerOptions {
  permissionLevel?: PermissionLevel;
  observationService?: DocumentObservationService;
  candidateService?: CandidateService;
  tastePreferences?: TastePreferences;
  onActionExecuted?: (action: { toolName: string; args: any; success: boolean }) => void;
}

export class StudioMCPServer {
  private server: Server;
  private observationService: DocumentObservationService;
  private candidateService: CandidateService;
  private tastePreferences: TastePreferences;
  private ownsObservationService: boolean;
  private observationIds = new Set<string>();
  private requestHandlers = new Map<string, (request: any) => Promise<any>>();
  private permissionLevel: PermissionLevel = 'ask';
  private onActionExecuted?: (action: { toolName: string; args: any; success: boolean }) => void;

  constructor(
    private toolRegistry: ToolRegistry = defaultToolRegistry,
    private permissionGuard: PermissionGuard = defaultPermissionGuard,
    private documentManager: DocumentManager = defaultDocumentManager,
    private commandBus: CommandBus = defaultCommandBus,
    private visionInspector: VisionInspector = defaultVisionInspector,
    options?: StudioMCPServerOptions
  ) {
    if (options?.permissionLevel) {
      this.permissionLevel = options.permissionLevel;
    }
    this.onActionExecuted = options?.onActionExecuted;
    this.ownsObservationService = !options?.observationService;
    this.observationService = options?.observationService ?? new DocumentObservationService({documents:this.documentManager});
    this.candidateService = options?.candidateService ?? new CandidateService({ documents: documentManager, commandBus,
      toolRegistry, observationService: this.observationService, permissionGuard });
    this.tastePreferences = options?.tastePreferences ?? defaultTastePreferences;

    this.server = new Server(
      {
        name: 'ai-creative-studio',
        version: APP_VERSION,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.registerHandlers();
  }

  getServer(): Server {
    return this.server;
  }

  setPermissionLevel(level: PermissionLevel): void {
    this.permissionLevel = level;
  }

  getPermissionLevel(): PermissionLevel {
    return this.permissionLevel;
  }

  private rememberObservation(id: string): void {
    this.observationIds.delete(id);
    this.observationIds.add(id);
    while (this.observationIds.size > DEFAULT_IMAGE_LIMITS.maxImages) this.observationIds.delete(this.observationIds.values().next().value!);
  }

  /** Public dispatch for the native bridge; uses the same validated handlers as the SDK. */
  async dispatch(request: { method: string; params?: unknown }): Promise<any> {
    const handler = this.requestHandlers.get(request.method);
    if (!handler) throw new McpError(ErrorCode.MethodNotFound, `Unknown method '${request.method}'`);
    return handler(request);
  }

  private setRequestHandler(schema: any, handler: (request: any) => Promise<any>): void {
    const method = schema.shape.method.value as string;
    this.requestHandlers.set(method, request => handler(schema.parse(request)));
    this.server.setRequestHandler(schema, handler);
  }

  private registerHandlers(): void {
    // 1. tools/list handler
    this.setRequestHandler(ListToolsRequestSchema, async () => {
      const schemas = this.toolRegistry.getMCPSchemas();
      return {
        tools: schemas.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    });

    // 2. tools/call handler
    this.setRequestHandler(CallToolRequestSchema, async (request) => {
      const mcpName = request.params.name;
      const args = request.params.arguments || {};
      const canonicalName = MCPSchemaAdapter.mcpToCanonicalName(mcpName);

      const tool = this.toolRegistry.get(canonicalName);
      if (!tool) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool '${mcpName}' (canonical: '${canonicalName}')`
        );
      }

      // MCP supplies its own effective level; only the confirmation callback is shared.
      const allowed = await this.permissionGuard.checkPermission(tool, args, this.permissionLevel);
      if (!allowed) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: this.permissionLevel === 'readonly'
                ? `Operation rejected: Tool '${mcpName}' modifies state, but external agent is in Read-Only mode.`
                : `Permission denied by user for tool '${mcpName}'.`,
            },
          ],
        };
      }

      // Prepare Tool Context
      const activeWorkspace = this.documentManager.getActiveDocument()?.kind || 'develop';
      const toolContext: IToolContext = {
        documentManager: this.documentManager,
        commandBus: this.commandBus,
        currentWorkspace: activeWorkspace as 'develop' | 'edit',
        visionSnapshot: this.visionInspector.captureSnapshot(this.documentManager, false),
        observationService: this.observationService,
        candidateService: this.candidateService,
        tastePreferences: this.tastePreferences,
        // Dangerous creative tools always require PermissionGuard's user callback,
        // including when the external client's effective permission level is full.
        userApproved: tool.schema.riskLevel === 'dangerous',
      };

      const callId = `mcp_call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      try {
        // Execute tool via CanonicalTool -> Command -> CommandBus
        const result = await tool.execute(toolContext, args, callId);

        if (this.onActionExecuted) {
          this.onActionExecuted({
            toolName: mcpName,
            args,
            success: result.success,
          });
        }

        if (!result.success) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: result.error?.message || 'Tool execution failed',
              },
            ],
          };
        }

        const images = normalizeImageMessages([{role:'tool',images:result.images}], DEFAULT_IMAGE_LIMITS)[0].images ?? [];
        for(const image of images) if(image.observationId) this.rememberObservation(image.observationId);
        const response = {
          content: [
            {
              type: 'text',
              text: JSON.stringify(metadataOnly(result.data || result.after || { success: true }), null, 2),
            },
            ...images.map(image => ({type:'image',mimeType:image.mimeType,data:image.data})),
          ],
        };
        serializeImageRequest(response);
        return response;
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Internal execution error: ${err.message || String(err)}`,
            },
          ],
        };
      }
    });

    // 3. resources/list handler
    this.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          ...guideResources(this.toolRegistry).map(({text: _text,...resource})=>resource),
          ...[...this.observationIds].filter(id => this.observationService.get(id)).map(id => ({uri:`studio://observation/${id}`,name:`Observation ${id}`,mimeType:'application/json',description:'Versioned observation evidence; use studio_get_observation for bounded image content.'})),
          {
            uri: 'studio://document/active',
            name: 'Active Document Context',
            description: 'Structured metadata, layers, and develop settings of the currently open document.',
            mimeType: 'application/json',
          },
          {
            uri: 'studio://preview/active',
            name: 'Active Document Preview Image',
            description: 'Downsampled JPEG preview image (512px) of current canvas rendering.',
            mimeType: 'image/jpeg',
          },
        ],
      };
    });

    // 4. resources/read handler
    this.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const guide=guideResources(this.toolRegistry).find(resource=>resource.uri===uri);
      if(guide)return {contents:[{uri,mimeType:guide.mimeType,text:guide.text}]};

      if (uri === 'studio://document/active') {
        const doc = this.documentManager.getActiveDocument();
        if (!doc) {
          throw new McpError(ErrorCode.InvalidRequest, 'No document currently open in studio');
        }

        const data = {
          id: doc.id,
          name: doc.kind === 'develop' ? doc.fileName : doc.name,
          kind: doc.kind,
          width: doc.width,
          height: doc.height,
          isDirty: doc.isDirty,
          workspace: doc.kind,
        };

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      if (uri === 'studio://preview/active') {
        const doc = this.documentManager.getActiveDocument();
        if (!doc) throw new McpError(ErrorCode.InvalidRequest,'No document currently open in studio');
        const observation = await this.observationService.observe({documentId:doc.id,mode:'overview',maxDimension:512});
        this.rememberObservation(observation.evidence.observationId);
        return { contents:[{uri,mimeType:observation.image.mimeType,blob:observation.image.data}] };
      }

      if (uri.startsWith('studio://observation/')) {
        const id = uri.slice('studio://observation/'.length);
        const observation = this.observationService.get(id);
        if (!observation) throw new McpError(ErrorCode.InvalidRequest,'Observation is stale, unavailable, or evicted');
        return {contents:[{uri,mimeType:'application/json',text:JSON.stringify({evidence:observation.evidence})}]};
      }
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
    });
  }

  async connect(transport: any): Promise<void> {
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    this.candidateService.dispose();
    if(this.ownsObservationService) this.observationService.dispose();
    this.observationIds.clear();
    await this.server.close();
  }
}

export const defaultStudioMCPServer = new StudioMCPServer();
