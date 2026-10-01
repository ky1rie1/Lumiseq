import { assertLayerEditable, assertCurrentLayer, isLayerLocked, locateLayer, layerWorldMatrix, layerRasterPoint, documentDeltaToParent, hitTestLayerTree } from '../../../edit/LayerTree';
import { flattenLayerTree } from '../../../document/EditDocument';
// src/ui/workspaces/edit/EditWorkspace.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Layers as LayersIcon,
  ZoomIn,
  ZoomOut,
  Download
} from 'lucide-react';
import { useEditStore } from '../../../stores/useEditStore';
import { useAppStore } from '../../../stores/useAppStore';
import { defaultImageEngine } from '../../../engine/WebGLImageEngine';
import { defaultAssetManager } from '../../../assets/AssetManager';
import { defaultSelectionRenderer } from '../../../selection/SelectionRenderer';
import { SelectObjectTool } from '../../../ai/tools/edit/selectionTools';
import { getPlatformBridge } from '../../../platform';
import { Layer } from '../../../types/edit';
import { Point, Rect, SelectionMode } from '../../../selection/types';
import { SelectionBar } from './SelectionBar';
import { Toolbar } from './Toolbar';
import { EditTool, LastUsedTools, findToolByShortcut, toolDefinition } from './editTools';
import { canClosePolygon, constrainDragRect, resolveSelectionMode } from './toolGestures';
import { ContextToolbar } from './ContextToolbar';
import { PropertiesPanel } from './PropertiesPanel';
import { LayersPanel } from './LayersPanel';
import { HistoryPanel } from './HistoryPanel';
import { defaultBrushEngine } from '../../../brush/BrushEngine';
import { BrushSettings } from '../../../brush/BrushSettings';
import { defaultRetouchEngine } from '../../../brush/RetouchEngine';
import { EyedropperSampleSize } from '../../../tools/eyedropper';
import { sampleDocumentColor } from '../../../tools/sampleDocumentColor';
import { documentPixelsPerCssPixel, editCanvasCoordinates, editDisplayScale, editActualSizeZoom, zoomAtCanvasPoint } from './editCanvasCoordinates';
import { resolveLayerMove } from './movePrecision';
import type { SnapResult } from '../../../tools/snapping';
import { GradientType, GradientPreset, defaultGradientRenderer, DrawGradientCommand } from '../../../tools/gradient';
import { defaultColorState } from '../../../color/colorState';
import { defaultCommandBus } from '../../../history/CommandBus';
import { defaultDocumentManager } from '../../../document/DocumentManager';
import { createPaintLayer } from '../../../document/EditDocument';
import { CreateLayerCommand } from '../../../commands/edit/CreateLayerCommand';
import { decodeImageDimensions } from '../../../app/documentOpening';
import { isTextEditingTarget } from '../../../app/keyboard';
import { prepareImageLayer } from './importImageLayer';
import { CutoutDialog } from './CutoutDialog';
import { findLayer } from '../../../cutout/ApplyCutoutMaskCommand';
import { getStudioPreferences, useStudioPreferences } from '../../../stores/useStudioPreferences';
import { initializeBrushSettings, paintCanvasBackdrop, wheelZoomFactor } from './canvasPreferences';
import { LatestPreviewScheduler } from '../../../develop/LatestPreviewScheduler';
import { EditPreviewSurface } from './EditPreviewSurface';
import { copyActiveLayerToClipboard, pasteClipboardImageToDocument } from '../../../clipboard/ClipboardService';
import { extractPointerInput } from '../../../input/PointerInput';

export const EditWorkspace: React.FC<{ onExport: () => void }> = ({ onExport }) => {
  const currentDoc = useEditStore((s) => s.currentDoc);
  const selectedLayerId = useEditStore((s) => s.selectedLayerId);
  const selectLayer = useEditStore((s) => s.selectLayer);
  const addImageLayer = useEditStore((s) => s.addImageLayer);
  const setLayerBlendMode = useEditStore((s) => s.setLayerBlendMode);
  const previewOpacityDrag = useEditStore((s) => s.previewOpacityDrag);
  const startMoveLayerDrag = useEditStore((s) => s.startMoveLayerDrag);
  const previewMoveLayerDrag = useEditStore((s) => s.previewMoveLayerDrag);
  const commitMoveLayerDrag = useEditStore((s) => s.commitMoveLayerDrag);

  // Phase 6 Actions
  const addPaintLayer = useEditStore((s) => s.addPaintLayer);
  const setAdjustmentSettings = useEditStore((s) => s.setAdjustmentSettings);
  const transformLayer = useEditStore((s) => s.transformLayer);
  const setCropRect = useEditStore((s) => s.setCropRect);
  const rasterizeSmartObject = useEditStore((s) => s.rasterizeSmartObject);
  const addSmartFilter = useEditStore((s) => s.addSmartFilter);
  const updateSmartFilter = useEditStore((s) => s.updateSmartFilter);
  const setSmartFilterEnabled = useEditStore((s) => s.setSmartFilterEnabled);
  const removeSmartFilter = useEditStore((s) => s.removeSmartFilter);
  const reorderSmartFilter = useEditStore((s) => s.reorderSmartFilter);

  // Selection & Mask Store Actions
  const maskViewMode = useEditStore((s) => s.maskViewMode);
  const createSelection = useEditStore((s) => s.createSelection);
  const clearSelection = useEditStore((s) => s.clearSelection);
  const selectAll = useEditStore((s) => s.selectAll);
  const invertSelection = useEditStore((s) => s.invertSelection);

  // Viewport State
  const zoom = useEditStore((s) => s.zoom);
  const panX = useEditStore((s) => s.panX);
  const panY = useEditStore((s) => s.panY);
  const setZoom = useEditStore((s) => s.setZoom);
  const setPan = useEditStore((s) => s.setPan);
  const resetViewport = useEditStore((s) => s.resetViewport);

  const setWorkspace = useAppStore((s) => s.setWorkspace);

  // UI state
  const [activeTool, setActiveTool] = useState<EditTool>('move');
  const [lastUsedTools, setLastUsedTools] = useState<LastUsedTools>({});
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('replace');
  const [selectionFeather, setSelectionFeather] = useState(0);
  const [cropRatio, setCropRatio] = useState<number | null>(null);
  const [hasCropDraft, setHasCropDraft] = useState(false);
  const [autoSelectLayer, setAutoSelectLayer] = useState(true);
  const [showTransformControls, setShowTransformControls] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [newTextPrompt, setNewTextPrompt] = useState('示例文字');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const rasterizationRequests = useRef(new Set<string>());
  const [cutoutOpen, setCutoutOpen] = useState(false);

  // Phase 6 UI state
  const [brushSettings, setBrushSettings] = useState<BrushSettings>(() => initializeBrushSettings(getStudioPreferences()));
  const canvasBackground = useStudioPreferences(s => s.preferences.canvasBackground);
  const checkerSize = useStudioPreferences(s => s.preferences.checkerSize);
  const checkerTone = useStudioPreferences(s => s.preferences.checkerTone);
  const renderScheduler = useRef(new LatestPreviewScheduler());
  const previewSurface = useRef<EditPreviewSurface | null>(null);
  const [eyedropperSize, setEyedropperSize] = useState<EyedropperSampleSize>(1);
  const colorSampleRequest = useRef(0);
  const [gradientType, setGradientType] = useState<GradientType>('linear');
  const [gradientPreset, setGradientPreset] = useState<GradientPreset>('fg-to-bg');
  const [rightPanelTab, setRightPanelTab] = useState<'layers' | 'properties'>('layers');

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportContainerRef = useRef<HTMLDivElement | null>(null);

  // Dragging & Interaction state tracking
  const isDraggingLayerRef = useRef(false);
  const draggedLayerIdRef = useRef<string | null>(null);
  const snapGuidesRef = useRef<SnapResult['guides']>([]);
  const isPanningRef = useRef(false);
  const isSpacePressedRef = useRef(false);
  const isDrawingSelectionRef = useRef(false);
  const selectionStartRef = useRef<Point>({ x: 0, y: 0 });
  const currentSelectionPosRef = useRef<Point>({ x: 0, y: 0 });
  const lassoPointsRef = useRef<Point[]>([]);
  const polygonPointsRef = useRef<Point[]>([]);
  const polygonHoverRef = useRef<Point | null>(null);
  const polygonModeRef = useRef<SelectionMode>('replace');
  const selectionGestureModeRef = useRef<SelectionMode>('replace');
  const cropDraftRef = useRef<Rect | null>(null);
  const isDrawingGradientRef = useRef(false);
  const gradientStartRef = useRef<Point>({ x: 0, y: 0 });
  const gradientEndRef = useRef<Point>({ x: 0, y: 0 });

  const selectEditTool = (tool: EditTool) => {
    setActiveTool(tool);
    const group = toolDefinition(tool).group;
    setLastUsedTools(previous => ({ ...previous, [group]: tool }));
  };

  useEffect(() => {
    polygonPointsRef.current = [];
    polygonHoverRef.current = null;
    cropDraftRef.current = null;
    setHasCropDraft(false);
    snapGuidesRef.current = [];
  }, [activeTool, currentDoc?.id]);

  const dragStartRef = useRef<{
    mouseDocX: number;
    mouseDocY: number;
    layerStartX: number;
    layerStartY: number;
    screenMouseX: number;
    screenMouseY: number;
    startPanX: number;
    startPanY: number;
  }>({
    mouseDocX: 0,
    mouseDocY: 0,
    layerStartX: 0,
    layerStartY: 0,
    screenMouseX: 0,
    screenMouseY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  const selectedLayer = currentDoc && selectedLayerId ? findLayer(currentDoc.layers, selectedLayerId) ?? null : null;
  const canCutout = !!selectedLayer && ['image', 'paint', 'retouch', 'smart-object', 'generated-patch'].includes(selectedLayer.type);

  useEffect(() => {
    previewSurface.current = new EditPreviewSurface();
    return () => {
      renderScheduler.current.cancel();
      previewSurface.current?.dispose();
      previewSurface.current = null;
    };
  }, []);

  // Render document & selection overlays to canvas
  const paintCanvas = useCallback(async (isCurrent: () => boolean) => {
    if (!currentDoc || !canvasRef.current || !viewportContainerRef.current || !previewSurface.current) return;
    const targetCanvas = canvasRef.current;
    const container = viewportContainerRef.current;

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = container.clientWidth;
    const displayHeight = container.clientHeight;

    const width = Math.max(1, Math.floor(displayWidth * dpr));
    const height = Math.max(1, Math.floor(displayHeight * dpr));
    await previewSurface.current.paint({ width, height }, async canvas => {

    const viewport = {
      zoom,
      panX,
      panY,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };

    // Support live layer override during active brush painting
    const layerOverrides = defaultBrushEngine.isPainting && defaultBrushEngine.getActiveStroke()
      ? new Map<string, CanvasImageSource>([[defaultBrushEngine.getActiveStroke()!.layerId, defaultBrushEngine.getOffscreenCanvas()!]])
      : undefined;

    // 1. Render base layer stack using WebGLImageEngine (respecting layer masks & patch layers)
    await defaultImageEngine.renderEdit(currentDoc, canvas, viewport, (context, rect) => {
      paintCanvasBackdrop(context, rect, { canvasBackground, checkerSize, checkerTone }, dpr);
      // Solid document backgrounds remain part of the image; transparent documents show the checker.
      context.fillStyle = currentDoc.backgroundColor || '#121215';
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    }, layerOverrides);
    if (!isCurrent()) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const baseScale = Math.min(canvas.width / currentDoc.width, canvas.height / currentDoc.height);
    const scale = baseScale * zoom;
    const offsetX = (canvas.width - currentDoc.width * scale) / 2 + panX;
    const offsetY = (canvas.height - currentDoc.height * scale) / 2 + panY;

    // A committed crop hides pixels outside its bounds in the viewport while
    // keeping the original layer pixels available for later crop adjustments.
    if (currentDoc.cropRect) {
      const cr = currentDoc.cropRect;
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.fillStyle = canvasBackground;
      ctx.fillRect(0, 0, currentDoc.width, Math.max(0, cr.y));
      ctx.fillRect(0, cr.y, Math.max(0, cr.x), cr.height);
      ctx.fillRect(cr.x + cr.width, cr.y, Math.max(0, currentDoc.width - cr.x - cr.width), cr.height);
      ctx.fillRect(0, cr.y + cr.height, currentDoc.width, Math.max(0, currentDoc.height - cr.y - cr.height));
      ctx.restore();
    }

    // 2. Render Selection Overlay (Marching Ants / Rubylith Mask)
    if (currentDoc.selection && currentDoc.selection.active) {
      await defaultSelectionRenderer.renderSelectionOverlay(
        ctx,
        currentDoc.selection,
        maskViewMode,
        scale,
        offsetX,
        offsetY,
        currentDoc.width,
        currentDoc.height
      );
      if (!isCurrent()) return;
    }

    // 3. Render Active Drag Preview for Selection Creation
    if (isDrawingSelectionRef.current) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5 / scale;
      ctx.setLineDash([4 / scale, 4 / scale]);

      const start = selectionStartRef.current;
      const end = currentSelectionPosRef.current;
      const sx = Math.min(start.x, end.x);
      const sy = Math.min(start.y, end.y);
      const sw = Math.abs(end.x - start.x);
      const sh = Math.abs(end.y - start.y);

      if (activeTool === 'select-rect' || activeTool === 'select-object') {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeRect(sx, sy, sw, sh);
      } else if (activeTool === 'select-ellipse') {
        ctx.beginPath();
        ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.fill();
        ctx.stroke();
      } else if (activeTool === 'select-lasso' && lassoPointsRef.current.length > 1) {
        ctx.beginPath();
        ctx.moveTo(lassoPointsRef.current[0].x, lassoPointsRef.current[0].y);
        for (let i = 1; i < lassoPointsRef.current.length; i++) {
          ctx.lineTo(lassoPointsRef.current[i].x, lassoPointsRef.current[i].y);
        }
        ctx.stroke();
      }

      ctx.restore();
    }

    if (activeTool === 'select-polygon' && polygonPointsRef.current.length) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.strokeStyle = '#38bdf8';
      ctx.fillStyle = '#f8fafc';
      ctx.lineWidth = 1.5 / scale;
      ctx.setLineDash([4 / scale, 4 / scale]);
      ctx.beginPath();
      ctx.moveTo(polygonPointsRef.current[0].x, polygonPointsRef.current[0].y);
      for (const point of polygonPointsRef.current.slice(1)) ctx.lineTo(point.x, point.y);
      if (polygonHoverRef.current) ctx.lineTo(polygonHoverRef.current.x, polygonHoverRef.current.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const point of polygonPointsRef.current) {
        ctx.beginPath(); ctx.arc(point.x, point.y, 3 / scale, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // 4. Draw overlay on top (Selection bounding box & corner handles for Move Tool)
    if (selectedLayer && selectedLayer.visible && activeTool === 'move' && showTransformControls) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.transform(...layerWorldMatrix(currentDoc, selectedLayer.id));

      const lw = selectedLayer.transform.width;
      const lh = selectedLayer.transform.height;

      // Bounding box border
      ctx.strokeStyle = '#38bdf8'; // Sky blue
      ctx.lineWidth = 1.5 / scale;
      ctx.setLineDash([4 / scale, 3 / scale]);
      ctx.strokeRect(0, 0, lw, lh);

      // Corner handles
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0284c7';
      const hSize = 7 / scale;
      const corners = [
        [0, 0],
        [lw, 0],
        [lw, lh],
        [0, lh],
        [lw / 2, 0],
        [lw, lh / 2],
        [lw / 2, lh],
        [0, lh / 2],
      ];

      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - hSize / 2, cy - hSize / 2, hSize, hSize);
        ctx.strokeRect(cx - hSize / 2, cy - hSize / 2, hSize, hSize);
      }

      ctx.restore();
    }

    if (activeTool === 'move' && snapGuidesRef.current.length) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([6 / scale, 3 / scale]);
      for (const guide of snapGuidesRef.current) {
        ctx.beginPath();
        if (guide.orientation === 'vertical') {
          ctx.moveTo(guide.position, 0);
          ctx.lineTo(guide.position, currentDoc.height);
        } else {
          ctx.moveTo(0, guide.position);
          ctx.lineTo(currentDoc.width, guide.position);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Render Gradient Drag Preview
    if (isDrawingGradientRef.current) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([4 / scale, 4 / scale]);
      ctx.beginPath();
      ctx.moveTo(gradientStartRef.current.x, gradientStartRef.current.y);
      ctx.lineTo(gradientEndRef.current.x, gradientEndRef.current.y);
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(gradientStartRef.current.x, gradientStartRef.current.y, 4 / scale, 0, Math.PI * 2);
      ctx.arc(gradientEndRef.current.x, gradientEndRef.current.y, 4 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 6. Render Crop Overlay if Crop Tool is active or cropRect is defined
    const cropPreview = activeTool === 'crop' && isDrawingSelectionRef.current
      ? constrainDragRect(selectionStartRef.current, currentSelectionPosRef.current, cropRatio, currentDoc.width, currentDoc.height)
      : cropDraftRef.current ?? currentDoc.cropRect;
    if (activeTool === 'crop' && cropPreview && cropPreview.width > 0 && cropPreview.height > 0) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      const cr = cropPreview;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, 0, currentDoc.width, cr.y);
      ctx.fillRect(0, cr.y, cr.x, cr.height);
      ctx.fillRect(cr.x + cr.width, cr.y, currentDoc.width - cr.x - cr.width, cr.height);
      ctx.fillRect(0, cr.y + cr.height, currentDoc.width, currentDoc.height - cr.y - cr.height);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(cr.x, cr.y, cr.width, cr.height);

      ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.moveTo(cr.x + cr.width / 3, cr.y);
      ctx.lineTo(cr.x + cr.width / 3, cr.y + cr.height);
      ctx.moveTo(cr.x + (cr.width * 2) / 3, cr.y);
      ctx.lineTo(cr.x + (cr.width * 2) / 3, cr.y + cr.height);
      ctx.moveTo(cr.x, cr.y + cr.height / 3);
      ctx.lineTo(cr.x + cr.width, cr.y + cr.height / 3);
      ctx.moveTo(cr.x, cr.y + (cr.height * 2) / 3);
      ctx.lineTo(cr.x + cr.width, cr.y + (cr.height * 2) / 3);
      ctx.stroke();
      ctx.restore();
    }
    }, canvas => {
    if (defaultBrushEngine.isPainting) return;
    const targetContext = targetCanvas.getContext('2d');
    if (targetContext) {
      if (targetCanvas.width !== canvas.width) targetCanvas.width = canvas.width;
      if (targetCanvas.height !== canvas.height) targetCanvas.height = canvas.height;
      if (overlayCanvasRef.current) {
        if (overlayCanvasRef.current.width !== targetCanvas.width) overlayCanvasRef.current.width = targetCanvas.width;
        if (overlayCanvasRef.current.height !== targetCanvas.height) overlayCanvasRef.current.height = targetCanvas.height;
      }
      targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      targetContext.drawImage(canvas, 0, 0);
      setDisplayScale(editDisplayScale(targetCanvas, currentDoc, zoom));
    }
    }, () => isCurrent() && !defaultBrushEngine.isPainting);
  }, [currentDoc, zoom, panX, panY, selectedLayer, activeTool, showTransformControls, cropRatio, maskViewMode, canvasBackground, checkerSize, checkerTone]);

  const renderCanvas = useCallback((invalidateRunning = true) => {
    if (defaultBrushEngine.isPainting) return;
    renderScheduler.current.schedule(async isCurrent => {
      try { await paintCanvas(isCurrent); }
      catch (error) { if (isCurrent()) setStatusMessage(`画布预览失败：${error instanceof Error ? error.message : String(error)}`); }
    }, invalidateRunning);
  }, [paintCanvas]);

  // Marching Ants Animation Loop
  useEffect(() => {
    if (currentDoc?.selection && currentDoc.selection.active) {
      const start = () => {
        defaultSelectionRenderer.stopAnimation();
        if (!document.hidden) defaultSelectionRenderer.startAnimation(() => { renderCanvas(false); });
      };
      start();
      document.addEventListener('visibilitychange', start);
      return () => { document.removeEventListener('visibilitychange', start); defaultSelectionRenderer.stopAnimation(); };
    } else {
      defaultSelectionRenderer.stopAnimation();
    }
    return () => defaultSelectionRenderer.stopAnimation();
  }, [currentDoc?.selection?.active, renderCanvas]);

  // Re-render when dependencies change
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // ResizeObserver on viewport container
  useEffect(() => {
    if (!viewportContainerRef.current) return;
    const observer = new ResizeObserver(() => {
      renderCanvas();
    });
    observer.observe(viewportContainerRef.current);
    return () => observer.disconnect();
  }, [renderCanvas]);

  // Keyboard Space key for Pan shortcut & Selection Hotkeys (Ctrl+D, Ctrl+A, Ctrl+Shift+I, V, M, L, W, T, H, Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 文本输入区域（input/textarea/select/contenteditable/[role=textbox] 及其后代）与输入法组合期间不抢占按键
      if (e.defaultPrevented || e.isComposing || isTextEditingTarget(e.target)) return;

      if (e.code === 'Space' && !e.repeat) {
        isSpacePressedRef.current = true;
      }

      if (activeTool === 'select-polygon' && e.key === 'Escape') {
        e.preventDefault(); polygonPointsRef.current = []; polygonHoverRef.current = null; renderCanvas(); return;
      }
      if (activeTool === 'select-polygon' && e.key === 'Backspace') {
        e.preventDefault(); polygonPointsRef.current.pop(); renderCanvas(); return;
      }
      if (activeTool === 'select-polygon' && e.key === 'Enter') {
        e.preventDefault();
        const points = [...polygonPointsRef.current];
        if (currentDoc && canClosePolygon(points)) {
          void createSelection(currentDoc.id, { geometric: { shape: 'polygon', points }, mode: polygonModeRef.current, feather: selectionFeather }).then(() => renderCanvas());
        }
        polygonPointsRef.current = []; polygonHoverRef.current = null; renderCanvas(); return;
      }
      if (activeTool === 'crop' && e.key === 'Escape') {
        e.preventDefault(); cropDraftRef.current = null; setHasCropDraft(false); renderCanvas(); return;
      }
      if (activeTool === 'crop' && e.key === 'Enter' && currentDoc && cropDraftRef.current) {
        e.preventDefault(); setCropRect(currentDoc.id, cropDraftRef.current);
        cropDraftRef.current = null; setHasCropDraft(false); setStatusMessage('已应用无损裁剪'); return;
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        defaultCommandBus.undo();
        return;
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        defaultCommandBus.redo();
        return;
      }

      // Clipboard Copy / Paste
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !e.shiftKey && currentDoc) {
        e.preventDefault();
        copyActiveLayerToClipboard(currentDoc.id).catch((err) => {
          console.warn('[EditWorkspace] Failed to copy layer to clipboard:', err);
        });
        return;
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !e.shiftKey && currentDoc) {
        e.preventDefault();
        pasteClipboardImageToDocument(currentDoc.id).catch((err) => {
          console.warn('[EditWorkspace] Failed to paste image from clipboard:', err);
        });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && currentDoc) {
        e.preventDefault();
        clearSelection(currentDoc.id);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && currentDoc) {
        e.preventDefault();
        selectAll(currentDoc.id);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i' && currentDoc) {
        e.preventDefault();
        invertSelection(currentDoc.id);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const shortcutTool = findToolByShortcut(k, activeTool, lastUsedTools);
        if (shortcutTool) selectEditTool(shortcutTool);
        else if (k === 'x') defaultColorState.swapColors();
        else if (k === 'd') defaultColorState.resetColors();
        else if (k === '[') {
          setBrushSettings((prev) => ({ ...prev, size: Math.max(1, prev.size - 5) }));
        } else if (k === ']') {
          setBrushSettings((prev) => ({ ...prev, size: Math.min(300, prev.size + 5) }));
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [currentDoc, activeTool, lastUsedTools, selectionFeather, clearSelection, selectAll, invertSelection, createSelection, setCropRect, renderCanvas]);

  // Helper: map canvas click client pos to Document space
  const getDocCoords = (clientX: number, clientY: number) => {
    if (!canvasRef.current || !currentDoc) return { docX: 0, docY: 0 };
    return editCanvasCoordinates(canvasRef.current, currentDoc, { zoom, panX, panY }, clientX, clientY);
  };

  // Canvas Pointer Down (Unified Mouse, Stylus/Pen with Pressure, Touch)
  const handlePointerDown = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentDoc || !canvasRef.current) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if setPointerCapture is unsupported in mock environments
    }

    const { docX, docY } = getDocCoords(e.clientX, e.clientY);
    const input = extractPointerInput(e, { docX, docY });

    // Pan mode (Space key, Hand tool, or Middle Click)
    if (isSpacePressedRef.current || activeTool === 'hand' || input.button === 1) {
      isPanningRef.current = true;
      dragStartRef.current.screenMouseX = input.x;
      dragStartRef.current.screenMouseY = input.y;
      dragStartRef.current.startPanX = panX;
      dragStartRef.current.startPanY = panY;
      return;
    }

    // Zoom tool
    if (activeTool === 'zoom') {
      const factor = input.altKey ? 0.75 : 1.35;
      const next = zoomAtCanvasPoint(canvasRef.current, currentDoc, { zoom, panX, panY }, zoom * factor, e.clientX, e.clientY);
      setZoom(next.zoom);
      setPan(next.panX, next.panY);
      return;
    }

    // Eyedropper Tool
    if (activeTool === 'eyedropper' && input.button === 0) {
      const request = ++colorSampleRequest.current;
      try {
        const sample = await sampleDocumentColor(currentDoc, docX, docY, eyedropperSize);
        if (request !== colorSampleRequest.current || defaultDocumentManager.getActiveDocument()?.id !== currentDoc.id) return;
        if (input.altKey) defaultColorState.setBackground(sample.hex);
        else defaultColorState.setForeground(sample.hex);
        setStatusMessage(`已取样 ${sample.hex}（${sample.x}, ${sample.y}）`);
      } catch (error) {
        if (request === colorSampleRequest.current) setStatusMessage(error instanceof Error ? error.message : '取色失败，请重试。');
      }
      return;
    }

    if (selectedLayer && ['brush', 'spot-heal', 'clone-stamp', 'gradient'].includes(activeTool)
      && !(activeTool === 'clone-stamp' && input.altKey) && isLayerLocked(currentDoc, selectedLayer.id)) {
      setStatusMessage('图层或父图层组已锁定，请先解锁。'); return;
    }

    // Brush Tool
    if (activeTool === 'brush' && input.button === 0) {
      e.preventDefault();
      renderScheduler.current.cancel();

      let targetLayer: Layer | null = selectedLayer && (selectedLayer.type === 'paint' || selectedLayer.type === 'retouch')
        ? selectedLayer
        : currentDoc.layers.find(l => l.type === 'paint' || l.type === 'retouch') || null;

      if (!targetLayer) {
        const newLayer = createPaintLayer({
          name: '绘画图层',
          rasterAssetId: '',
          width: currentDoc.width,
          height: currentDoc.height,
        });
        defaultCommandBus.execute(new CreateLayerCommand(currentDoc.id, newLayer, defaultDocumentManager));
        targetLayer = newLayer;
        selectLayer(newLayer.id);
      }
      const activeLayer = targetLayer;
      const paintDocument = defaultDocumentManager.getEditDocument(currentDoc.id)!;
      try { assertLayerEditable(paintDocument, activeLayer.id); }
      catch (error) { setStatusMessage(error instanceof Error ? error.message : String(error)); return; }
      const rasterWidth = activeLayer.naturalWidth;
      const rasterHeight = activeLayer.naturalHeight;
      const initialPoint = layerRasterPoint(paintDocument, activeLayer.id, docX, docY);

      const fgColor = defaultColorState.getState().foreground;
      const initialAssetId = 'rasterAssetId' in activeLayer ? (activeLayer as any).rasterAssetId : '';

      // Initialize live overlay canvas and configure its mirror context
      let mirrorCtx: CanvasRenderingContext2D | null = null;
      if (overlayCanvasRef.current && canvasRef.current) {
        const overlay = overlayCanvasRef.current;
        const mainCanvas = canvasRef.current;
        if (overlay.width !== mainCanvas.width) overlay.width = mainCanvas.width;
        if (overlay.height !== mainCanvas.height) overlay.height = mainCanvas.height;

        const ctx = overlay.getContext('2d');
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, overlay.width, overlay.height);

          const baseScale = Math.min(mainCanvas.width / currentDoc.width, mainCanvas.height / currentDoc.height);
          const scale = baseScale * zoom;
          const offsetX = (mainCanvas.width - currentDoc.width * scale) / 2 + panX;
          const offsetY = (mainCanvas.height - currentDoc.height * scale) / 2 + panY;

          ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
          ctx.transform(...layerWorldMatrix(paintDocument, activeLayer.id));
          ctx.scale(activeLayer.transform.width / rasterWidth, activeLayer.transform.height / rasterHeight);
          ctx.globalAlpha = Math.max(0, Math.min(1, activeLayer.opacity));
          if (activeLayer.blendMode && activeLayer.blendMode !== 'normal') {
            ctx.globalCompositeOperation = activeLayer.blendMode;
          }
          mirrorCtx = ctx;
        }
      }

      try { await defaultBrushEngine.startStroke(
        {
          documentId: currentDoc.id,
          layerId: activeLayer.id,
          initialPoint: { ...initialPoint, pressure: input.pressure },
          settings: { ...brushSettings, color: fgColor },
          initialAssetId,
          width: rasterWidth,
          height: rasterHeight,
        },
        mirrorCtx
      ); } catch (error) { defaultBrushEngine.cancelStroke(); setStatusMessage(error instanceof Error ? error.message : String(error)); }
      return;
    }

    // Spot Healing Tool
    if (activeTool === 'spot-heal' && input.button === 0) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          defaultRetouchEngine.applySpotHealing({
            ctx,
            center: { x: docX, y: docY },
            settings: brushSettings,
          });
          setStatusMessage(`已修复污点（${Math.round(docX)}, ${Math.round(docY)}）`);
          renderCanvas();
        }
      }
      return;
    }

    // Clone Stamp Tool
    if (activeTool === 'clone-stamp' && input.button === 0) {
      if (input.altKey) {
        defaultRetouchEngine.setSourcePoint({ x: docX, y: docY, layerId: selectedLayer?.id });
        setStatusMessage(`已设置仿制源（${Math.round(docX)}, ${Math.round(docY)}）`);
        return;
      }
      defaultRetouchEngine.beginStroke({ x: docX, y: docY });
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          defaultRetouchEngine.applyCloneStampDab({
            sourceCtx: ctx,
            targetCtx: ctx,
            targetPoint: { x: docX, y: docY },
            settings: brushSettings,
          });
          renderCanvas();
        }
      }
      return;
    }

    // Gradient Tool
    if (activeTool === 'gradient' && input.button === 0) {
      gradientStartRef.current = { x: docX, y: docY };
      gradientEndRef.current = { x: docX, y: docY };
      isDrawingGradientRef.current = true;
      return;
    }

    // Crop Tool (drag to define crop rect)
    if (activeTool === 'crop' && input.button === 0) {
      cropDraftRef.current = null;
      setHasCropDraft(false);
      isDrawingSelectionRef.current = true;
      selectionStartRef.current = { x: docX, y: docY };
      currentSelectionPosRef.current = { x: docX, y: docY };
      return;
    }

    if (activeTool === 'select-polygon' && input.button === 0) {
      e.preventDefault();
      if (e.detail >= 2) {
        const points = [...polygonPointsRef.current];
        if (canClosePolygon(points)) {
          await createSelection(currentDoc.id, { geometric: { shape: 'polygon', points }, mode: polygonModeRef.current, feather: selectionFeather });
        }
        polygonPointsRef.current = []; polygonHoverRef.current = null; renderCanvas();
      } else {
        if (!polygonPointsRef.current.length) polygonModeRef.current = resolveSelectionMode(selectionMode, input.shiftKey, input.altKey);
        polygonPointsRef.current = [...polygonPointsRef.current, { x: docX, y: docY }];
        polygonHoverRef.current = { x: docX, y: docY };
        renderCanvas();
      }
      return;
    }

    // Selection Tools (Rect, Ellipse, Lasso, Object)
    if (['select-rect', 'select-ellipse', 'select-lasso', 'select-object'].includes(activeTool) && input.button === 0) {
      selectionGestureModeRef.current = resolveSelectionMode(selectionMode, input.shiftKey, input.altKey);
      isDrawingSelectionRef.current = true;
      selectionStartRef.current = { x: docX, y: docY };
      currentSelectionPosRef.current = { x: docX, y: docY };

      if (activeTool === 'select-lasso') {
        lassoPointsRef.current = [{ x: docX, y: docY }];
      }
      return;
    }

    // Move tool
    if (activeTool === 'move' && input.button === 0) {
      const hitLayer = autoSelectLayer ? hitTestLayerTree(currentDoc, docX, docY) : null;

      if (hitLayer) {
        selectLayer(hitLayer.id);
        if (isLayerLocked(currentDoc, hitLayer.id)) { setStatusMessage('图层已锁定，无法移动。'); return; }
        isDraggingLayerRef.current = true;
        draggedLayerIdRef.current = hitLayer.id;
        dragStartRef.current.mouseDocX = docX;
        dragStartRef.current.mouseDocY = docY;
        dragStartRef.current.layerStartX = hitLayer.transform.x;
        dragStartRef.current.layerStartY = hitLayer.transform.y;
        startMoveLayerDrag(currentDoc.id);
      } else if (selectedLayer) {
        // Explicit selection uses its own world geometry, independent of overlapping siblings.
        if (hitTestLayerTree(currentDoc, docX, docY, selectedLayer.id)) {
          if (isLayerLocked(currentDoc, selectedLayer.id)) { setStatusMessage('图层已锁定，无法移动。'); return; }
          isDraggingLayerRef.current = true;
          draggedLayerIdRef.current = selectedLayer.id;
          dragStartRef.current.mouseDocX = docX;
          dragStartRef.current.mouseDocY = docY;
          dragStartRef.current.layerStartX = selectedLayer.transform.x;
          dragStartRef.current.layerStartY = selectedLayer.transform.y;
          startMoveLayerDrag(currentDoc.id);
        } else if (autoSelectLayer) {
          selectLayer(null);
        }
      }
    }
  };

  // Canvas Pointer Move
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentDoc) return;
    const { docX, docY } = getDocCoords(e.clientX, e.clientY);
    const input = extractPointerInput(e, { docX, docY });

    if (activeTool === 'select-polygon' && polygonPointsRef.current.length) {
      polygonHoverRef.current = { x: docX, y: docY };
      renderCanvas();
      return;
    }

    if (isPanningRef.current) {
      const dx = (input.x - dragStartRef.current.screenMouseX) * (window.devicePixelRatio || 1);
      const dy = (input.y - dragStartRef.current.screenMouseY) * (window.devicePixelRatio || 1);
      setPan(dragStartRef.current.startPanX + dx, dragStartRef.current.startPanY + dy);
      return;
    }

    if (activeTool === 'brush' && defaultBrushEngine.isPainting) {
      let mirrorCtx: CanvasRenderingContext2D | null = null;
      if (overlayCanvasRef.current) {
        mirrorCtx = overlayCanvasRef.current.getContext('2d');
      }
      const stroke = defaultBrushEngine.getActiveStroke()!;
      try {
        assertLayerEditable(currentDoc, stroke.layerId);
        const point = layerRasterPoint(currentDoc, stroke.layerId, docX, docY);
        defaultBrushEngine.addPoint({ ...point, pressure: input.pressure }, mirrorCtx);
      } catch (error) { defaultBrushEngine.cancelStroke(); setStatusMessage(error instanceof Error ? error.message : String(error)); }
      return;
    }

    if (selectedLayer && ['clone-stamp', 'spot-heal'].includes(activeTool) && isLayerLocked(currentDoc, selectedLayer.id)) return;

    if (activeTool === 'clone-stamp' && defaultRetouchEngine.getSourcePoint() && input.buttons === 1 && !input.altKey) {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          defaultRetouchEngine.applyCloneStampDab({
            sourceCtx: ctx,
            targetCtx: ctx,
            targetPoint: { x: docX, y: docY },
            settings: brushSettings,
          });
          renderCanvas();
        }
      }
      return;
    }

    if (activeTool === 'gradient' && isDrawingGradientRef.current) {
      gradientEndRef.current = { x: docX, y: docY };
      renderCanvas();
      return;
    }

    if (isDrawingSelectionRef.current) {
      currentSelectionPosRef.current = { x: docX, y: docY };
      if (activeTool === 'select-lasso') {
        lassoPointsRef.current.push({ x: docX, y: docY });
      }
      renderCanvas();
      return;
    }

    if (isDraggingLayerRef.current && draggedLayerIdRef.current && canvasRef.current) {
      const movingLayer = findLayer(currentDoc.layers, draggedLayerIdRef.current);
      if (!movingLayer) return;
      const dx = docX - dragStartRef.current.mouseDocX;
      const dy = docY - dragStartRef.current.mouseDocY;

      if (isLayerLocked(currentDoc, movingLayer.id)) { isDraggingLayerRef.current = false; commitMoveLayerDrag(); setStatusMessage('图层或父图层组已锁定。'); return; }
      let delta: { x: number; y: number };
      try { delta = documentDeltaToParent(currentDoc, movingLayer.id, dx, dy); }
      catch (error) { isDraggingLayerRef.current = false; commitMoveLayerDrag(); setStatusMessage(error instanceof Error ? error.message : String(error)); return; }
      const newX = Math.round(dragStartRef.current.layerStartX + delta.x);
      const newY = Math.round(dragStartRef.current.layerStartY + delta.y);
      const next = resolveLayerMove({
        layer: movingLayer, x: newX, y: newY,
        canvasWidth: currentDoc.width, canvasHeight: currentDoc.height,
        otherLayers: currentDoc.layers.filter(layer => layer.id !== movingLayer.id),
        userGuides: currentDoc.guides,
        documentPixelsPerScreenPixel: documentPixelsPerCssPixel(canvasRef.current, currentDoc, zoom),
        enabled: snapEnabled && !locateLayer(currentDoc.layers, movingLayer.id)?.parent, bypass: input.altKey,
      });
      if (!next) return;
      snapGuidesRef.current = next.guides;
      previewMoveLayerDrag(currentDoc.id, movingLayer.id, Math.round(next.x), Math.round(next.y));
      renderCanvas();
    }
  };

  // Canvas Pointer Up / Cancel
  const handlePointerUp = async (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e && e.currentTarget && typeof e.currentTarget.hasPointerCapture === 'function') {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
    }

    if (isPanningRef.current) {
      isPanningRef.current = false;
    }

    if (isDraggingLayerRef.current) {
      isDraggingLayerRef.current = false;
      draggedLayerIdRef.current = null;
      snapGuidesRef.current = [];
      commitMoveLayerDrag();
      renderCanvas();
    }

    if (activeTool === 'brush' && defaultBrushEngine.isPainting) {
      const offCanvas = defaultBrushEngine.getOffscreenCanvas();
      let cmd;
      try { cmd = await defaultBrushEngine.endStroke(defaultCommandBus, defaultDocumentManager); }
      catch (error) { defaultBrushEngine.cancelStroke(); setStatusMessage(error instanceof Error ? error.message : String(error)); }
      if (cmd && offCanvas && 'finalAssetId' in cmd) {
        const copyCanvas = document.createElement('canvas');
        copyCanvas.width = offCanvas.width;
        copyCanvas.height = offCanvas.height;
        copyCanvas.getContext('2d')?.drawImage(offCanvas, 0, 0);
        defaultImageEngine.setLoadedSource((cmd as any).finalAssetId, copyCanvas, copyCanvas.width, copyCanvas.height);
      }
      if (overlayCanvasRef.current) {
        const overlayCtx = overlayCanvasRef.current.getContext('2d');
        if (overlayCtx) {
          overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
          overlayCtx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
        }
      }
      renderCanvas();
      return;
    }

    if (activeTool === 'clone-stamp') {
      defaultRetouchEngine.endStroke();
    }

    if (activeTool === 'gradient' && isDrawingGradientRef.current && currentDoc) {
      isDrawingGradientRef.current = false;
      const start = gradientStartRef.current;
      const end = gradientEndRef.current;
      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      if (dist > 5) {
        let targetLayer = selectedLayer;
        if (!targetLayer || targetLayer.type !== 'paint') {
          await addPaintLayer(currentDoc.id, '渐变图层');
          const updatedDoc = defaultDocumentManager.getEditDocument(currentDoc.id);
          targetLayer = updatedDoc?.layers[updatedDoc.layers.length - 1] || null;
        }
        if (targetLayer && targetLayer.type === 'paint') {
          const expected = defaultDocumentManager.getEditDocument(currentDoc.id)!;
          try { assertLayerEditable(expected, targetLayer.id); } catch (error) { setStatusMessage(error instanceof Error ? error.message : String(error)); return; }
          const offCanvas = document.createElement('canvas');
          offCanvas.width = currentDoc.width;
          offCanvas.height = currentDoc.height;
          const offCtx = offCanvas.getContext('2d');
          if (offCtx) {
            defaultGradientRenderer.renderGradient(offCtx, {
              type: gradientType,
              preset: gradientPreset,
              startX: start.x,
              startY: start.y,
              endX: end.x,
              endY: end.y,
            });
            const blob = await new Promise<Blob | null>((res) => offCanvas.toBlob(res, 'image/png'));
            if (blob) {
              const handle = await defaultAssetManager.registerBlob(blob, 'image', 'Gradient', { width: offCanvas.width, height: offCanvas.height });
              const cmd = new DrawGradientCommand(
                currentDoc.id,
                targetLayer.id,
                false,
                (targetLayer as any).rasterAssetId || '',
                handle.id,
                defaultDocumentManager
              );
              try { assertCurrentLayer(defaultDocumentManager, expected, targetLayer.id); await defaultCommandBus.execute(cmd); }
              catch (error) { defaultAssetManager.releaseAsset(handle.id); setStatusMessage(error instanceof Error ? error.message : String(error)); return; }
              renderCanvas();
            }
          }
        }
      }
    }

    if (isDrawingSelectionRef.current && currentDoc) {
      isDrawingSelectionRef.current = false;
      const start = selectionStartRef.current;
      const end = currentSelectionPosRef.current;
      const sx = Math.min(start.x, end.x);
      const sy = Math.min(start.y, end.y);
      const sw = Math.abs(end.x - start.x);
      const sh = Math.abs(end.y - start.y);

      if (activeTool === 'crop') {
        const draft = constrainDragRect(start, end, cropRatio, currentDoc.width, currentDoc.height);
        cropDraftRef.current = draft.width > 10 && draft.height > 10 ? draft : null;
        setHasCropDraft(!!cropDraftRef.current);
      } else if (activeTool === 'select-rect' && sw > 2 && sh > 2) {
        await createSelection(currentDoc.id, {
          geometric: {
            shape: 'rectangle',
            rect: { x: sx, y: sy, width: sw, height: sh },
          }, mode: selectionGestureModeRef.current, feather: selectionFeather,
        });
      } else if (activeTool === 'select-ellipse' && sw > 2 && sh > 2) {
        await createSelection(currentDoc.id, {
          geometric: {
            shape: 'ellipse',
            rect: { x: sx, y: sy, width: sw, height: sh },
          }, mode: selectionGestureModeRef.current, feather: selectionFeather,
        });
      } else if (activeTool === 'select-lasso' && lassoPointsRef.current.length > 2) {
        await createSelection(currentDoc.id, {
          geometric: {
            shape: 'polygon',
            points: [...lassoPointsRef.current],
          }, mode: selectionGestureModeRef.current, feather: selectionFeather,
        });
        lassoPointsRef.current = [];
      } else if (activeTool === 'select-object') {
        const result = await new SelectObjectTool().execute({ documentManager: defaultDocumentManager, commandBus: defaultCommandBus, currentWorkspace: 'edit' }, {
          documentId: currentDoc.id,
          ...(sw > 10 && sh > 10 ? { box: { x: sx, y: sy, width: sw, height: sh } } : { x: start.x, y: start.y })
        }, 'object-selection-pointer');
        if (!result.success) setStatusMessage(result.error?.message || '对象选择失败。');
      }

      renderCanvas();
    }
  };

  // Canvas Wheel for Zoom / Pan
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const preferences = getStudioPreferences();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvasRef.current?.clientHeight || 800 : 1);
      const factor = wheelZoomFactor(delta, preferences.wheelDirection, preferences.wheelSpeed);
      if (canvasRef.current && currentDoc) {
        const { zoom: currentZoom, panX: currentPanX, panY: currentPanY } = useEditStore.getState();
        const next = zoomAtCanvasPoint(canvasRef.current, currentDoc, { zoom: currentZoom, panX: currentPanX, panY: currentPanY }, currentZoom * factor, e.clientX, e.clientY);
        setZoom(next.zoom);
        setPan(next.panX, next.panY);
      }
    } else {
      // Pan
      const dpr = window.devicePixelRatio || 1;
      setPan(panX - e.deltaX * dpr, panY - e.deltaY * dpr);
    }
  };

  // Add Raster Image as Layer via Native Dialog
  const handleAddImageLayer = async () => {
    if (!currentDoc) return;
    try {
      const bridge = getPlatformBridge();
      const file = await bridge.openFileDialog({
        title: '选择要置入的图片',
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }
        ]
      });

      if (file) {
        let blob: Blob | null = file.blob || null;
        if (!blob && file.path) {
          const bytes = await bridge.readBinaryFile(file.path);
          blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
        }

        if (blob) {
          // Decode before creating the layer so the layer uses the image's real pixel size.
          const prepared = await prepareImageLayer(blob, file.name, {
            assets: defaultAssetManager,
            load: (id, source) => defaultImageEngine.loadAsset(id, source),
            decode: decodeImageDimensions,
          });

          addImageLayer(
            currentDoc.id,
            file.name,
            prepared.id,
            prepared.width,
            prepared.height
          );
        }
      }
    } catch (err) {
      console.error('Failed to import image layer:', err);
      alert('导入图片失败：' + (err instanceof Error ? err.message : String(err)) + '。请确认图片为 PNG、JPEG、WebP 或 BMP 格式后重试。');
    }
  };

  if (!currentDoc) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center text-center p-6 space-y-4 workspace-empty">
        <LayersIcon />
        <div className="space-y-1">
          <h2>尚未打开画布</h2>
          <p className="max-w-sm">
            新建画布或打开一张图片，即可开始图层合成与调色。
          </p>
        </div>
        <button
          onClick={() => setWorkspace('home')}
          className="bg-studio-800 hover:bg-studio-700 text-studio-200 text-xs px-4 py-1.5 rounded border border-studio-700 cursor-pointer"
        >
          返回首页
        </button>
      </div>
    );
  }

  const cursorClass =
    activeTool === 'hand' || isSpacePressedRef.current
      ? 'cursor-grab active:cursor-grabbing'
      : activeTool === 'zoom'
      ? 'cursor-zoom-in'
      : activeTool === 'move'
      ? 'cursor-move'
      : activeTool === 'eyedropper'
      ? 'cursor-crosshair'
      : activeTool === 'brush' || activeTool === 'spot-heal' || activeTool === 'clone-stamp'
      ? 'cursor-crosshair'
      : ['select-rect', 'select-ellipse', 'select-lasso', 'select-object', 'crop', 'gradient'].includes(activeTool)
      ? 'cursor-crosshair'
      : 'cursor-default';

  return (
    <div className="h-full w-full bg-studio-950 flex flex-col overflow-hidden select-none studio-workspace edit-workbench">
      {/* Top Options & Actions Bar */}
      <div className="edit-operation-bar h-8 bg-studio-900 border-b border-studio-800 px-3 flex items-center justify-between text-2xs">
        <div className="edit-document-info flex items-center space-x-3">
          <span className="font-semibold text-studio-200 truncate max-w-[220px]" title={currentDoc.name}>{currentDoc.name}</span>
          <span className="edit-document-dimensions text-studio-500 font-mono">
            {currentDoc.width} × {currentDoc.height} px
          </span>

          {/* 文档修改状态：文字与圆点同时表达，不依赖颜色 */}
          <span
            className="flex items-center space-x-1.5 shrink-0"
            title={currentDoc.isDirty ? '有未保存的修改' : '没有未保存的修改'}
          >
            <span className={currentDoc.isDirty ? 'dirty-dot' : 'w-[5px] h-[5px] rounded-full bg-studio-700'} />
            <span className={currentDoc.isDirty ? 'text-studio-200' : 'text-studio-500'}>
              {currentDoc.isDirty ? '已修改' : '未修改'}
            </span>
          </span>

          <div className="h-3 w-px bg-studio-800" />

          {/* Zoom Controls */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setZoom(zoom * 0.8)}
              className="p-1 text-studio-400 hover:text-studio-200 cursor-pointer"
              title="缩小"
              aria-label="缩小"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="font-mono text-studio-300 w-12 text-center" aria-label="图像缩放比例">
              {(displayScale * 100).toFixed(displayScale < 0.1 ? 1 : 0)}%
            </span>
            <button
              onClick={() => setZoom(zoom * 1.2)}
              className="p-1 text-studio-400 hover:text-studio-200 cursor-pointer"
              title="放大"
              aria-label="放大"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              onClick={() => resetViewport()}
              className="px-1.5 py-0.5 rounded bg-studio-800 hover:bg-studio-700 text-studio-300 border border-studio-700 ml-1 cursor-pointer"
              title="适应窗口"
            >
              适应窗口
            </button>
            <button
              onClick={() => {
                if (!canvasRef.current) return;
                setZoom(editActualSizeZoom(canvasRef.current, currentDoc));
                setPan(0, 0);
              }}
              className="px-1.5 py-0.5 rounded bg-studio-800 hover:bg-studio-700 text-studio-300 border border-studio-700 cursor-pointer"
              title="按 100% 显示"
            >
              100%
            </button>
          </div>

          {statusMessage && (
            <span
              role="status"
              aria-live="polite"
              className="edit-document-status text-studio-300 text-2xs truncate max-w-xs"
            >
              {statusMessage}
            </span>
          )}
        </div>

        {/* Right Side: Export Buttons */}
        <div className="edit-operation-actions flex items-center space-x-2">
          <button
            onClick={onExport}
            className="flex items-center space-x-1 bg-studio-800 hover:bg-studio-700 text-studio-200 px-2.5 py-1 rounded border border-studio-700 transition-colors cursor-pointer"
            title="导出合成成品为 JPEG 或 PNG"
          >
            <Download className="w-3 h-3 text-sky-400" />
            <span>导出成品…</span>
          </button>
        </div>
      </div>

      {cutoutOpen && selectedLayerId && findLayer(currentDoc.layers, selectedLayerId) && <CutoutDialog doc={currentDoc} layer={findLayer(currentDoc.layers, selectedLayerId)!} onClose={() => setCutoutOpen(false)} />}
      {/* Contextual Top Tool Options Bar */}
      <ContextToolbar
        activeTool={activeTool}
        selectionMode={selectionMode}
        onChangeSelectionMode={setSelectionMode}
        selectionFeather={selectionFeather}
        onChangeSelectionFeather={setSelectionFeather}
        cropRatio={cropRatio}
        onChangeCropRatio={setCropRatio}
        hasCropDraft={hasCropDraft}
        autoSelectLayer={autoSelectLayer}
        onChangeAutoSelectLayer={setAutoSelectLayer}
        snapEnabled={snapEnabled}
        onChangeSnapEnabled={setSnapEnabled}
        showTransformControls={showTransformControls}
        onChangeShowTransformControls={setShowTransformControls}
        brushSettings={brushSettings}
        onChangeBrushSettings={(s) => setBrushSettings((prev) => ({ ...prev, ...s }))}
        eyedropperSize={eyedropperSize}
        onChangeEyedropperSize={setEyedropperSize}
        gradientType={gradientType}
        onChangeGradientType={setGradientType}
        gradientPreset={gradientPreset}
        onChangeGradientPreset={setGradientPreset}
        onApplyCrop={() => {
          if (currentDoc && cropDraftRef.current) {
            setCropRect(currentDoc.id, cropDraftRef.current);
            cropDraftRef.current = null;
            setHasCropDraft(false);
            setStatusMessage('已应用无损裁剪');
          }
        }}
        onResetCrop={() => {
          cropDraftRef.current = null;
          setHasCropDraft(false);
          renderCanvas();
        }}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Toolbar */}
        <Toolbar
          activeTool={activeTool}
          lastUsedTools={lastUsedTools}
          onSelectTool={selectEditTool}
        />

        {/* Central Canvas Viewport - Neutral 18% Gray Surround (Rule 8 & Stage E) */}
        <main
          ref={viewportContainerRef}
          style={{ backgroundColor: canvasBackground }}
          className="edit-canvas-viewport flex-1 flex items-center justify-center relative overflow-hidden"
        >
          {/* Real Canvas element managed by WebGLImageEngine */}
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            className={`block w-full h-full touch-none ${cursorClass}`}
          />

          {/* Real-time zero-latency live drawing overlay canvas */}
          <canvas
            ref={overlayCanvasRef}
            className="block w-full h-full absolute inset-0 pointer-events-none"
          />

          {/* Contextual Floating Selection Taskbar Pill */}
          <SelectionBar activeTool={activeTool} selectionMode={selectionMode} onChangeSelectionMode={setSelectionMode} canAutoCutout={canCutout} onAutoCutout={() => setCutoutOpen(true)} />
        </main>

        {/* Right Side Panels: Layers & History & Properties */}
        <aside className="editor-side-panel bg-studio-900 border-l border-studio-800 flex flex-col text-xs">
          {/* Panel Tabs Header */}
          <div className="editor-panel-tabs flex border-b border-studio-800 bg-studio-950 text-2xs font-semibold select-none" role="tablist" aria-label="图层与属性面板">
            <button
              onClick={() => setRightPanelTab('layers')}
              role="tab"
              aria-selected={rightPanelTab === 'layers'}
              className={`flex-1 py-2 text-center transition-colors cursor-pointer ${
                rightPanelTab === 'layers'
                  ? 'border-b-2 border-sky-500 text-sky-400 bg-studio-900/60'
                  : 'text-studio-400 hover:text-studio-200'
              }`}
            >
              图层 ({flattenLayerTree(currentDoc.layers).length})
            </button>
            <button
              onClick={() => setRightPanelTab('properties')}
              role="tab"
              aria-selected={rightPanelTab === 'properties'}
              className={`flex-1 py-2 text-center transition-colors cursor-pointer ${
                rightPanelTab === 'properties'
                  ? 'border-b-2 border-sky-500 text-sky-400 bg-studio-900/60'
                  : 'text-studio-400 hover:text-studio-200'
              }`}
            >
              属性
            </button>
          </div>

          {rightPanelTab === 'properties' ? (
            <div className="flex-1 overflow-y-auto">
              <PropertiesPanel
                document={currentDoc}
                selectedLayer={selectedLayer}
                onUpdateAdjustment={(layerId, settings) => setAdjustmentSettings(currentDoc.id, layerId, settings)}
                onUpdateTransform={(layerId, tr) => transformLayer(currentDoc.id, layerId, tr)}
                onUpdateOpacity={(layerId, opacity) => previewOpacityDrag(currentDoc.id, layerId, opacity)}
                onUpdateBlendMode={(layerId, bm) => setLayerBlendMode(currentDoc.id, layerId, bm)}
                onRasterizeSmartObject={async (layerId) => {
                  const key = `${currentDoc.id}:${layerId}`;
                  if (rasterizationRequests.current.has(key)) return;
                  rasterizationRequests.current.add(key);
                  setStatusMessage('正在栅格化智能对象…');
                  try {
                    await rasterizeSmartObject(currentDoc.id, layerId);
                    setStatusMessage('智能对象已栅格化，滤镜效果已保留');
                  } catch (error) {
                    setStatusMessage(`栅格化失败：${error instanceof Error ? error.message : String(error)}`);
                  } finally {
                    rasterizationRequests.current.delete(key);
                  }
                }}
                onAddSmartFilter={(layerId, type) => addSmartFilter(currentDoc.id, layerId, type)}
                onUpdateSmartFilter={(layerId, filterId, patch) => updateSmartFilter(currentDoc.id, layerId, filterId, patch)}
                onSetSmartFilterEnabled={(layerId, filterId, enabled) => setSmartFilterEnabled(currentDoc.id, layerId, filterId, enabled)}
                onRemoveSmartFilter={(layerId, filterId) => removeSmartFilter(currentDoc.id, layerId, filterId)}
                onReorderSmartFilter={(layerId, filterId, toIndex) => reorderSmartFilter(currentDoc.id, layerId, filterId, toIndex)}
              />
            </div>
          ) : (
            <>
              <LayersPanel
                document={currentDoc}
                selectedLayer={selectedLayer}
                selectedLayerId={selectedLayerId}
                newTextPrompt={newTextPrompt}
                onChangeNewTextPrompt={setNewTextPrompt}
                onAddImageLayer={handleAddImageLayer}
                onShowProperties={() => setRightPanelTab('properties')}
              />
              <HistoryPanel />
            </>
          )}
        </aside>
      </div>
    </div>
  );
};
