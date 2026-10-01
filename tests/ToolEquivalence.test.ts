import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { AssetManager } from '../src/assets/AssetManager';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { createEditDocument } from '../src/document/EditDocument';
import { SetExposureCommand } from '../src/commands/develop/SetExposureCommand';
import { SetExposureTool } from '../src/tools/develop/SetExposureTool';
import { CreateTextLayerTool } from '../src/tools/edit/CreateLayerTool';
import { AgentExecutionContext } from '../src/types/agent';

describe('Tool & UI Equivalence (Rule 9)', () => {
  let docManager: DocumentManager;
  let commandBus: CommandBus;
  let assetManager: AssetManager;
  let developDocId: string;
  let editDocId: string;
  let agentContext: AgentExecutionContext;

  beforeEach(() => {
    docManager = new DocumentManager();
    commandBus = new CommandBus(docManager);
    assetManager = new AssetManager();

    const devDoc = createDevelopDocument({
      sourceUri: 'photos/landscape.arw',
      fileName: 'landscape.arw',
      isRaw: true,
      settings: { exposure: 0.0 },
    });
    docManager.openDocument(devDoc);
    developDocId = devDoc.id;

    const editDoc = createEditDocument({ name: 'Poster.psd' });
    docManager.openDocument(editDoc, false);
    editDocId = editDoc.id;

    agentContext = {
      commandBus,
      documentManager: docManager,
      assetManager,
      activeDocumentId: developDocId,
    };
  });

  it('5. Agent Tool and UI dispatch yield identical state and history behavior', async () => {
    // 1. UI user sets exposure to +0.50
    const uiCmd = new SetExposureCommand(developDocId, 0.50, docManager);
    commandBus.execute(uiCmd);
    expect(docManager.getDevelopDocument(developDocId)?.settings.exposure).toBe(0.50);

    // Undo UI command
    commandBus.undo();
    expect(docManager.getDevelopDocument(developDocId)?.settings.exposure).toBe(0.0);

    // 2. Agent calls Tool with { exposure: 0.50 }
    const tool = new SetExposureTool();
    await tool.execute({ exposure: 0.50 }, agentContext);

    // Document state is identical!
    expect(docManager.getDevelopDocument(developDocId)?.settings.exposure).toBe(0.50);

    // History has recorded the tool action
    expect(commandBus.getHistory().length).toBe(1);
    expect(commandBus.getHistory()[0].name).toContain('Set Exposure (+0.50 EV)');

    // Undo works identically!
    commandBus.undo();
    expect(docManager.getDevelopDocument(developDocId)?.settings.exposure).toBe(0.0);
  });

  it('Agent Tool creates layer in Edit Workspace via CommandBus', async () => {
    agentContext.activeDocumentId = editDocId;
    const textTool = new CreateTextLayerTool();

    await textTool.execute({ text: 'Tokyo Night', fontSize: 64 }, agentContext);

    const editDoc = docManager.getEditDocument(editDocId);
    expect(editDoc?.layers.length).toBe(1);
    expect(editDoc?.layers[0].type).toBe('text');
    expect((editDoc?.layers[0] as any).text).toBe('Tokyo Night');

    // Undo removes layer
    commandBus.undo();
    expect(docManager.getEditDocument(editDocId)?.layers.length).toBe(0);
  });
});
