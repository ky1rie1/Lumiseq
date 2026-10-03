import { CanonicalTool, type IToolContext } from '../CanonicalTool';
import type { CanonicalToolSchema, ToolResult } from '../../types';
import { UpgradeEditPrecisionCommand } from '../../../edit/upgradeEditPrecision';
import { RawSmartObjectService } from '../../../smartobject/RawSmartObjectService';
import { defaultAssetManager } from '../../../assets/AssetManager';
import { getPlatformBridge } from '../../../platform';
import { createDocumentOperations, type DocumentOperationService } from '../../../app/DocumentOperationService';

type ActivationFactory = (manager: IToolContext['documentManager']) => Pick<DocumentOperationService, 'activate'>;
type RawServiceFactory = (context: IToolContext) => Pick<RawSmartObjectService, 'openRecipe' | 'applyRecipe'>;
function checkCancellation(context: IToolContext): void {
  if (context.signal?.aborted) throw new DOMException('Operation cancelled', 'AbortError');
}
function failed(context: IToolContext, toolCallId: string, error: unknown): ToolResult {
  const message = String(error);
  const stale = context.signal?.aborted || /AbortError|document changed|已改变|已关闭/.test(message);
  return { success: false, toolCallId, renderRequired: false, error: { code: stale ? 'STALE_SOURCE' : 'INVALID_ARGUMENT', message } };
}
function waitForCommand(promise: void | Promise<void>, context: IToolContext): Promise<void> {
  if (!context.signal) return Promise.resolve(promise);
  const signal = context.signal;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort);reject(new DOMException('Operation cancelled', 'AbortError')); };
    if (signal.aborted) abort();else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(() => { signal.removeEventListener('abort', abort);resolve(); }, error => { signal.removeEventListener('abort', abort);reject(error); });
  });
}
function activateResult(context: IToolContext, id: string, factory: ActivationFactory): void {
  checkCancellation(context);
  const doc = factory(context.documentManager).activate(id);
  context.currentWorkspace = doc.kind;
  context.visionSnapshot = undefined;
}
const createRawService: RawServiceFactory = context => {
  const platform = getPlatformBridge();
  return new RawSmartObjectService(context.documentManager, context.commandBus, defaultAssetManager, {
    read: path => platform.readBinaryFile(path),
    stage: (name, blob) => { if (!platform.stageRawSource) throw new Error('Native RAW staging unavailable');return platform.stageRawSource(name, blob); },
    remove: async path => { await platform.deleteFile(path); },
  });
};

export class UpgradeEditPrecisionTool extends CanonicalTool {
  constructor(private readonly activation: ActivationFactory = createDocumentOperations) { super(); }
  readonly schema: CanonicalToolSchema = { name: 'edit_upgrade_precision', description: 'Create a separate 32F linear-sRGB copy of a legacy document. Preserves the original; old adjustment appearance may differ in the new rendering version.', workspace: 'edit', category: 'edit', riskLevel: 'normal', parameters: { type: 'object', properties: { documentId: { type: 'string', description: 'Legacy document to copy.' } }, required: [] } };
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    try {
      checkCancellation(context);
      const id = args.documentId ?? context.documentManager.getActiveDocument()?.id;
      const original = context.documentManager.getEditDocument(id), active = context.documentManager.getActiveDocument();
      const cmd = new UpgradeEditPrecisionCommand(id, context.documentManager);
      const execute = cmd.execute.bind(cmd);let first = true;
      cmd.execute = () => {
        if (first) {
          checkCancellation(context);
          if (context.documentManager.getEditDocument(id) !== original || context.documentManager.getActiveDocument() !== active) throw new Error('Source document changed');
        }
        execute();first = false;
      };
      await waitForCommand(context.commandBus.execute(cmd), context);
      activateResult(context, cmd.upgradedDocument.id, this.activation);
      return { success: true, toolCallId, commandId: cmd.id, changedDocumentId: cmd.upgradedDocument.id, renderRequired: true, data: { documentId: cmd.upgradedDocument.id, sourceDocumentId: id, bitDepth: 32, workingProfile: 'linear-srgb', renderingVersion: 2 } };
    } catch (error) { return failed(context, toolCallId, error); }
  }
}

export class RawSmartObjectTool extends CanonicalTool {
  constructor(private readonly serviceFactory: RawServiceFactory = createRawService, private readonly activation: ActivationFactory = createDocumentOperations) { super(); }
  readonly schema: CanonicalToolSchema = { name: 'edit_raw_smart_object', description: 'Open an original RAW smart-object recipe in Develop, or apply an edited linked variant back through one undoable command. Does not rasterize the source.', workspace: 'any', category: 'edit', riskLevel: 'normal', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'apply'], description: 'Open a recipe or apply a linked variant.' }, documentId: { type: 'string', description: 'Edit document for open, Develop variant for apply.' }, layerId: { type: 'string', description: 'RAW smart object layer for open.' } }, required: ['action', 'documentId'] } };
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    try {
      checkCancellation(context);
      let commandId: string | undefined;
      const commandBus = new Proxy(context.commandBus, { get(target, key) {
        if (key === 'execute') return async (command: Parameters<typeof target.execute>[0]) => { await target.execute(command);commandId = command.id; };
        const value = Reflect.get(target, key);return typeof value === 'function' ? value.bind(target) : value;
      } });
      const service = this.serviceFactory({ ...context, commandBus });
      let documentId: string;
      if (args.action === 'apply') documentId = await service.applyRecipe(args.documentId, context.signal);
      else if (args.action === 'open' && args.layerId) documentId = (await service.openRecipe(args.documentId, args.layerId, context.signal)).id;
      else throw new Error('Invalid RAW smart object action/target');
      activateResult(context, documentId, this.activation);
      return { success: true, toolCallId, commandId, changedDocumentId: documentId, renderRequired: true, data: { documentId, action: args.action } };
    } catch (error) { return failed(context, toolCallId, error); }
  }
}
