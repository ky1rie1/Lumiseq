// src/stores/useEditStore.ts
import { create } from 'zustand';
import { clampEditZoom } from '../tools/canvasZoom';
import { EditDocument, BlendMode } from '../types/edit';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultCommandBus } from '../history/CommandBus';
import { CreateLayerCommand } from '../commands/edit/CreateLayerCommand';
import { SetLayerOpacityCommand } from '../commands/edit/SetLayerOpacityCommand';
import { SetLayerBlendModeCommand } from '../commands/edit/SetLayerBlendModeCommand';
import { MoveLayerOrderCommand } from '../commands/edit/MoveLayerOrderCommand';
import { MoveLayerCommand } from '../commands/edit/MoveLayerCommand';
import { ScaleLayerCommand } from '../commands/edit/ScaleLayerCommand';
import { RotateLayerCommand } from '../commands/edit/RotateLayerCommand';
import { ToggleLayerVisibilityCommand } from '../commands/edit/ToggleLayerVisibilityCommand';
import { RenameLayerCommand } from '../commands/edit/RenameLayerCommand';
import { DeleteLayerCommand } from '../commands/edit/DeleteLayerCommand';
import { AddGeneratedPatchLayerCommand } from '../commands/edit/AddGeneratedPatchLayerCommand';
import {
  CreateSelectionCommand,
  ClearSelectionCommand,
  SelectAllCommand,
  InvertSelectionCommand,
  FeatherSelectionCommand,
  ExpandSelectionCommand,
  ContractSelectionCommand
} from '../selection/SelectionCommands';
import {
  CreateMaskFromSelectionCommand,
  RemoveLayerMaskCommand,
  ToggleLayerMaskCommand,
  InvertLayerMaskCommand
} from '../mask/MaskCommands';
import { GeometricSelectionParams, SelectionMode, SelectionViewMode } from '../selection/types';
import { GeneratedPatchLayer, AdjustmentType, AdjustmentSettings, LayerTransform, Rect, SmartFilter, SmartFilterType } from '../types/edit';
import { createTextLayer, createImageLayer, createPaintLayer, createAdjustmentLayer } from '../document/EditDocument';
import { SetAdjustmentSettingsCommand } from '../commands/edit/SetAdjustmentSettingsCommand';
import { CreateGroupCommand, MoveToGroupCommand } from '../commands/edit/GroupCommands';
import { TransformCommand } from '../commands/edit/TransformCommand';
import { SetCropRectCommand, ResizeCanvasCommand, ResizeImageCommand, ResizeAnchor } from '../commands/edit/CropCommand';
import { ConvertToSmartObjectCommand, RasterizeSmartObjectCommand } from '../smartobject/SmartObjectManager';
import { defaultAssetManager } from '../assets/AssetManager';
import { createSmartFilter } from '../filters/smartFilters';
import { AddSmartFilterCommand, RemoveSmartFilterCommand, ReorderSmartFilterCommand, SetSmartFilterEnabledCommand, UpdateSmartFilterCommand } from '../commands/edit/SmartFilterCommands';

interface EditState {
  collapsedLayerIds: Record<string, string[]>;
  toggleLayerExpanded: (documentId: string, layerId: string) => void;
  currentDoc: EditDocument | null;
  selectedLayerId: string | null;

  // View State (Section 11: Zoom/Pan NOT in undo history!)
  zoom: number;
  panX: number;
  panY: number;
  maskViewMode: SelectionViewMode;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetViewport: () => void;
  setMaskViewMode: (mode: SelectionViewMode) => void;

  // Actions routing through CommandBus
  addTextLayer: (docId: string, text: string) => void;
  addImageLayer: (docId: string, name: string, sourceAssetId: string, width: number, height: number) => void;
  setLayerOpacity: (docId: string, layerId: string, opacity: number) => void;
  startOpacityDrag: (docId: string) => void;
  previewOpacityDrag: (docId: string, layerId: string, opacity: number) => void;
  commitOpacityDrag: () => void;
  setLayerBlendMode: (docId: string, layerId: string, blendMode: BlendMode) => void;

  moveLayerOrder: (docId: string, layerId: string, toIndex: number) => void;
  translateLayer: (docId: string, layerId: string, x: number, y: number) => void;
  startMoveLayerDrag: (docId: string) => void;
  previewMoveLayerDrag: (docId: string, layerId: string, x: number, y: number) => void;
  commitMoveLayerDrag: () => void;

  scaleLayer: (docId: string, layerId: string, scaleX: number, scaleY: number) => void;
  rotateLayer: (docId: string, layerId: string, rotation: number) => void;
  toggleLayerVisibility: (docId: string, layerId: string) => void;
  renameLayer: (docId: string, layerId: string, newName: string) => void;
  deleteLayer: (docId: string, layerId: string) => void;

  // Selection Actions
  createSelection: (
    docId: string,
    params: {
      geometric?: GeometricSelectionParams;
      rawMask?: Uint8ClampedArray;
      feather?: number;
      mode?: SelectionMode
    }
  ) => Promise<void>;
  clearSelection: (docId: string) => void;
  selectAll: (docId: string) => Promise<void>;
  invertSelection: (docId: string) => Promise<void>;
  featherSelection: (docId: string, radius: number) => Promise<void>;
  expandSelection: (docId: string, pixels: number) => Promise<void>;
  contractSelection: (docId: string, pixels: number) => Promise<void>;

  // Layer Mask Actions
  createMaskFromSelection: (docId: string, layerId: string, mode?: 'reveal' | 'hide') => Promise<void>;
  removeLayerMask: (docId: string, layerId: string) => void;
  toggleLayerMask: (docId: string, layerId: string) => void;
  invertLayerMask: (docId: string, layerId: string) => Promise<void>;

  // Patch Layer
  addGeneratedPatchLayer: (docId: string, patchLayer: GeneratedPatchLayer) => void;

  // Phase 6 Actions
  addPaintLayer: (docId: string, name?: string) => Promise<void>;
  addAdjustmentLayer: (docId: string, adjustmentType: AdjustmentType) => void;
  setAdjustmentSettings: (docId: string, layerId: string, settings: AdjustmentSettings) => void;
  createGroup: (docId: string, name?: string, memberLayerIds?: string[]) => void;
  moveToGroup: (docId: string, layerId: string, targetGroupId: string | null) => void;
  convertToSmartObject: (docId: string, layerId: string) => void;
  rasterizeSmartObject: (docId: string, layerId: string) => Promise<void>;
  addSmartFilter: (docId: string, layerId: string, type: SmartFilterType) => void;
  updateSmartFilter: (docId: string, layerId: string, filterId: string, patch: Partial<SmartFilter>) => void;
  setSmartFilterEnabled: (docId: string, layerId: string, filterId: string, enabled: boolean) => void;
  removeSmartFilter: (docId: string, layerId: string, filterId: string) => void;
  reorderSmartFilter: (docId: string, layerId: string, filterId: string, toIndex: number) => void;
  transformLayer: (docId: string, layerId: string, transform: Partial<LayerTransform>) => void;
  setCropRect: (docId: string, rect: Rect | null) => void;
  resizeCanvas: (docId: string, width: number, height: number, anchor?: ResizeAnchor) => void;
  resizeImage: (docId: string, width: number, height: number) => void;

  selectLayer: (layerId: string | null) => void;
  loadDocument: (doc: EditDocument) => void;
}

export const useEditStore = create<EditState>((set) => ({
  collapsedLayerIds: {},
  toggleLayerExpanded: (documentId, layerId) => set(state => {
    const current = state.collapsedLayerIds[documentId] ?? [];
    return { collapsedLayerIds: { ...state.collapsedLayerIds, [documentId]: current.includes(layerId) ? current.filter(id => id !== layerId) : [...current, layerId] } };
  }),
  currentDoc: null,
  selectedLayerId: null,

  zoom: 1.0,
  panX: 0,
  panY: 0,
  maskViewMode: 'normal',
  setZoom: (zoom) => set({ zoom: clampEditZoom(zoom) }),
  setPan: (panX, panY) => set({ panX, panY }),
  resetViewport: () => set({ zoom: 1.0, panX: 0, panY: 0 }),
  setMaskViewMode: (mode) => set({ maskViewMode: mode }),

  addTextLayer: (docId, text) => {
    const layer = createTextLayer({ text });
    const cmd = new CreateLayerCommand(docId, layer, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  addImageLayer: (docId, name, sourceAssetId, width, height) => {
    const layer = createImageLayer({
      name,
      sourceAssetId,
      naturalWidth: width,
      naturalHeight: height,
      x: 0,
      y: 0,
    });
    const cmd = new CreateLayerCommand(docId, layer, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  setLayerOpacity: (docId, layerId, opacity) => {
    const cmd = new SetLayerOpacityCommand(docId, layerId, opacity, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  startOpacityDrag: (docId) => {
    defaultCommandBus.beginTransaction('Adjust Layer Opacity', docId);
  },

  previewOpacityDrag: (docId, layerId, opacity) => {
    const cmd = new SetLayerOpacityCommand(docId, layerId, opacity, defaultDocumentManager);
    defaultCommandBus.preview(cmd);
  },

  commitOpacityDrag: () => {
    defaultCommandBus.commitTransaction();
  },

  setLayerBlendMode: (docId, layerId, blendMode) => {
    const cmd = new SetLayerBlendModeCommand(docId, layerId, blendMode, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  moveLayerOrder: (docId, layerId, toIndex) => {
    const cmd = new MoveLayerOrderCommand(docId, layerId, toIndex, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  translateLayer: (docId, layerId, x, y) => {
    const cmd = new MoveLayerCommand(docId, layerId, x, y, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  startMoveLayerDrag: (docId) => {
    defaultCommandBus.beginTransaction('Move Layer', docId);
  },

  previewMoveLayerDrag: (docId, layerId, x, y) => {
    const cmd = new MoveLayerCommand(docId, layerId, x, y, defaultDocumentManager);
    defaultCommandBus.preview(cmd);
  },

  commitMoveLayerDrag: () => {
    defaultCommandBus.commitTransaction();
  },

  scaleLayer: (docId, layerId, scaleX, scaleY) => {
    const cmd = new ScaleLayerCommand(docId, layerId, scaleX, scaleY, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  rotateLayer: (docId, layerId, rotation) => {
    const cmd = new RotateLayerCommand(docId, layerId, rotation, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  toggleLayerVisibility: (docId, layerId) => {
    const cmd = new ToggleLayerVisibilityCommand(docId, layerId, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  renameLayer: (docId, layerId, newName) => {
    const cmd = new RenameLayerCommand(docId, layerId, newName, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  deleteLayer: (docId, layerId) => {
    const cmd = new DeleteLayerCommand(docId, layerId, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  // Selection Actions via CommandBus
  createSelection: async (docId, params) => {
    const cmd = new CreateSelectionCommand(docId, params, defaultDocumentManager);
    await defaultCommandBus.execute(cmd);
  },

  clearSelection: (docId) => {
    const cmd = new ClearSelectionCommand(docId, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  selectAll: async (docId) => {
    const cmd = new SelectAllCommand(docId, defaultDocumentManager);
    await defaultCommandBus.execute(cmd);
  },

  invertSelection: async (docId) => {
    const cmd = new InvertSelectionCommand(docId, defaultDocumentManager);
    await defaultCommandBus.execute(cmd);
  },

  featherSelection: async (docId, radius) => {
    const cmd = new FeatherSelectionCommand(docId, radius, defaultDocumentManager);
    await defaultCommandBus.execute(cmd);
  },

  expandSelection: async (docId, pixels) => {
    const cmd = new ExpandSelectionCommand(docId, pixels, defaultDocumentManager);
    await defaultCommandBus.execute(cmd);
  },

  contractSelection: async (docId, pixels) => {
    const cmd = new ContractSelectionCommand(docId, pixels, defaultDocumentManager);
    await defaultCommandBus.execute(cmd);
  },

  // Layer Mask Actions via CommandBus
  createMaskFromSelection: async (docId, layerId, mode = 'reveal') => {
    const cmd = new CreateMaskFromSelectionCommand(docId, layerId, mode, defaultDocumentManager);
    await defaultCommandBus.execute(cmd);
  },

  removeLayerMask: (docId, layerId) => {
    const cmd = new RemoveLayerMaskCommand(docId, layerId, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  toggleLayerMask: (docId, layerId) => {
    const cmd = new ToggleLayerMaskCommand(docId, layerId, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  invertLayerMask: async (docId, layerId) => {
    const cmd = new InvertLayerMaskCommand(docId, layerId, defaultDocumentManager);
    await defaultCommandBus.execute(cmd);
  },

  // Patch Layer
  addGeneratedPatchLayer: (docId, patchLayer) => {
    const cmd = new AddGeneratedPatchLayerCommand(docId, patchLayer, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  // Phase 6 Actions
  addPaintLayer: async (docId, name) => {
    const doc = defaultDocumentManager.getEditDocument(docId);
    if (!doc) return;

    const w = doc.width;
    const h = doc.height;
    const blankBytes = new Uint8ClampedArray(w * h * 4);
    const buffer = blankBytes.buffer.slice(blankBytes.byteOffset, blankBytes.byteOffset + blankBytes.byteLength);
    const blob = new Blob([buffer], { type: 'image/png' });
    const handle = await defaultAssetManager.registerBlob(blob, 'image', name || '绘画图层', { width: w, height: h });

    const layer = createPaintLayer({
      name: name || '绘画图层',
      rasterAssetId: handle.id,
      width: w,
      height: h,
    });
    const cmd = new CreateLayerCommand(docId, layer, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  addAdjustmentLayer: (docId, adjustmentType) => {
    const layer = createAdjustmentLayer({ adjustmentType });
    const cmd = new CreateLayerCommand(docId, layer, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  setAdjustmentSettings: (docId, layerId, settings) => {
    const cmd = new SetAdjustmentSettingsCommand(docId, layerId, settings, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  createGroup: (docId, name, memberLayerIds) => {
    const cmd = new CreateGroupCommand(docId, name, memberLayerIds, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  moveToGroup: (docId, layerId, targetGroupId) => {
    const cmd = new MoveToGroupCommand(docId, layerId, targetGroupId, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  convertToSmartObject: (docId, layerId) => {
    const cmd = new ConvertToSmartObjectCommand(docId, layerId, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  rasterizeSmartObject: async (docId, layerId) => {
    const cmd = new RasterizeSmartObjectCommand(docId, layerId, defaultDocumentManager);
    await defaultCommandBus.execute(cmd);
  },

  addSmartFilter: (docId, layerId, type) => {
    defaultCommandBus.execute(new AddSmartFilterCommand(docId, layerId, createSmartFilter(type), defaultDocumentManager));
  },

  updateSmartFilter: (docId, layerId, filterId, patch) => {
    defaultCommandBus.execute(new UpdateSmartFilterCommand(docId, layerId, filterId, patch, defaultDocumentManager));
  },

  setSmartFilterEnabled: (docId, layerId, filterId, enabled) => {
    defaultCommandBus.execute(new SetSmartFilterEnabledCommand(docId, layerId, filterId, enabled, defaultDocumentManager));
  },

  removeSmartFilter: (docId, layerId, filterId) => {
    defaultCommandBus.execute(new RemoveSmartFilterCommand(docId, layerId, filterId, defaultDocumentManager));
  },

  reorderSmartFilter: (docId, layerId, filterId, toIndex) => {
    defaultCommandBus.execute(new ReorderSmartFilterCommand(docId, layerId, filterId, toIndex, defaultDocumentManager));
  },

  transformLayer: (docId, layerId, transform) => {
    const cmd = new TransformCommand(docId, layerId, transform, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  setCropRect: (docId, rect) => {
    const cmd = new SetCropRectCommand(docId, rect, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  resizeCanvas: (docId, width, height, anchor) => {
    const cmd = new ResizeCanvasCommand(docId, width, height, anchor, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  resizeImage: (docId, width, height) => {
    const cmd = new ResizeImageCommand(docId, width, height, defaultDocumentManager);
    defaultCommandBus.execute(cmd);
  },

  selectLayer: (layerId) => {
    set({ selectedLayerId: layerId });
    const doc = defaultDocumentManager.getActiveDocument();
    if (doc && doc.kind === 'edit') {
      defaultDocumentManager.updateDocument({
        ...doc,
        selectedLayerId: layerId,
      }, 'Select Layer', false);
    }
  },

  loadDocument: (doc) => {
    set({
      currentDoc: doc,
      selectedLayerId: doc.selectedLayerId,
    });
  },
}));

// State Adapter: Subscribe to DocumentManager changes
defaultDocumentManager.subscribe((event) => {
  if (event.type === 'opened' || event.type === 'updated') {
    if (event.document.kind === 'edit') {
      const activeDoc = defaultDocumentManager.getActiveDocument();
      if (activeDoc?.id === event.document.id) {
        useEditStore.setState({
          currentDoc: event.document as EditDocument,
          selectedLayerId: (event.document as EditDocument).selectedLayerId,
        });
      }
    }
  } else if (event.type === 'activated') {
    const activeDoc = defaultDocumentManager.getActiveDocument();
    if (activeDoc && activeDoc.kind === 'edit') {
      useEditStore.setState({
        currentDoc: activeDoc as EditDocument,
        selectedLayerId: (activeDoc as EditDocument).selectedLayerId,
      });
    } else {
      useEditStore.setState({ currentDoc: null, selectedLayerId: null });
    }
  }
});
