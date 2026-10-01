import { CanonicalTool, IToolContext } from '../CanonicalTool';
import { CanonicalToolSchema, ToolResult } from '../../types';
import { LayerOperationService, LayerAlignment, LayerFlipAxis, LAYER_ALIGNMENTS } from '../../../edit/LayerOperationService';
import { LayerLockedError } from '../../../edit/LayerTree';
import { defaultAssetManager } from '../../../assets/AssetManager';

type Operation = 'duplicate' | 'setLocked' | 'align' | 'flip';
export class LayerOperationTool extends CanonicalTool {
  readonly schema: CanonicalToolSchema;
  constructor(private operation: Operation) {
    super();
    const names = { duplicate: 'edit_duplicate_layer', setLocked: 'edit_set_layer_locked', align: 'edit_align_layer', flip: 'edit_flip_layer' };
    const descriptions = { duplicate: 'Duplicate a layer or recursive group beside its source, with independent metadata and one undo step.', setLocked: 'Lock or unlock a layer. Ancestor locks prevent content, transform, pixel and structure changes.', align: 'Align the transformed layer bounds to the document canvas while preserving rotation and scale.', flip: 'Flip a layer horizontally or vertically around its displayed center, retaining rotation.' };
    const properties: CanonicalToolSchema['parameters']['properties'] = { documentId: { type: 'string', description: 'Target edit document ID.' }, layerId: { type: 'string', description: 'Target layer ID, including children of groups.' } };
    if (operation === 'setLocked') properties.locked = { type: 'boolean', description: 'Whether the layer should be locked.' };
    if (operation === 'align') properties.alignment = { type: 'string', enum: [...LAYER_ALIGNMENTS], description: 'Canvas edge or center to align to.' };
    if (operation === 'flip') properties.axis = { type: 'string', enum: ['horizontal', 'vertical'], description: 'Flip axis in the layer coordinate system.' };
    this.schema = { name: names[operation], description: descriptions[operation], workspace: 'edit', category: 'edit', riskLevel: 'normal', parameters: { type: 'object', properties, required: ['documentId', 'layerId', ...(operation === 'setLocked' ? ['locked'] : operation === 'align' ? ['alignment'] : operation === 'flip' ? ['axis'] : [])] } };
  }
  async execute(context: IToolContext, args: Record<string, any>, toolCallId: string): Promise<ToolResult> {
    try {
      if (typeof args.documentId !== 'string' || typeof args.layerId !== 'string') throw new Error('documentId and layerId are required.');
      const service = new LayerOperationService(context.documentManager, context.commandBus, defaultAssetManager);
      const result = this.operation === 'duplicate' ? await service.duplicate(args.documentId, args.layerId)
        : this.operation === 'setLocked' ? await service.setLocked(args.documentId, args.layerId, args.locked)
        : this.operation === 'align' ? await service.align(args.documentId, args.layerId, args.alignment as LayerAlignment)
        : await service.flip(args.documentId, args.layerId, args.axis as LayerFlipAxis);
      return { success: true, toolCallId, commandId: result.commandId, changedDocumentId: args.documentId, after: result, renderRequired: true };
    } catch (error) {
      return { success: false, toolCallId, renderRequired: false, error: { code: error instanceof LayerLockedError ? error.code : 'INVALID_ARGUMENT', message: error instanceof Error ? error.message : String(error) } };
    }
  }
}
