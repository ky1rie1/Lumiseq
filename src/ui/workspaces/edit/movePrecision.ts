import type { Layer } from '../../../types/edit';
import { defaultSnappingEngine, type SnapResult } from '../../../tools/snapping';

export function resolveLayerMove(params: {
  layer: Layer;
  x: number;
  y: number;
  canvasWidth: number;
  canvasHeight: number;
  otherLayers: Layer[];
  userGuides?: { id: string; orientation: 'horizontal' | 'vertical'; position: number }[];
  documentPixelsPerScreenPixel: number;
  enabled: boolean;
  bypass: boolean;
}): Pick<SnapResult, 'x' | 'y' | 'guides'> | null {
  const { layer, x, y } = params;
  if (layer.locked) return null;
  if (!params.enabled || params.bypass || layer.transform.rotation !== 0 || layer.transform.scaleX !== 1 || layer.transform.scaleY !== 1) return { x, y, guides: [] };
  const result = defaultSnappingEngine.snap({
    target: { x, y, width: layer.transform.width, height: layer.transform.height },
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
    otherLayers: params.otherLayers,
    userGuides: params.userGuides,
    threshold: 8 * params.documentPixelsPerScreenPixel,
  });
  return { x: result.x, y: result.y, guides: result.guides };
}
