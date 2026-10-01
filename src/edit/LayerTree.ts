import { EditDocument, GroupLayer, Layer } from '../types/edit';
import { Affine, IDENTITY, inverseMatrix, layerMatrix, multiplyMatrix } from '../engine/editTransforms';
import { flattenLayerTree, updateLayerInTree } from '../document/EditDocument';
import { IDocumentManager } from '../types/document';

export interface LayerLocation { layer: Layer; parent: GroupLayer | null; ancestors: GroupLayer[]; siblings: Layer[]; index: number; parentWorld: Affine; }

export function locateLayer(layers: Layer[], id: string, ancestors: GroupLayer[] = [], parentWorld: Affine = IDENTITY): LayerLocation | null {
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    if (layer.id === id) return { layer, siblings: layers, index, ancestors, parent: ancestors.at(-1) ?? null, parentWorld };
    if (layer.type === 'group') {
      const found = locateLayer(layer.children, id, [...ancestors, layer], multiplyMatrix(parentWorld, layerMatrix(layer.transform)));
      if (found) return found;
    }
  }
  return null;
}

export class LayerLockedError extends Error {
  readonly code = 'LAYER_LOCKED';
  constructor(layer: Layer) { super(`图层「${layer.name}」已锁定 (locked)。请先解锁。`); }
}

/** One policy for UI, commands and canonical tools. Content/structure changes include descendants. */
export function assertLayerEditable(doc: EditDocument, id: string, mode: 'content' | 'ancestors' = 'content'): LayerLocation {
  const location = locateLayer(doc.layers, id);
  if (!location) throw new Error(`Layer "${id}" not found.`);
  const locked = location.ancestors.find(layer => layer.locked)
    ?? (mode === 'content' ? flattenLayerTree([location.layer]).find(layer => layer.locked) : undefined);
  if (locked) throw new LayerLockedError(locked);
  return location;
}

export function isLayerLocked(doc: EditDocument, id: string): boolean {
  const location = locateLayer(doc.layers, id);
  return !!location && [...location.ancestors, ...flattenLayerTree([location.layer])].some(layer => layer.locked);
}

export function assertDocumentLayersEditable(doc: EditDocument): void {
  const locked = flattenLayerTree(doc.layers).find(layer => layer.locked);
  if (locked) throw new LayerLockedError(locked);
}

export function replaceSiblings(layers: Layer[], parent: GroupLayer | null, siblings: Layer[]): Layer[] {
  return parent ? updateLayerInTree(layers, { ...parent, children: siblings }) : siblings;
}

/** Object identity changes on every publication, including close/reopen with the same document id. */
export function assertCurrentLayer(documents: IDocumentManager, expected: EditDocument, id: string): void {
  const current = documents.getEditDocument(expected.id);
  if (current !== expected) throw new Error('文档在操作期间已修改或关闭 (changed)，请重试。');
  assertLayerEditable(current, id);
}

export function layerBounds(layer: Layer, world: Affine): { left: number; top: number; right: number; bottom: number } {
  const points: [number, number][] = [];
  const visit = (item: Layer, matrix: Affine) => {
    if (item.type === 'group') {
      item.children.filter(child => child.visible).forEach(child => visit(child, multiplyMatrix(matrix, layerMatrix(child.transform))));
    } else {
      for (const [x, y] of [[0, 0], [item.transform.width, 0], [0, item.transform.height], [item.transform.width, item.transform.height]]) {
        points.push([matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
      }
    }
  };
  visit(layer, world);
  if (!points.length) points.push([world[4], world[5]]);
  if (!points.flat().every(Number.isFinite)) throw new Error('Invalid layer bounds.');
  return { left: Math.min(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), right: Math.max(...points.map(p => p[0])), bottom: Math.max(...points.map(p => p[1])) };
}

/** Reject shear instead of silently changing appearance when reparenting through rotated scales. */
export function transformFromMatrix(layer: Layer, matrix: Affine): Layer['transform'] {
  const scaleX = Math.hypot(matrix[0], matrix[1]);
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (scaleX < 1e-12 || Math.abs(determinant) < 1e-12) throw new Error('Layer transform cannot be inverted.');
  if (Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3]) > 1e-8 * Math.max(1, scaleX * Math.hypot(matrix[2], matrix[3]))) {
    throw new Error('此分组变换需要斜切，无法保留图层外观。');
  }
  return { ...layer.transform, x: matrix[4], y: matrix[5], rotation: Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI, scaleX, scaleY: determinant / scaleX };
}

export function layerWorldMatrix(doc: EditDocument, id: string): Affine {
  const location = locateLayer(doc.layers, id);
  if (!location) throw new Error('Layer not found.');
  return multiplyMatrix(location.parentWorld, layerMatrix(location.layer.transform));
}

export function documentDeltaToParent(doc: EditDocument, id: string, dx: number, dy: number): { x: number; y: number } {
  const location = locateLayer(doc.layers, id);
  if (!location) throw new Error('Layer not found.');
  const inverse = inverseMatrix(location.parentWorld);
  return { x: inverse[0] * dx + inverse[2] * dy, y: inverse[1] * dx + inverse[3] * dy };
}

export function layerRasterPoint(doc: EditDocument, id: string, x: number, y: number): { x: number; y: number } {
  const location = locateLayer(doc.layers, id);
  if (!location) throw new Error('Layer not found.');
  const inverse = inverseMatrix(layerWorldMatrix(doc, id));
  const layer = location.layer;
  const width = 'naturalWidth' in layer ? layer.naturalWidth : layer.transform.width;
  const height = 'naturalHeight' in layer ? layer.naturalHeight : layer.transform.height;
  return { x: (inverse[0] * x + inverse[2] * y + inverse[4]) * width / layer.transform.width, y: (inverse[1] * x + inverse[3] * y + inverse[5]) * height / layer.transform.height };
}

/** With an explicit selection, ignore sibling stacking order; locks are checked by the move caller. */
export function hitTestLayerTree(doc: EditDocument, x: number, y: number, selectedLayerId?: string): Layer | null {
  const visit = (layers: Layer[], parent: Affine): Layer | null => {
    for (const layer of [...layers].reverse()) {
      if (!layer.visible) continue;
      const world = multiplyMatrix(parent, layerMatrix(layer.transform));
      if (layer.type === 'group') { const found = visit(layer.children, world); if (found) return found; }
      else {
        try {
          const inverse = inverseMatrix(world);
          const localX = inverse[0] * x + inverse[2] * y + inverse[4]; const localY = inverse[1] * x + inverse[3] * y + inverse[5];
          if (localX >= 0 && localX <= layer.transform.width && localY >= 0 && localY <= layer.transform.height) return layer;
        } catch { /* A singular layer has no hittable surface. */ }
      }
    }
    return null;
  };
  if (selectedLayerId !== undefined) {
    const location = locateLayer(doc.layers, selectedLayerId);
    if (!location || !location.layer.visible || location.ancestors.some(layer => !layer.visible)) return null;
    // Preserve moving an explicitly selected group from anywhere on the canvas.
    if (location.layer.type === 'group') return location.layer;
    return visit([location.layer], location.parentWorld);
  }
  return visit(doc.layers, IDENTITY);
}
