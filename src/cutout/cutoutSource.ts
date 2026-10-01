import type { EditDocument, Layer } from '../types/edit';
import { IDENTITY, layerMatrix, multiplyMatrix, type Affine } from '../engine/editTransforms';

export function layerPath(layers: Layer[], id: string): Layer[] | undefined {
  for (const layer of layers) {
    if (layer.id === id) return [layer];
    if (layer.type === 'group') { const children = layerPath(layer.children, id); if (children) return [layer, ...children]; }
  }
  return undefined;
}
export function cutoutSourceFingerprint(doc: EditDocument, layerId: string): string {
  const path = layerPath(doc.layers, layerId);
  if (!path) throw new Error('目标图层已删除。');
  return JSON.stringify([doc.width, doc.height, path.map(layer => ({ id: layer.id, type: layer.type, transform: layer.transform,
    source: 'sourceAssetId' in layer ? layer.sourceAssetId : 'rasterAssetId' in layer ? layer.rasterAssetId : undefined }))]);
}
export function layerWorld(layers: Layer[], layerId: string): Affine {
  const path = layerPath(layers, layerId); if (!path) throw new Error('目标图层已删除。');
  return path.reduce((world, layer) => multiplyMatrix(world, layerMatrix(layer.transform)), IDENTITY);
}
