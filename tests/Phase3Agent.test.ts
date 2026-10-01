// tests/Phase3Agent.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { defaultToolRegistry } from '../src/ai/tools/ToolRegistry';
import { OpenAISchemaAdapter } from '../src/ai/tools/schemaAdapters/OpenAISchemaAdapter';
import { ClaudeSchemaAdapter } from '../src/ai/tools/schemaAdapters/ClaudeSchemaAdapter';
import { GeminiSchemaAdapter } from '../src/ai/tools/schemaAdapters/GeminiSchemaAdapter';
import { Redactor } from '../src/ai/security/Redactor';
import { PermissionGuard } from '../src/ai/permissions/PermissionGuard';
import { AgentRuntime } from '../src/ai/runtime/AgentRuntime';
import { ProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import { IAIProvider } from '../src/ai/providers/IAIProvider';
import {
  AgentMessage,
  CanonicalToolSchema,
  ConnectionTestResult,
  ProviderCapabilities,
  ProviderConfig
} from '../src/ai/types';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { createEditDocument, createTextLayer } from '../src/document/EditDocument';
import { VisionInspector } from '../src/ai/vision/VisionInspector';

class MockAIProvider implements IAIProvider {
  constructor(public readonly config: ProviderConfig) {}

  readonly capabilities: ProviderCapabilities = {
    text: true,
    vision: true,
    toolCalling: true,
    streaming: true,
    imageGeneration: false,
    structuredOutput: true,
  };

  public mockResponses: AgentMessage[] = [];
  public recordedMessages: AgentMessage[][] = [];

  async chat(
    messages: AgentMessage[],
    _tools: CanonicalToolSchema[],
    onDelta?: (delta: string) => void,
    _signal?: AbortSignal
  ): Promise<AgentMessage> {
    this.recordedMessages.push([...messages]);
    const nextResponse = this.mockResponses.shift();
    if (!nextResponse) {
      return { role: 'assistant', content: 'Finished.' };
    }
    if (nextResponse.content && onDelta) {
      onDelta(nextResponse.content);
    }
    return nextResponse;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      success: true,
      latencyMs: 42,
      model: this.config.model,
      visionSupport: true,
      toolSupport: true,
    };
  }
}

describe('Phase 3: Studio AI Agent & Tool Execution Pipeline', () => {
  let docManager: DocumentManager;
  let commandBus: CommandBus;
  let permissionGuard: PermissionGuard;
  let mockProvider: MockAIProvider;
  let providerRegistry: ProviderRegistry;
  let runtime: AgentRuntime;

  beforeEach(() => {
    docManager = new DocumentManager();
    commandBus = new CommandBus(docManager);
    permissionGuard = new PermissionGuard();

    mockProvider = new MockAIProvider({
      id: 'mock-provider',
      name: 'Mock Provider',
      type: 'openai',
      baseUrl: 'http://localhost/mock',
      model: 'mock-model',
      enabled: true,
      isDefault: true,
    });

    providerRegistry = new ProviderRegistry();
    // Override getProvider to return mock
    providerRegistry.getProvider = () => mockProvider;

    runtime = new AgentRuntime(
      providerRegistry,
      defaultToolRegistry,
      permissionGuard,
      new VisionInspector(),
      commandBus,
      docManager
    );
  });

  describe('1. Canonical Tool Registry & Workspace Isolation', () => {
    it('registers all required Develop, Edit, and System tools', () => {
      const allTools = defaultToolRegistry.getAll();
      expect(allTools.length).toBeGreaterThanOrEqual(23);

      expect(defaultToolRegistry.get('develop_set_exposure')).toBeDefined();
      expect(defaultToolRegistry.get('develop_set_contrast')).toBeDefined();
      expect(defaultToolRegistry.get('develop_set_temperature')).toBeDefined();
      expect(defaultToolRegistry.get('develop_set_tint')).toBeDefined();
      expect(defaultToolRegistry.get('develop_set_saturation')).toBeDefined();
      expect(defaultToolRegistry.get('develop_set_highlights')).toBeDefined();
      expect(defaultToolRegistry.get('develop_set_shadows')).toBeDefined();
      expect(defaultToolRegistry.get('develop_reset_settings')).toBeDefined();
      expect(defaultToolRegistry.get('get_develop_settings')).toBeDefined();
      expect(defaultToolRegistry.get('get_histogram')).toBeDefined();

      expect(defaultToolRegistry.get('get_edit_document')).toBeDefined();
      expect(defaultToolRegistry.get('edit_create_text_layer')).toBeDefined();
      expect(defaultToolRegistry.get('edit_create_image_layer')).toBeDefined();
      expect(defaultToolRegistry.get('edit_delete_layer')).toBeDefined();
      expect(defaultToolRegistry.get('edit_rename_layer')).toBeDefined();
      expect(defaultToolRegistry.get('edit_set_layer_opacity')).toBeDefined();
      expect(defaultToolRegistry.get('edit_set_blend_mode')).toBeDefined();
      expect(defaultToolRegistry.get('edit_set_visibility')).toBeDefined();
      expect(defaultToolRegistry.get('edit_move_layer_order')).toBeDefined();

      expect(defaultToolRegistry.get('system_undo')).toBeDefined();
      expect(defaultToolRegistry.get('system_redo')).toBeDefined();
      expect(defaultToolRegistry.get('get_workspace')).toBeDefined();
      expect(defaultToolRegistry.get('get_active_document')).toBeDefined();
    });

    it('enforces workspace isolation for tool schemas', () => {
      const developTools = defaultToolRegistry.getForWorkspace('develop');
      const editTools = defaultToolRegistry.getForWorkspace('edit');

      expect(developTools.some((t) => t.schema.name === 'develop_set_exposure')).toBe(true);
      expect(developTools.some((t) => t.schema.name === 'edit_create_text_layer')).toBe(false);

      expect(editTools.some((t) => t.schema.name === 'edit_create_text_layer')).toBe(true);
      expect(editTools.some((t) => t.schema.name === 'develop_set_exposure')).toBe(false);

      // System tools are 'any' workspace, available to both
      expect(developTools.some((t) => t.schema.name === 'system_undo')).toBe(true);
      expect(editTools.some((t) => t.schema.name === 'system_undo')).toBe(true);
    });
  });

  describe('2. Schema Adapters (OpenAI, Claude, Gemini)', () => {
    it('adapts canonical tool schema to OpenAI function tool format', () => {
      const schema = defaultToolRegistry.get('develop_set_exposure')!.schema;
      const adapted = OpenAISchemaAdapter.adapt(schema);

      expect(adapted.type).toBe('function');
      expect(adapted.function.name).toBe('develop_set_exposure');
      expect(adapted.function.description).toContain('exposure');
      expect(adapted.function.parameters.properties.exposure).toBeDefined();
    });

    it('adapts canonical tool schema to Anthropic Claude tool format', () => {
      const schema = defaultToolRegistry.get('edit_create_text_layer')!.schema;
      const adapted = ClaudeSchemaAdapter.adapt(schema);

      expect(adapted.name).toBe('edit_create_text_layer');
      expect(adapted.input_schema.type).toBe('object');
      expect(adapted.input_schema.properties.text).toBeDefined();
    });

    it('adapts canonical tool schema to Google Gemini function declaration format', () => {
      const schema = defaultToolRegistry.get('develop_set_temperature')!.schema;
      const adapted = GeminiSchemaAdapter.adapt(schema);

      expect(adapted.name).toBe('develop_set_temperature');
      expect(adapted.parameters.type).toBe('OBJECT');
      expect(adapted.parameters.properties.temperature).toBeDefined();
    });
  });

  describe('3. Security & Secret Redaction', () => {
    it('redacts sensitive API keys and Bearer tokens from strings and error messages', () => {
      const input = 'Failed with sk-1234567890abcdefghijklmnopqrstuvwxyz and Bearer secret_token_1234567890';
      const redacted = Redactor.redact(input);

      expect(redacted).not.toContain('sk-1234567890abcdefghijklmnopqrstuvwxyz');
      expect(redacted).not.toContain('secret_token_1234567890');
      expect(redacted).toContain('sk-12*****');
      expect(redacted).toContain('Bearer secr*****');
    });

    it('redacts Google Gemini API keys', () => {
      const input = 'Request to https://generativelanguage.googleapis.com?key=AIzaSyB123456789012345678901234567890 failed';
      const redacted = Redactor.redact(input);

      expect(redacted).not.toContain('AIzaSyB123456789012345678901234567890');
      expect(redacted).toContain('AIza*****');
    });

    it('deeply redacts secrets in objects', () => {
      const payload = {
        name: 'test',
        apiKey: 'sk-abcdef12345678901234567890',
        headers: {
          authorization: 'Bearer my_secret_token_value_xyz',
        },
      };

      const sanitized = Redactor.redactObject(payload);
      expect(sanitized.apiKey).toContain('sk-ab*****');
    });
  });

  describe('4. Permission Guard', () => {
    it('allows normal tools in auto mode without asking', async () => {
      permissionGuard.setLevel('auto');
      const tool = defaultToolRegistry.get('develop_set_exposure')!;
      const allowed = await permissionGuard.checkPermission(tool, { exposure: 0.5 });
      expect(allowed).toBe(true);
    });

    it('requires confirmation in ask mode for normal tools', async () => {
      permissionGuard.setLevel('ask');
      let handlerCalled = false;

      permissionGuard.setConfirmationHandler(async () => {
        handlerCalled = true;
        return true;
      });

      const tool = defaultToolRegistry.get('develop_set_exposure')!;
      const allowed = await permissionGuard.checkPermission(tool, { exposure: 0.5 });

      expect(handlerCalled).toBe(true);
      expect(allowed).toBe(true);
    });

    it('denies tool execution when user rejects confirmation in ask mode', async () => {
      permissionGuard.setLevel('ask');
      permissionGuard.setConfirmationHandler(async () => false); // User clicked Deny

      const tool = defaultToolRegistry.get('develop_set_exposure')!;
      const allowed = await permissionGuard.checkPermission(tool, { exposure: 0.5 });

      expect(allowed).toBe(false);
    });

    it('always requires confirmation for dangerous tools regardless of mode', async () => {
      permissionGuard.setLevel('full');
      let dangerousAsked = false;

      permissionGuard.setConfirmationHandler(async () => {
        dangerousAsked = true;
        return false;
      });

      const dangerousTool = defaultToolRegistry.get('develop_reset_settings')!;
      const allowed = await permissionGuard.checkPermission(dangerousTool, {});

      expect(dangerousAsked).toBe(true);
      expect(allowed).toBe(false);
    });
  });

  describe('5. Agent Execution Loop & Tool Execution', () => {
    it('executes develop tool via CommandBus and updates document non-destructively', async () => {
      const doc = createDevelopDocument({
        fileName: 'test_photo.CR3',
        sourceUri: 'photos/test_photo.CR3',
        fileSizeBytes: 20000000,
        isRaw: true,
      });
      docManager.openDocument(doc, true);

      // Step 1: Assistant requests tool call
      mockProvider.mockResponses.push({
        role: 'assistant',
        content: 'I will increase exposure by +0.8 EV for you.',
        toolCalls: [
          {
            id: 'call_1',
            name: 'develop_set_exposure',
            arguments: { exposure: 0.8 },
          },
        ],
      });

      // Step 2: Assistant finishes after seeing tool result
      mockProvider.mockResponses.push({
        role: 'assistant',
        content: 'Exposure successfully set to +0.8 EV.',
      });

      const run = await runtime.run('Make the image brighter', { includeVision: false });

      expect(run.status).toBe('partial');
      expect(run.verification?.pending.length).toBeGreaterThan(0);
      expect(run.actions.length).toBe(1);
      expect(run.actions[0].toolName).toBe('develop_set_exposure');
      expect(run.actions[0].status).toBe('success');

      // Verify real document state updated through CommandBus
      const updatedDoc = docManager.getDevelopDocument(doc.id);
      expect(updatedDoc?.settings.exposure).toBe(0.8);
      expect(commandBus.canUndo()).toBe(true);
    });

    it('executes edit tool to create layer in Edit Workspace', async () => {
      const editDoc = createEditDocument({
        name: 'poster.aistudio',
        width: 1920,
        height: 1080,
      });
      docManager.openDocument(editDoc, true);

      mockProvider.mockResponses.push({
        role: 'assistant',
        toolCalls: [
          {
            id: 'call_text',
            name: 'edit_create_text_layer',
            arguments: { text: 'Studio AI', fontSize: 64, color: '#ffffff' },
          },
        ],
      });

      mockProvider.mockResponses.push({
        role: 'assistant',
        content: 'Created text layer "Studio AI".',
      });

      const run = await runtime.run('Add text title "Studio AI"', { includeVision: false });

      expect(run.status).toBe('partial');
      expect(run.verification?.pending.length).toBeGreaterThan(0);
      expect(run.actions.length).toBe(1);
      expect(run.actions[0].toolName).toBe('edit_create_text_layer');
      expect(run.actions[0].status).toBe('success');

      const updatedDoc = docManager.getEditDocument(editDoc.id);
      expect(updatedDoc?.layers.length).toBe(1);
      expect((updatedDoc?.layers[0] as any).text).toBe('Studio AI');
    });

    it('handles tool execution errors gracefully and reports to LLM without crashing', async () => {
      // Intentionally do NOT open any document
      mockProvider.mockResponses.push({
        role: 'assistant',
        toolCalls: [
          {
            id: 'call_err',
            name: 'develop_set_exposure',
            arguments: { exposure: 1.0 },
          },
        ],
      });

      mockProvider.mockResponses.push({
        role: 'assistant',
        content: 'I noticed no document is open. Please open a document first.',
      });

      const run = await runtime.run('Set exposure to +1.0 EV');

      expect(run.status).toBe('partial');
      expect(run.verification?.pending.length).toBeGreaterThan(0);
      expect(run.actions.length).toBe(1);
      expect(run.actions[0].status).toBe('failed');
      expect(run.actions[0].result?.error?.code).toBe('NO_DOCUMENT');
    });
  });

  describe('6. Agent Run Transactions & Undo AI Run', () => {
    it('groups multiple tool commands in a run and can undo the entire run at once', async () => {
      const doc = createDevelopDocument({
        fileName: 'landscape.arw',
        sourceUri: 'photos/landscape.arw',
        fileSizeBytes: 30000000,
        isRaw: true,
      });
      docManager.openDocument(doc, true);

      // LLM performs two tool actions in one run: exposure and contrast
      mockProvider.mockResponses.push({
        role: 'assistant',
        toolCalls: [
          {
            id: 'call_exp',
            name: 'develop_set_exposure',
            arguments: { exposure: 1.2 },
          },
          {
            id: 'call_contrast',
            name: 'develop_set_contrast',
            arguments: { contrast: 25 },
          },
        ],
      });

      mockProvider.mockResponses.push({
        role: 'assistant',
        content: 'Adjusted exposure and contrast.',
      });

      const run = await runtime.run('Brighten and punch up contrast', { includeVision: false });

      expect(run.status).toBe('partial');
      expect(run.verification?.pending.length).toBeGreaterThan(0);
      expect(run.actions.length).toBe(2);

      const devDoc = docManager.getDevelopDocument(doc.id)!;
      expect(devDoc.settings.exposure).toBe(1.2);
      expect(devDoc.settings.contrast).toBe(25);

      // Now invoke Undo Run
      const undoSuccess = runtime.undoRun(run.runId);
      expect(undoSuccess).toBe(true);

      // Re-fetch document from manager to observe rolled back state
      const rolledBackDoc = docManager.getDevelopDocument(doc.id)!;
      expect(rolledBackDoc.settings.exposure).toBe(0.0);
      expect(rolledBackDoc.settings.contrast).toBe(0);
    });
  });

  describe('7. Vision Inspector Payload', () => {
    it('captures active document metadata and downsamples canvas', () => {
      const doc = createDevelopDocument({
        fileName: 'raw_shoot.dng',
        sourceUri: 'photos/raw_shoot.dng',
        fileSizeBytes: 25000000,
        isRaw: true,
      });
      docManager.openDocument(doc, true);

      const inspector = new VisionInspector();
      const snapshot = inspector.captureSnapshot(docManager, false);

      expect(snapshot.metadata?.id).toBe(doc.id);
      expect(snapshot.metadata?.name).toBe('raw_shoot.dng');
      expect(snapshot.metadata?.kind).toBe('develop');
    });
  });
});
