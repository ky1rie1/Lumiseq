import { expect, it } from 'vitest';
import { StudioMCPServer } from './StudioMCPServer';
import { ToolRegistry } from '../tools/ToolRegistry';
import { PermissionGuard } from '../permissions/PermissionGuard';
import { DocumentManager } from '../../document/DocumentManager';
import { createEditDocument } from '../../document/EditDocument';
import { CommandBus } from '../../history/CommandBus';
import { TastePreferences } from '../harness/TastePreferences';
import { CandidateService } from '../harness/CandidateService';
import { DocumentObservationService } from '../vision/DocumentObservationService';

it('saves MCP preferences only after a real user confirmation and shares the explicit preference store', async () => {
  const documents = new DocumentManager(); documents.openDocument(createEditDocument({ id: 'doc' }));
  const preferences = new TastePreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const guard = new PermissionGuard();
  const server = new StudioMCPServer(new ToolRegistry(), guard, documents, new CommandBus(documents), undefined, { permissionLevel: 'full', tastePreferences: preferences });
  const request = { method: 'tools/call', params: { name: 'studio_save_taste_preference', arguments: { domain: 'photo', text: 'Natural skin', userApproved: true } } };
  expect((await server.dispatch(request)).isError).toBe(true);
  guard.setConfirmationHandler(async () => true);
  expect((await server.dispatch(request)).isError).not.toBe(true);
  expect(preferences.get('photo').map(item => item.text)).toEqual(['Natural skin']);
  await server.close();
});

it('returns real bounded original and candidate images to external agents', async () => {
  const documents = new DocumentManager(); documents.openDocument(createEditDocument({ id: 'doc' }));
  const bus = new CommandBus(documents), registry = new ToolRegistry();
  const renderer: import('../vision/observationTypes').DocumentObservationRenderPort = { async render(_doc, geometry) {
    return { data: 'cGljdHVyZQ==', mimeType: geometry.mimeType, approximate: false };
  } };
  const observationService = new DocumentObservationService({ documents, renderer });
  const candidateService = new CandidateService({ documents, commandBus: bus, toolRegistry: registry, observationService, previewRenderer: renderer });
  const server = new StudioMCPServer(registry, new PermissionGuard(), documents, bus, undefined, { observationService, candidateService });
  const response = await server.dispatch({ method: 'tools/call', params: { name: 'studio_create_candidates', arguments: {
    runId: 'mcp', prompt: 'Add headline "Exact copy"', plans: [{ label: 'A', reason: 'Simple title', operations: [{ name: 'edit_create_text_layer', args: { text: 'Exact copy' } }] }],
  } } });
  expect(response.isError).not.toBe(true);
  expect(response.content.filter((item: { type: string }) => item.type === 'image')).toHaveLength(2);
  expect(response.content[0].text).not.toContain('base64');
  expect(bus.getHistory()).toEqual([]);
  await server.close(); observationService.dispose();
});
