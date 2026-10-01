// tests/Phase5MCPServer.test.ts
//! Comprehensive Test Suite for Phase 5 Studio MCP Server & External Agent Tool Bridge
//! Verifies:
//! 1. Official MCP protocol tool schemas & naming adaptation (studio_*)
//! 2. tools/list and tools/call dispatching
//! 3. External Agent calls strictly routing through CanonicalTool -> Command -> CommandBus -> Document
//! 4. Undo / Redo equivalence between UI, internal agent, and external MCP agent
//! 5. Permission Enforcement (Read-Only blocks mutations)
//! 6. Resource discovery & downsampled preview protection

import { describe, it, expect, beforeEach } from 'vitest';
import { StudioMCPServer } from '../src/ai/mcp/StudioMCPServer';
import { defaultToolRegistry } from '../src/ai/tools/ToolRegistry';
import { MCPSchemaAdapter } from '../src/ai/tools/schemaAdapters/MCPSchemaAdapter';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultCommandBus } from '../src/history/CommandBus';
import { defaultPermissionGuard } from '../src/ai/permissions/PermissionGuard';
import { defaultVisionInspector } from '../src/ai/vision/VisionInspector';
import { DevelopDocument } from '../src/types/develop';
import { EditDocument } from '../src/types/edit';
import { APP_NAME } from '../src/core/brand';

describe('Phase 5 — Studio MCP Server & External Agent Bridge', () => {
  let mcpServer: StudioMCPServer;

  beforeEach(() => {
    defaultCommandBus.clear();
    defaultDocumentManager.closeAll();
    defaultPermissionGuard.setLevel('full'); // Allow full execution in automated test
    mcpServer = new StudioMCPServer(
      defaultToolRegistry,
      defaultPermissionGuard,
      defaultDocumentManager,
      defaultCommandBus,
      defaultVisionInspector,
      { permissionLevel: 'full' }
    );
  });

  it('1. adapts Canonical Tool Schemas to official MCP tool definitions', () => {
    const mcpSchemas = defaultToolRegistry.getMCPSchemas();
    expect(mcpSchemas.length).toBeGreaterThan(15);

    const exposureTool = mcpSchemas.find((s) => s.name === 'studio_set_exposure');
    expect(exposureTool).toBeDefined();
    expect(exposureTool?.description).toContain('exposure');
    expect(exposureTool?.inputSchema.properties).toHaveProperty('value');

    // Reverse mapping
    const canonicalName = MCPSchemaAdapter.mcpToCanonicalName('studio_set_exposure');
    expect(canonicalName).toBe('set_exposure');

    const capabilitiesTool = mcpSchemas.find((s) => s.name === 'studio_get_capabilities');
    expect(capabilitiesTool).toBeDefined();
  });

  it('2. executes tools/list and returns studio capabilities via MCP', async () => {
    const serverInstance = mcpServer.getServer();
    const handler = (serverInstance as any)._requestHandlers.get('tools/list');
    expect(handler).toBeDefined();

    const result = await handler({ method: 'tools/list', params: {} });
    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThan(15);

    const names = result.tools.map((t: any) => t.name);
    expect(names).toContain('studio_get_capabilities');
    expect(names).toContain('studio_get_workspace');
    expect(names).toContain('studio_get_active_document');
    expect(names).toContain('studio_get_document_context');
    expect(names).toContain('studio_set_exposure');
    expect(names).toContain('studio_develop_set_parameter');
    expect(names).toContain('studio_get_develop_parameter_specs');
    expect(names).toContain('studio_create_text_layer');
    expect(names).toContain('studio_undo');
    expect(names).toContain('studio_redo');
  });

  it('exposes exact develop parameter limits through the shared MCP tool path', async () => {
    const serverInstance = mcpServer.getServer();
    const callHandler = (serverInstance as any)._requestHandlers.get('tools/call');
    const result = await callHandler({
      method: 'tools/call',
      params: {
        name: 'studio_get_develop_parameter_specs',
        arguments: { parameterIds: ['exposure', 'temperature'] },
      },
    });

    expect(result.isError).toBeFalsy();
    const specs = JSON.parse(result.content[0].text);
    expect(specs.exposure).toMatchObject({ min: -5, max: 5 });
    expect(specs.temperature.min).toBeLessThan(specs.temperature.max);
    expect(Object.keys(specs)).toEqual(['exposure', 'temperature']);
  });

  it('3. routes external MCP tool calls strictly through CanonicalTool -> Command -> CommandBus', async () => {
    // 1. Create active develop document
    const devDoc: DevelopDocument = {
      id: 'doc_mcp_test',
      kind: 'develop',
      isRaw: true,
      sourceAssetId: 'asset_mcp_raw',
      fileName: 'test_photo.cr3',
      fileSize: 25000000,
      width: 4000,
      height: 3000,
      settings: {
        exposure: 0.0,
        contrast: 0.0,
        highlights: 0.0,
        shadows: 0.0,
        temperature: 5500,
        tint: 0.0,
        saturation: 0.0,
        clarity: 0.0,
        sharpness: 40.0,
        vibrance: 0.0,
      },
      isDirty: false,
      historyIndex: 0,
      updatedAt: Date.now(),
    };
    defaultDocumentManager.openDocument(devDoc);

    const serverInstance = mcpServer.getServer();
    const callHandler = (serverInstance as any)._requestHandlers.get('tools/call');

    // 2. Execute studio_set_exposure via MCP
    const callResult = await callHandler({
      method: 'tools/call',
      params: {
        name: 'studio_set_exposure',
        arguments: { value: 1.5 },
      },
    });

    expect(callResult.isError).toBeFalsy();
    const updatedDoc = defaultDocumentManager.getDevelopDocument('doc_mcp_test')!;
    expect(updatedDoc.settings.exposure).toBe(1.5);
    expect(defaultCommandBus.canUndo()).toBe(true);

    // 3. Execute studio_undo via MCP
    const undoResult = await callHandler({
      method: 'tools/call',
      params: {
        name: 'studio_undo',
        arguments: {},
      },
    });

    expect(undoResult.isError).toBeFalsy();
    const undoneDoc = defaultDocumentManager.getDevelopDocument('doc_mcp_test')!;
    expect(undoneDoc.settings.exposure).toBe(0.0);
    expect(defaultCommandBus.canRedo()).toBe(true);

    // 4. Execute studio_redo via MCP
    await callHandler({
      method: 'tools/call',
      params: {
        name: 'studio_redo',
        arguments: {},
      },
    });

    const redoneDoc = defaultDocumentManager.getDevelopDocument('doc_mcp_test')!;
    expect(redoneDoc.settings.exposure).toBe(1.5);
  });

  it('4. blocks mutation commands when MCP Server is in Read-Only mode', async () => {
    mcpServer.setPermissionLevel('readonly');

    const devDoc: DevelopDocument = {
      id: 'doc_readonly_test',
      kind: 'develop',
      isRaw: true,
      sourceAssetId: 'asset_readonly_raw',
      fileName: 'readonly.dng',
      fileSize: 18000000,
      width: 4000,
      height: 3000,
      settings: { exposure: 0.0 } as any,
      isDirty: false,
      historyIndex: 0,
      updatedAt: Date.now(),
    };
    defaultDocumentManager.openDocument(devDoc);

    const serverInstance = mcpServer.getServer();
    const callHandler = (serverInstance as any)._requestHandlers.get('tools/call');

    // Mutation tool should be blocked
    const mutateResult = await callHandler({
      method: 'tools/call',
      params: {
        name: 'studio_set_exposure',
        arguments: { value: 2.0 },
      },
    });

    expect(mutateResult.isError).toBe(true);
    expect(mutateResult.content[0].text).toContain('Read-Only mode');
    expect(devDoc.settings.exposure).toBe(0.0);

    // Safe inspection tool should still succeed
    const inspectResult = await callHandler({
      method: 'tools/call',
      params: {
        name: 'studio_get_capabilities',
        arguments: {},
      },
    });

    expect(inspectResult.isError).toBeFalsy();
    // The tool reports the shared brand name, so this cannot drift from src/core/brand.ts again.
    expect(inspectResult.content[0].text).toContain(APP_NAME);
  });

  it('5. provides studio://document/active resource', async () => {
    const editDoc: EditDocument = {
      id: 'doc_edit_mcp',
      kind: 'edit',
      name: 'Layer Composite',
      width: 1920,
      height: 1080,
      layers: [],
      selectedLayerId: null,
      zoom: 1.0,
      pan: { x: 0, y: 0 },
      isDirty: false,
      historyIndex: 0,
      updatedAt: Date.now(),
    };
    defaultDocumentManager.openDocument(editDoc);

    const serverInstance = mcpServer.getServer();
    const readHandler = (serverInstance as any)._requestHandlers.get('resources/read');

    const res = await readHandler({
      method: 'resources/read',
      params: {
        uri: 'studio://document/active',
      },
    });

    expect(res.contents).toBeDefined();
    expect(res.contents[0].uri).toBe('studio://document/active');
    const parsed = JSON.parse(res.contents[0].text);
    expect(parsed.id).toBe('doc_edit_mcp');
    expect(parsed.name).toBe('Layer Composite');
    expect(parsed.width).toBe(1920);
  });
});
