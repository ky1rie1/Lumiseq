import { IDocumentManager } from '../types/document';
import { ICommandBus } from '../types/history';
import { IAssetManager } from '../types/asset';
import { DuplicateLayerCommand } from '../commands/edit/DuplicateLayerCommand';
import { SetLayerLockedCommand } from '../commands/edit/SetLayerLockedCommand';
import { TransformCommand } from '../commands/edit/TransformCommand';
import { assertLayerEditable, layerBounds } from './LayerTree';
import { inverseMatrix, layerMatrix, multiplyMatrix } from '../engine/editTransforms';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultCommandBus } from '../history/CommandBus';
import { defaultAssetManager } from '../assets/AssetManager';

export const LAYER_ALIGNMENTS = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
export type LayerAlignment = typeof LAYER_ALIGNMENTS[number];
export type LayerFlipAxis = 'horizontal' | 'vertical';

export class LayerOperationService {
  constructor(private documents: IDocumentManager, private bus: ICommandBus, readonly assets: IAssetManager) {}
  private document(documentId: string) {
    const doc = this.documents.getEditDocument(documentId);
    if (!doc) throw new Error('图层文档不存在。');
    return doc;
  }
  async duplicate(documentId: string, layerId: string) {
    const doc = this.document(documentId);
    const { layer } = assertLayerEditable(doc, layerId, 'ancestors');
    // Assets are immutable references. Pixel and mask commands register new assets on write.
    // No awaited resource copy is needed, so validation and insertion are one synchronous commit.
    const command = new DuplicateLayerCommand(documentId, layerId, layer, this.documents);
    await this.bus.execute(command);
    return { commandId: command.id, layerId: command.duplicate.id };
  }
  async setLocked(documentId: string, layerId: string, locked: boolean) {
    if (typeof locked !== 'boolean') throw new Error('locked must be a boolean.');
    assertLayerEditable(this.document(documentId), layerId, 'ancestors');
    const command = new SetLayerLockedCommand(documentId, layerId, locked, this.documents);
    await this.bus.execute(command); return { commandId: command.id, layerId, locked };
  }
  async align(documentId: string, layerId: string, alignment: LayerAlignment) {
    if (!LAYER_ALIGNMENTS.includes(alignment)) throw new Error('Invalid layer alignment.');
    const doc = this.document(documentId);
    const { layer, parentWorld } = assertLayerEditable(doc, layerId);
    const inverse = inverseMatrix(parentWorld);
    const bounds = layerBounds(layer, multiplyMatrix(parentWorld, layerMatrix(layer.transform)));
    const dx = alignment === 'left' ? -bounds.left : alignment === 'center' ? doc.width / 2 - (bounds.left + bounds.right) / 2 : alignment === 'right' ? doc.width - bounds.right : 0;
    const dy = alignment === 'top' ? -bounds.top : alignment === 'middle' ? doc.height / 2 - (bounds.top + bounds.bottom) / 2 : alignment === 'bottom' ? doc.height - bounds.bottom : 0;
    const transform = { x: layer.transform.x + inverse[0] * dx + inverse[2] * dy, y: layer.transform.y + inverse[1] * dx + inverse[3] * dy };
    const command = new TransformCommand(documentId, layerId, transform, this.documents);
    await this.bus.execute(command); return { commandId: command.id, layerId, transform };
  }
  async flip(documentId: string, layerId: string, axis: LayerFlipAxis) {
    if (axis !== 'horizontal' && axis !== 'vertical') throw new Error('Invalid layer flip axis.');
    const { layer, parentWorld } = assertLayerEditable(this.document(documentId), layerId);
    inverseMatrix(parentWorld);
    const t = layer.transform; const matrix = layerMatrix(t);
    // Groups have no intrinsic size: derive their center from recursive content bounds in local space.
    const bounds = layerBounds(layer, [1, 0, 0, 1, 0, 0]);
    const cx = (bounds.left + bounds.right) / 2; const cy = (bounds.top + bounds.bottom) / 2;
    const next = { ...t, scaleX: axis === 'horizontal' ? -t.scaleX : t.scaleX, scaleY: axis === 'vertical' ? -t.scaleY : t.scaleY };
    const flipped = layerMatrix(next);
    next.x += (matrix[0] - flipped[0]) * cx + (matrix[2] - flipped[2]) * cy;
    next.y += (matrix[1] - flipped[1]) * cx + (matrix[3] - flipped[3]) * cy;
    const command = new TransformCommand(documentId, layerId, next, this.documents);
    await this.bus.execute(command); return { commandId: command.id, layerId, transform: next };
  }
}

export const defaultLayerOperationService = new LayerOperationService(defaultDocumentManager, defaultCommandBus, defaultAssetManager);
