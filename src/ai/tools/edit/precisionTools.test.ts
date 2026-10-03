import { expect, it } from 'vitest';
import { UpgradeEditPrecisionTool, RawSmartObjectTool } from './precisionTools';
import { DocumentManager } from '../../../document/DocumentManager';
import { CommandBus } from '../../../history/CommandBus';
import { createEditDocument } from '../../../document/EditDocument';
import { createDevelopDocument } from '../../../document/DevelopDocument';
import { DocumentOperationService } from '../../../app/DocumentOperationService';
import { AssetManager } from '../../../assets/AssetManager';
import { RawSmartObjectService } from '../../../smartobject/RawSmartObjectService';
import type { IToolContext } from '../CanonicalTool';

function setup() {
  const documentManager = new DocumentManager(), commandBus = new CommandBus(documentManager);
  const doc = createEditDocument({ name: 'Original', width: 16, height: 16 });
  documentManager.openDocument(doc);
  const workspaces: string[] = [];
  const activate = () => new DocumentOperationService(documentManager, { activate: () => {}, workspace: kind => workspaces.push(kind), status: () => {} });
  const context = { documentManager, commandBus, currentWorkspace: 'edit' as 'edit' | 'develop', visionSnapshot: { stale: true } as any };
  return { doc, context, workspaces, activate };
}
it('activates the upgraded copy through shared document operations and returns its undo command', async () => {
  const c = setup(), result = await new UpgradeEditPrecisionTool(c.activate).execute(c.context, {}, 'upgrade');
  expect(result.success).toBe(true);expect(result.changedDocumentId).toBe(c.context.documentManager.getActiveDocument()?.id);
  expect(result.commandId).toBe(c.context.commandBus.getHistory()[0].command.id);
  expect(c.workspaces).toEqual(['edit']);expect(c.context.visionSnapshot).toBeUndefined();
  expect(c.context.documentManager.getEditDocument(c.doc.id)?.renderingVersion).not.toBe(2);
});
it.each(['open', 'apply'])('refreshes workspace and transition metadata for RAW %s', async action => {
  const c = setup(), target = action === 'open' ? createDevelopDocument({ sourceUri: 'x.arw', fileName: 'RAW', isRaw: true }) : createEditDocument({ name: 'Target', width: 16, height: 16, renderingVersion: 2 });
  c.context.documentManager.openDocument(target, false);
  const tool = new RawSmartObjectTool(() => ({ openRecipe: async () => target as any, applyRecipe: async () => target.id }), c.activate);
  const result = await tool.execute(c.context, { action, documentId: c.doc.id, layerId: 'raw' }, action);
  expect(result.success).toBe(true);expect(result.changedDocumentId).toBe(target.id);
  expect(c.context.currentWorkspace).toBe(target.kind);expect(c.workspaces).toEqual([target.kind]);expect(c.context.visionSnapshot).toBeUndefined();
});
it('does not begin a cancelled precision operation', async () => {
  const c = setup(), controller = new AbortController();controller.abort();
  const result = await new UpgradeEditPrecisionTool(c.activate).execute({ ...c.context, signal: controller.signal }, {}, 'cancel');
  expect(result.success).toBe(false);expect(c.context.commandBus.getHistory()).toHaveLength(0);expect(c.workspaces).toEqual([]);
});
it('cancels a queued precision command promptly and guards its later execution', async () => {
  const c = setup(), controller = new AbortController();let command: any, finish!: () => void;
  c.context.commandBus.execute = cmd => { command = cmd;return new Promise<void>(resolve => { finish = resolve; }); };
  const pending = new UpgradeEditPrecisionTool(c.activate).execute({ ...c.context, signal: controller.signal }, {}, 'queued');
  controller.abort();const result = await pending;
  expect(result.success).toBe(false);expect(() => command.execute()).toThrow();finish();
  expect(c.context.documentManager.getActiveDocument()?.id).toBe(c.doc.id);expect(c.workspaces).toEqual([]);
});
it('returns the actual RAW apply command ID through the caller command bus', async () => {
  const c=setup(), assets=new AssetManager(), handle=await assets.registerBlob(new Blob(['raw']), 'image', 'source.arw');
  const raw=createDevelopDocument({sourceUri:'source.arw',fileName:'RAW',isRaw:true});raw.rawState='ready';raw.nativeAssetId='native';raw.originalRawAssetId=handle.id;
  c.context.documentManager.openDocument(raw);
  const factory=(context:IToolContext)=>new RawSmartObjectService(context.documentManager,context.commandBus,assets,{read:async()=>new Uint8Array(),stage:async()=> 'staged.raw',remove:async()=>{}});
  const service=factory(c.context), edit=await service.transfer(raw.id), variant=await service.openRecipe(edit.id,edit.layers[0].id);
  variant.settings.exposure=1;c.context.documentManager.updateDocument(variant);c.context.currentWorkspace='develop';
  const result=await new RawSmartObjectTool(factory,c.activate).execute(c.context,{action:'apply',documentId:variant.id},'apply');
  expect(result.success).toBe(true);expect(result.commandId).toBe(c.context.commandBus.getHistory()[0].command.id);
  expect(result.changedDocumentId).toBe(edit.id);expect(c.context.currentWorkspace).toBe('edit');
});
