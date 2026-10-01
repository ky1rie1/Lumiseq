import { expect, it } from 'vitest';
import { ToolRegistry } from './ToolRegistry';
import { DocumentManager } from '../../document/DocumentManager';
import { createEditDocument } from '../../document/EditDocument';
import { CommandBus } from '../../history/CommandBus';
import { TastePreferences } from '../harness/TastePreferences';
import type { IToolContext } from './CanonicalTool';

it('exposes real creative brief and preference capabilities without treating model flags as consent', async () => {
  const documents = new DocumentManager();
  documents.openDocument(createEditDocument({ id: 'layout', layers: [] }));
  const registry = new ToolRegistry();
  const preferences = new TastePreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const context: IToolContext = { documentManager: documents, commandBus: new CommandBus(documents), currentWorkspace: 'edit', tastePreferences: preferences };
  const brief = await registry.get('studio_build_creative_brief')!.execute(context, { prompt: 'Keep skin natural', taskKind: 'photo' }, 'brief');
  expect(brief.data.domain).toBe('photo');
  expect(brief.data.photo.skin).toBe('natural');
  const denied = await registry.get('studio_save_taste_preference')!.execute(context, { domain: 'photo', text: 'Natural skin', userConfirmed: true }, 'model');
  expect(denied.success).toBe(false);
  expect(preferences.get('photo')).toEqual([]);
  const saved = await registry.get('studio_save_taste_preference')!.execute({ ...context, userApproved: true }, { domain: 'photo', text: 'Natural skin' }, 'user');
  expect(saved.success).toBe(true);
  expect(preferences.get('photo').map(item => item.text)).toEqual(['Natural skin']);
  expect(context.commandBus.getHistory()).toEqual([]);
});

it('lists candidate tools for MCP and requires an actual user approval before selection', async () => {
  const registry = new ToolRegistry();
  const names = registry.getMCPSchemas().map(schema => schema.name);
  expect(names).toContain('studio_create_candidates');
  expect(names).toContain('studio_choose_candidate');
  const documents = new DocumentManager();
  documents.openDocument(createEditDocument({ id: 'layout', layers: [] }));
  const context: IToolContext = { documentManager: documents, commandBus: new CommandBus(documents), currentWorkspace: 'edit' };
  const denied = await registry.get('studio_choose_candidate')!.execute(context, { candidateId: 'arbitrary', userConfirmed: true }, 'model');
  expect(denied.success).toBe(false);
});
