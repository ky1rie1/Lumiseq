// src/document/EditDocument.ts
//! Professional Editing Core — Layer Factory & Tree Hierarchy Engine (Phase 6)

import {
  AdjustmentLayer,
  AdjustmentSettings,
  AdjustmentType,
  EditDocument,
  GroupLayer,
  ImageLayer,
  Layer,
  PaintLayer,
  RetouchLayer,
  SmartObjectLayer,
  TextLayer,
} from '../types/edit';
import { ADJUSTMENT_TYPE_LABELS } from '../types/adjustmentLabels';
import { DevelopSettings } from '../types/develop';

export function createEditDocument(params: {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  dpi?: number;
  layers?: Layer[];
  backgroundColor?: string;
}): EditDocument {
  return {
    id: params.id || `doc_edit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    kind: 'edit',
    name: params.name || '未命名-1',
    width: params.width || 1920,
    height: params.height || 1080,
    dpi: params.dpi || 72,
    layers: params.layers || [],
    selectedLayerId: params.layers && params.layers.length > 0 ? params.layers[params.layers.length - 1].id : null,
    selection: null,
    backgroundColor: params.backgroundColor || '#121215',
    cropRect: null,
    guides: [],
    rulersVisible: true,
    editingTarget: 'layer',
    isDirty: false,
    updatedAt: Date.now(),
  };
}

export function createImageLayer(params: {
  id?: string;
  name: string;
  sourceAssetId: string;
  naturalWidth: number;
  naturalHeight: number;
  x?: number;
  y?: number;
  opacity?: number;
}): ImageLayer {
  return {
    id: params.id || `layer_img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: params.name,
    type: 'image',
    visible: true,
    opacity: params.opacity ?? 1.0,
    blendMode: 'normal',
    sourceAssetId: params.sourceAssetId,
    naturalWidth: params.naturalWidth,
    naturalHeight: params.naturalHeight,
    transform: {
      x: params.x ?? 0,
      y: params.y ?? 0,
      width: params.naturalWidth,
      height: params.naturalHeight,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
  };
}

export function createTextLayer(params: {
  id?: string;
  name?: string;
  text: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number;
  color?: string;
  x?: number;
  y?: number;
  opacity?: number;
}): TextLayer {
  return {
    id: params.id || `layer_txt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: params.name || `Text: ${params.text.substring(0, 12)}`,
    type: 'text',
    visible: true,
    opacity: params.opacity ?? 1.0,
    blendMode: 'normal',
    text: params.text,
    fontSize: params.fontSize ?? 48,
    fontFamily: params.fontFamily ?? 'Inter, sans-serif',
    fontWeight: params.fontWeight ?? 'normal',
    fontStyle: params.fontStyle ?? 'normal',
    lineHeight: params.lineHeight ?? 1.2,
    color: params.color ?? '#ffffff',
    align: 'left',
    letterSpacing: 0,
    transform: {
      x: params.x ?? 100,
      y: params.y ?? 100,
      width: 400,
      height: 80,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
  };
}

export function createPaintLayer(params: {
  id?: string;
  name?: string;
  rasterAssetId: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  opacity?: number;
}): PaintLayer {
  return {
    id: params.id || `layer_paint_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: params.name || '像素图层',
    type: 'paint',
    visible: true,
    opacity: params.opacity ?? 1.0,
    blendMode: 'normal',
    rasterAssetId: params.rasterAssetId,
    naturalWidth: params.width,
    naturalHeight: params.height,
    transform: {
      x: params.x ?? 0,
      y: params.y ?? 0,
      width: params.width,
      height: params.height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
  };
}

export function createRetouchLayer(params: {
  id?: string;
  name?: string;
  rasterAssetId: string;
  width: number;
  height: number;
  retouchType?: 'clone' | 'healing' | 'spot';
  x?: number;
  y?: number;
  opacity?: number;
}): RetouchLayer {
  return {
    id: params.id || `layer_retouch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: params.name || `Retouch (${params.retouchType || 'clone'})`,
    type: 'retouch',
    visible: true,
    opacity: params.opacity ?? 1.0,
    blendMode: 'normal',
    rasterAssetId: params.rasterAssetId,
    naturalWidth: params.width,
    naturalHeight: params.height,
    retouchType: params.retouchType || 'clone',
    transform: {
      x: params.x ?? 0,
      y: params.y ?? 0,
      width: params.width,
      height: params.height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
  };
}

export function createAdjustmentLayer(params: {
  id?: string;
  name?: string;
  adjustmentType: AdjustmentType;
  settings?: AdjustmentSettings;
  clipToBelow?: boolean;
  opacity?: number;
}): AdjustmentLayer {
  const defaultSettings: Record<AdjustmentType, AdjustmentSettings> = {
    exposure: { type: 'exposure', values: { exposure: 0.0, offset: 0, gamma: 1.0 } },
    brightness_contrast: { type: 'brightness_contrast', values: { brightness: 0, contrast: 0 } },
    hue_saturation: { type: 'hue_saturation', values: { hue: 0, saturation: 0, lightness: 0 } },
    color_balance: {
      type: 'color_balance',
      values: {
        shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
        preserveLuminosity: true,
      },
    },
    black_and_white: {
      type: 'black_and_white',
      values: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 },
    },
    levels: {
      type: 'levels',
      values: { inputBlack: 0, inputGamma: 1.0, inputWhite: 255, outputBlack: 0, outputWhite: 255 },
    },
    curves: {
      type: 'curves',
      values: { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
    },
  };

  const adjType = params.adjustmentType;
  const settings = params.settings || defaultSettings[adjType];

  return {
    id: params.id || `layer_adj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: params.name || `${ADJUSTMENT_TYPE_LABELS[adjType]} 1`,
    type: 'adjustment',
    adjustmentType: adjType,
    settings,
    visible: true,
    opacity: params.opacity ?? 1.0,
    blendMode: 'normal',
    clipToBelow: params.clipToBelow ?? false,
    transform: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
  };
}

export function createSmartObjectLayer(params: {
  id?: string;
  name?: string;
  sourceAssetId?: string;
  embeddedAssetId?: string;
  originalWidth?: number;
  originalHeight?: number;
  sourceRawUri?: string;
  developSettings?: DevelopSettings;
  x?: number;
  y?: number;
  opacity?: number;
}): SmartObjectLayer {
  const w = params.originalWidth ?? 100;
  const h = params.originalHeight ?? 100;
  const sId = params.sourceAssetId || params.embeddedAssetId || '';
  const eId = params.embeddedAssetId || params.sourceAssetId || '';

  return {
    id: params.id || `layer_so_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: params.name || '智能对象 1',
    type: 'smart-object',
    visible: true,
    opacity: params.opacity ?? 1.0,
    blendMode: 'normal',
    sourceAssetId: sId,
    embeddedAssetId: eId,
    originalWidth: w,
    originalHeight: h,
    sourceRawUri: params.sourceRawUri,
    developSettings: params.developSettings,
    smartFilters: [],
    transform: {
      x: params.x ?? 0,
      y: params.y ?? 0,
      width: w,
      height: h,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
  };
}

export function createGroupLayer(params: {
  id?: string;
  name?: string;
  children?: Layer[];
  collapsed?: boolean;
}): GroupLayer {
  return {
    id: params.id || `layer_grp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: params.name || '图层组 1',
    type: 'group',
    visible: true,
    opacity: 1.0,
    blendMode: 'normal',
    children: params.children || [],
    collapsed: params.collapsed ?? false,
    transform: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    },
  };
}

// --- Layer Tree Traversal & Management Helpers ---

export function findLayerById(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === 'group') {
      const found = findLayerById((l as GroupLayer).children, id);
      if (found) return found;
    }
  }
  return null;
}

export function flattenLayerTree(layers: Layer[]): Layer[] {
  const result: Layer[] = [];
  for (const l of layers) {
    result.push(l);
    if (l.type === 'group') {
      result.push(...flattenLayerTree((l as GroupLayer).children));
    }
  }
  return result;
}

export function updateLayerInTree(
  layers: Layer[],
  target: Layer | string,
  updater?: (l: Layer) => Layer
): Layer[] {
  const targetId = typeof target === 'string' ? target : target.id;
  return layers.map((l) => {
    if (l.id === targetId) {
      if (typeof target === 'string' && updater) {
        return updater(l);
      }
      return typeof target !== 'string' ? target : (updater ? updater(l) : l);
    }
    if (l.type === 'group') {
      return {
        ...l,
        children: updateLayerInTree((l as GroupLayer).children, target as any, updater),
      };
    }
    return l;
  });
}

export function removeLayerFromTree(layers: Layer[], id: string): Layer[] {
  return layers
    .filter((l) => l.id !== id)
    .map((l) => {
      if (l.type === 'group') {
        return {
          ...l,
          children: removeLayerFromTree((l as GroupLayer).children, id),
        };
      }
      return l;
    });
}
