// src/ui/workspaces/develop/DevelopWorkspace.tsx
//! Comprehensive Camera RAW & Raster Photo Develop Workspace
//! Features: High-density Apple HIG UI, Scrubbable inputs, 7 Accordion sections,
//! 8-channel HSL mixer, 1D LUT tone curves, Before/After comparison, and Pipeline Inspector.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sliders,
  RotateCcw,
  Download,
  ArrowRightLeft,
  Info,
  Thermometer,
  Sun,
  Palette,
  Sparkles,
  AlertCircle,
  Loader2,
  Activity,
  Eye,
  EyeOff,
  Focus,
  Disc,
  ZoomIn,
  ZoomOut,
  Hand,
  PanelLeft,
  Pipette,
  Copy,
  ClipboardPaste,
} from 'lucide-react';
import { useDevelopStore } from '../../../stores/useDevelopStore';
import { useAppStore } from '../../../stores/useAppStore';
import { defaultImageEngine, DevelopGpuError } from '../../../engine/WebGLImageEngine';
import { getRawSpatialAnalysis } from '../../../app/rawSpatialAnalysis';
import { defaultHistogramScheduler } from '../../../engine/HistogramScheduler';
import { isTextEditingTarget } from '../../../app/keyboard';
import { WhiteBalanceMode, DevelopSettings } from '../../../types/develop';
import { ColorChannel } from '../../../types/common';
import { createDefaultDevelopSettings } from '../../../document/DevelopDocument';
import { HistogramView } from './HistogramView';
import { fitPreviewDimensions } from './previewDimensions';
import { AccordionSection } from '../../shared/AccordionSection';
import { ScrubbableInput } from '../../shared/ScrubbableInput';
import { SegmentedControl } from '../../shared/SegmentedControl';
import { CurveEditor } from './CurveEditor';
import { DevelopSettingsMenu, type DevelopSettingsMenuHandle } from './DevelopSettingsMenu';
import { ContextMenuScope, useContextMenu, type ContextMenuItem } from '../../shared/ContextMenu';
import { guardMenuDocument } from '../../shared/contextMenuTargets';
import { defaultDocumentManager } from '../../../document/DocumentManager';
import type { DevelopSettingsGroup } from '../../../develop/DevelopSettingsClipboard';
import { PipelineDebugInspector } from './PipelineDebugInspector';
import { PARAM_DEFINITIONS } from '../../shared/parameterDefinitions';
import { defaultDevelopOperations } from '../../../develop/DevelopOperationService';
import { LatestPreviewScheduler } from '../../../develop/LatestPreviewScheduler';
import { ReusablePreviewSurface } from '../../../develop/ReusablePreviewSurface';
import { useStudioPreferences } from '../../../stores/useStudioPreferences';
import { checkerStyle } from '../edit/canvasPreferences';
import { DevelopLooksPanel } from './DevelopLooksPanel';
import { defaultDevelopAutoTone } from '../../../develop/DevelopAutoToneService';
import { DevelopMaskPanel } from './DevelopMaskPanel';
import { DevelopMaskOverlay, MaskDrawMode } from './DevelopMaskOverlay';
import { useDevelopViewport } from './useDevelopViewport';
import { useRawDetailPreview } from './useRawDetailPreview';
import { DevelopToolBrowser } from './DevelopToolBrowser';
import type { DevelopGroup } from './developTools';
import { PreviewClippingOverlay } from './PreviewClippingOverlay';
import { previewPixelAt, srgb8ToLabD50, type ClippingCounts } from './colorInspection';
import { ReferencePreviewCache, referencePreviewKey } from './referencePreviewCache';
import { defaultAssetManager } from '../../../assets/AssetManager';
import './developWorkspace.css';

const WB_SEGMENT_OPTIONS: { id: WhiteBalanceMode; label: string }[] = [
  { id: 'as-shot', label: '原照' },
  { id: 'auto', label: '自动' },
  { id: 'custom', label: '手动' },
];

const HSL_CHANNELS: { id: ColorChannel; label: string; dotColor: string }[] = [
  { id: 'red', label: '红', dotColor: '#ef4444' },
  { id: 'orange', label: '橙', dotColor: '#f97316' },
  { id: 'yellow', label: '黄', dotColor: '#eab308' },
  { id: 'green', label: '绿', dotColor: '#22c55e' },
  { id: 'aqua', label: '浅蓝', dotColor: '#06b6d4' },
  { id: 'blue', label: '蓝', dotColor: '#3b82f6' },
  { id: 'purple', label: '紫', dotColor: '#a855f7' },
  { id: 'magenta', label: '洋红', dotColor: '#ec4899' },
];

export const DevelopWorkspace: React.FC<{ onExport: () => void }> = ({ onExport }) => {
  const currentDoc = useDevelopStore((s) => s.currentDoc);
  const settings = useDevelopStore((s) => s.settings);
  const histogramData = useDevelopStore((s) => s.histogramData);
  const setHistogramData = useDevelopStore((s) => s.setHistogramData);
  const rawState = useDevelopStore((s) => s.rawState);
  const rawProgress = useDevelopStore((s) => s.rawProgress);
  const rawError = useDevelopStore((s) => s.rawError);
  const startRawLoadingPipeline = useDevelopStore((s) => s.startRawLoadingPipeline);
  const transferToEditWorkspace = useDevelopStore((s) => s.transferToEditWorkspace);

  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const activeWorkspace = useAppStore((s) => s.currentWorkspace);
  const setStatusMessage = useAppStore((s) => s.setStatusMessage);
  const isAiPanelOpen = useAppStore((s) => s.isAiPanelOpen);
  const toggleAiPanel = useAppStore((s) => s.toggleAiPanel);

  const [paintedSource, setPaintedSource] = useState<string | null>(null);
  const [previewFailure, setPreviewFailure] = useState<{key:string|null;message:string} | null>(null);

  // Develop parameter drag actions (Transaction coalescing, Rule 2)
  const beginSettingDrag = useDevelopStore((s) => s.startSettingDrag);
  const previewSettingDrag = useDevelopStore((s) => s.previewSettingDrag);
  const finishSettingDrag = useDevelopStore((s) => s.commitSettingDrag);
  const resetSection = useDevelopStore((s) => s.resetSection);
  const resetSettings = useDevelopStore((s) => s.resetSettings);
  const setWhiteBalance = useDevelopStore((s) => s.setWhiteBalance);
  const whiteBalanceBusy = useDevelopStore((s) => s.whiteBalanceBusy);
  const whiteBalanceError = useDevelopStore((s) => s.whiteBalanceError);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const comparisonCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderScheduler = useRef(new LatestPreviewScheduler());
  const attachPreviewCanvas = useCallback((canvas:HTMLCanvasElement|null) => {
    renderScheduler.current.cancel();
    canvasRef.current=canvas;
    setPaintedSource(null);
  }, []);
  const previewSurface = useRef<ReusablePreviewSurface | null>(null);
  const referencePreview = useRef(new ReferencePreviewCache<HTMLCanvasElement>());
  const gpuFallbackReason = useRef<string | undefined>(undefined);
  const previewQuality = useStudioPreferences(s => s.preferences.previewQuality);
  const canvasBackground = useStudioPreferences(s => s.preferences.canvasBackground);
  const checkerSize = useStudioPreferences(s => s.preferences.checkerSize);
  const checkerTone = useStudioPreferences(s => s.preferences.checkerTone);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const canvasMenu = useContextMenu(currentDoc?.id, setStatusMessage);
  const settingsMenu = useRef<DevelopSettingsMenuHandle>(null);
  const startSettingDrag = (documentId: string, description: string) => { beginSettingDrag(documentId, description); setIsAdjusting(true); };
  const commitSettingDrag = () => { try { finishSettingDrag(); } finally { setIsAdjusting(false); } };
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isAutoToning, setIsAutoToning] = useState(false);
  const [isCreatingRawVariant, setIsCreatingRawVariant] = useState(false);
  const handleRawVariant = async (mode: 'camera' | 'uncorrected') => {
    if (!currentDoc || isCreatingRawVariant) return;
    setIsCreatingRawVariant(true);
    try {
      await defaultDevelopOperations.createRawVariant(currentDoc.id, mode);
      setStatusMessage(mode === 'camera' ? '已新建校正副本，原工程已保留' : '已新建未校正副本，原工程已保留');
    } catch (error) { setStatusMessage(error instanceof Error ? error.message : String(error)); }
    finally { setIsCreatingRawVariant(false); }
  };
  const autoToneGeneration = useRef(0);
  // Any preview-affecting edit, photo switch or unmount invalidates in-flight analysis.
  useEffect(() => {
    autoToneGeneration.current++;
    defaultDevelopAutoTone.cancel();
    setIsAutoToning(false);
    return () => { autoToneGeneration.current++; defaultDevelopAutoTone.cancel(); };
  }, [currentDoc?.id, currentDoc?.sourceAssetId, currentDoc?.previewAssetId, settings, previewQuality]);
  const handleAutoTone = async () => {
    if (!currentDoc || !settings || isAutoToning || isAdjusting) return;
    const generation = autoToneGeneration.current;
    setIsAutoToning(true);
    try {
      const applied = await defaultDevelopAutoTone.applyWithResult(currentDoc.id, () => generation === autoToneGeneration.current);
      if (applied) setStatusMessage(applied.evidence?.scene==='low-key'
        ? '自动影调完成，已保留暗场氛围；白平衡与色彩调整已保留，可撤销'
        : '自动影调调整完成，可撤销；白平衡与色彩调整已保留');
    } catch (error) {
      if (generation === autoToneGeneration.current) setStatusMessage(`自动调整失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { if (generation === autoToneGeneration.current) setIsAutoToning(false); }
  };
  const [showOriginal, setShowOriginal] = useState(false);
  const [showDebugInspector, setShowDebugInspector] = useState(false);
  const [showPhotoInfo, setShowPhotoInfo] = useState(false);
  const [toolGroup, setToolGroup] = useState<DevelopGroup>('basic');
  const [toolQuery, setToolQuery] = useState('');
  const [colorAssessment, setColorAssessment] = useState(false);
  const [warnShadows, setWarnShadows] = useState(false);
  const [warnHighlights, setWarnHighlights] = useState(false);
  const [clippingCounts, setClippingCounts] = useState<ClippingCounts|null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [inspectedColor, setInspectedColor] = useState<{rgb:number[];lab:[number,number,number];label:string}|null>(null);
  const inspectTime = useRef(0);
  const inspectPreview = (event: React.PointerEvent<HTMLElement>) => {
    if (performance.now()-inspectTime.current < 45) return;
    inspectTime.current = performance.now();
    const candidates = detail.region ? [detail.canvasRef.current, canvasRef.current] : [canvasRef.current];
    if (comparisonId) candidates.push(comparisonCanvasRef.current);
    for (const candidate of candidates) {
      if (!candidate) continue;
      const pixel = previewPixelAt(event.clientX,event.clientY,candidate.getBoundingClientRect(),candidate.width,candidate.height);
      if (!pixel) continue;
      try {
        const data=candidate.getContext('2d')?.getImageData(pixel.x,pixel.y,1,1).data;
        if (data?.[3]) {
          const rgb=Array.from(data.slice(0,3));
          const label=candidate===comparisonCanvasRef.current
            ? (comparisonId==='original'?'原图':currentDoc?.settingsSnapshots?.find(item=>item.id===comparisonId)?.name ?? '快照')
            : candidate===detail.canvasRef.current?'细节':showOriginal?'原图':'概览';
          setInspectedColor({rgb,lab:srgb8ToLabD50(rgb),label});
        } else setInspectedColor(null);
      } catch { setInspectedColor(null); }
      return;
    }
    setInspectedColor(null);
  };
  const [activeHslChannel, setActiveHslChannel] = useState<ColorChannel>('red');
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [showMaskOverlay, setShowMaskOverlay] = useState(true);
  const [maskDrawMode, setMaskDrawMode] = useState<MaskDrawMode | null>(null);
  const viewport = useDevelopViewport(currentDoc?.id, currentDoc?.width ?? 1, currentDoc?.height ?? 1, !!comparisonId, !!maskDrawMode);
  const previewSize = fitPreviewDimensions(currentDoc?.width ?? 1, currentDoc?.height ?? 1, previewQuality, isAdjusting);
  const overviewAsset = currentDoc?.isRaw && currentDoc.rawState !== 'ready'
    ? undefined : currentDoc?.sourceAssetId || currentDoc?.previewAssetId;
  const previewSourceKey = currentDoc && overviewAsset ? `${currentDoc.id}:${overviewAsset}` : null;
  const isPreviewPainted = !!previewSourceKey && paintedSource === previewSourceKey;
  const previewError = rawError || (previewFailure?.key===previewSourceKey ? previewFailure.message : null);
  const overviewHandle = overviewAsset ? defaultAssetManager.getHandle(overviewAsset) : null;
  const detail = useRawDetailPreview({
    documentId: currentDoc?.id,
    nativeAssetId: currentDoc?.isRaw && currentDoc.rawState === 'ready' ? currentDoc.nativeAssetId : null,
    sourceWidth: currentDoc?.width ?? 1,
    sourceHeight: currentDoc?.height ?? 1,
    previewWidth: Math.min(previewSize.width, overviewHandle?.width ?? previewSize.width),
    previewHeight: Math.min(previewSize.height, overviewHandle?.height ?? previewSize.height),
    viewportWidth: viewport.size.width,
    viewportHeight: viewport.size.height,
    scale: viewport.view.scale,
    panX: viewport.view.x,
    panY: viewport.view.y,
    settings: settings ?? undefined,
    original: showOriginal && !comparisonId,
    comparison: !!comparisonId,
    interacting: isAdjusting || !!maskDrawMode,
    onError: setStatusMessage,
  });

  useEffect(() => {
    previewSurface.current = new ReusablePreviewSurface(undefined, canvas => {
      defaultImageEngine.releaseDevelopContext(canvas);
      const gl = canvas.getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = canvas.height = 0;
    });
    return () => {
      renderScheduler.current.cancel();
      previewSurface.current?.dispose();
      previewSurface.current = null;
    };
  }, []);

  // Decode RAW before presenting its editable working image.
  useEffect(() => {
    if (currentDoc && currentDoc.isRaw && currentDoc.rawState === 'unloaded' && currentDoc.sourceUri && !currentDoc.sourceUri.startsWith('photos/')) {
      startRawLoadingPipeline(currentDoc.id);
    }
  }, [currentDoc?.id, currentDoc?.isRaw, currentDoc?.rawState, currentDoc?.sourceUri, startRawLoadingPipeline]);

  // Render into detached canvases so older asynchronous jobs cannot overwrite the visible photo.
  useEffect(() => { referencePreview.current.invalidate(); setComparisonId(null); setShowOriginal(false); setSelectedMaskId(null); setHistogramData(null); setInspectedColor(null); setClippingCounts(null); }, [currentDoc?.id, setHistogramData]);
  useEffect(() => {
    renderScheduler.current.schedule(async isCurrent => {
      try {
      if (!currentDoc || !settings || !canvasRef.current) return;
      const assetId = overviewAsset;
      if (!assetId) return;
      const size = fitPreviewDimensions(currentDoc.width, currentDoc.height, previewQuality, isAdjusting);
      const original = showOriginal || comparisonId === 'original' ? createDefaultDevelopSettings(currentDoc.isRaw) : null;
      const paint = async (values: DevelopSettings, target: HTMLCanvasElement | null) => {
        if (!target || !previewSurface.current || !isCurrent()) return;
        const surface = previewSurface.current;
        const spatialAnalysis = await getRawSpatialAnalysis(currentDoc.nativeAssetId, values);
        if (!isCurrent()) return;
        const render = (scratch: HTMLCanvasElement, forceCPU: boolean) => defaultImageEngine.renderDevelop(assetId, structuredClone(values), scratch, undefined,
          { forceCPU, fallbackReason: gpuFallbackReason.current,
            spatialSourceSize: { width: currentDoc.width, height: currentDoc.height }, spatialAnalysis });
        let scratch: HTMLCanvasElement;
        try {
          scratch = await surface.render(size, render);
        } catch (error) {
          if (!(error instanceof DevelopGpuError) || !isCurrent()) throw error;
          gpuFallbackReason.current = error.message;
          surface.useCPU();
          scratch = await surface.render(size, render);
          if (isCurrent()) setStatusMessage(`GPU 预览不可用，已切换基础 CPU 调色：${error.message}（局部蒙版需要 WebGL 2）`);
        }
        if (!isCurrent()) return;
        const context = target.getContext('2d'); if (!context) throw new Error('预览画布不可用');
        if (target.width !== size.width) target.width = size.width;
        if (target.height !== size.height) target.height = size.height;
        context.clearRect(0, 0, target.width, target.height);
        context.drawImage(scratch, 0, 0);
      };
      await paint(showOriginal && !comparisonId && original ? original : settings, canvasRef.current);
      if (!isCurrent()) return;
      setPaintedSource(previewSourceKey);
      setPreviewFailure(null);
      setPreviewRevision(value => value+1);
      setInspectedColor(null);
      defaultHistogramScheduler.schedule(canvasRef.current!, hist => { if (isCurrent()) setHistogramData(hist); });
      if (comparisonId) {
        const reference = comparisonId === 'original' ? original : currentDoc.settingsSnapshots?.find(s => s.id === comparisonId)?.settings;
        const target = comparisonCanvasRef.current;
        if (reference && target) {
          const key = () => referencePreviewKey({ documentId: currentDoc.id, assetId,
            nativeAssetId: currentDoc.nativeAssetId, referenceId: comparisonId,
            width: size.width, height: size.height, cpuFallback: !!gpuFallbackReason.current,
            referenceSettings: reference });
          await referencePreview.current.paintIfNeeded(key(), target, () => paint(reference, target), isCurrent, key);
        } else if (!reference) setComparisonId(null);
      }
      } catch (error) { if (isCurrent()) {
        const message=error instanceof Error ? error.message : String(error);
        setPreviewFailure({key:previewSourceKey,message});
        setStatusMessage(`调色预览失败：${message}`);
      } }
    });
    return () => { renderScheduler.current.cancel(); defaultHistogramScheduler.cancel(); };
  }, [currentDoc, settings, overviewAsset, previewSourceKey, showOriginal, comparisonId, previewQuality, isAdjusting, setHistogramData, setStatusMessage]);
  const handleMaskDraw = useCallback(async (mode: MaskDrawMode, start: { x: number; y: number }, end: { x: number; y: number }, points: Array<{ x: number; y: number }>) => {
    if (!currentDoc) return;
    try {
      const geometry = mode.kind === 'linear'
        ? { start, end }
        : mode.kind === 'radial'
          ? { center: start, radiusX: Math.max(0.01, Math.abs(end.x - start.x)), radiusY: Math.max(0.01, Math.abs(end.y - start.y)), feather: 0.45 }
          : {};
      const strokes = mode.kind === 'brush' ? [{ points, radius: 0.035, feather: 0.4 }] : [];
      if (mode.replace && selectedMaskId) {
        await defaultDevelopOperations.updateMask(currentDoc.id, selectedMaskId, {
          geometry,
          strokes,
        }, 'manual');
      } else {
        const id = await defaultDevelopOperations.createMask({ documentId: currentDoc.id, kind: mode.kind, name: `${mode.kind === 'linear' ? '线性渐变' : mode.kind === 'radial' ? '径向渐变' : '画笔'} ${currentDoc.settings.masks.length + 1}`, geometry, strokes, source: 'manual' });
        setSelectedMaskId(id);
      }
      setShowMaskOverlay(true);
    } catch (error) {
      setStatusMessage(`蒙版绘制失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMaskDrawMode(null);
    }
  }, [currentDoc, selectedMaskId, setStatusMessage]);

  useEffect(() => {
    return () => {
      defaultHistogramScheduler.cancel();
    };
  }, []);

  // Keyboard shortcut: '\' to toggle Before/After original
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeWorkspace !== 'develop') return;
      if (e.defaultPrevented || e.isComposing || isTextEditingTarget(e.target) || document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return;
      if (e.key === 'Escape' && maskDrawMode) {
        e.preventDefault();
        setMaskDrawMode(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase()==='b') {
        e.preventDefault(); setColorAssessment(value=>!value); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '\\') {
        e.preventDefault();
        setShowOriginal((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [maskDrawMode,activeWorkspace]);

  const handleTransferToEdit = async () => {
    if (!currentDoc || !settings) return;
    setIsExporting(true);
    setStatusMessage('正在渲染调色结果并准备转入图像编辑…');
    try {
      await transferToEditWorkspace(currentDoc.id);
      setWorkspace('edit');
      setStatusMessage('已将调色结果置入编辑工作区');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`转入失败：${msg}`);
    } finally {
      setIsExporting(false);
    }
  };

  if (!currentDoc || !settings) {
    return (
      <div className="develop-empty-state h-full w-full flex flex-col items-center justify-center text-studio-400 p-8">
        <div className="p-4 rounded-full bg-studio-800/50 border border-studio-700/50">
          <Sliders className="w-8 h-8 text-studio-400" />
        </div>
        <p className="text-sm font-medium">未打开任何照片或 RAW 图像</p>
        <p className="text-xs text-studio-500">打开 RAW 或照片开始调色，也可以直接拖入文件。</p>
        <button type="button" onClick={() => document.querySelector<HTMLButtonElement>('button[aria-label="打开文件"]')?.click()} className="develop-empty-open">打开照片</button>
      </div>
    );
  }

  const currentHsl = settings.hsl?.[activeHslChannel] || { hue: 0, saturation: 0, luminance: 0 };
  const selectedMask = settings.masks.find((mask) => mask.id === selectedMaskId) ?? null;
  const guard = () => { guardMenuDocument(defaultDocumentManager, currentDoc.id, currentDoc); };
  const wrap = (action: () => unknown) => () => { guard(); return action(); };
  const groupMenu = (group: DevelopSettingsGroup): ContextMenuItem[] => [
    { id: 'copy', label: '复制调色参数', icon: <Copy/>, disabled: isAdjusting, reason: '请先结束当前调整', run: wrap(() => { defaultDevelopOperations.copySettings(currentDoc.id); setStatusMessage('调色参数已复制'); }) },
    { id: 'paste', label: group === 'color' ? '粘贴色彩组（含白平衡）' : '粘贴该组', icon: <ClipboardPaste/>, disabled: isAdjusting || !defaultDevelopOperations.clipboard.getSnapshot(), reason: isAdjusting ? '请先结束当前调整' : '请先复制调色参数', run: wrap(async () => { await defaultDevelopOperations.pasteSettings(currentDoc.id, [group], group === 'color'); setStatusMessage('分组参数已粘贴，可撤销'); }) },
    { id: 'reset', label: group === 'color' ? '重置色彩组（含白平衡）' : '重置该组', icon: <RotateCcw/>, separatorBefore: true, disabled: isAdjusting, reason: '请先结束当前调整', run: wrap(() => defaultDevelopOperations.resetGroup(currentDoc.id, group, 'manual')) },
  ];
  const canvasMenuItems = (): ContextMenuItem[] => [
    { id: 'fit', label: '适合窗口', shortcut: 'Ctrl+0', run: wrap(() => viewport.action('fit')) },
    { id: 'actual', label: '100%', shortcut: 'Ctrl+1', run: wrap(() => viewport.action('actual')) },
    { id: 'zoom-in', label: '放大', icon: <ZoomIn/>, run: wrap(() => viewport.action('in')) },
    { id: 'zoom-out', label: '缩小', icon: <ZoomOut/>, run: wrap(() => viewport.action('out')) },
    { id: 'compare', label: showOriginal ? '显示当前调色' : '前后对比', icon: <ArrowRightLeft/>, shortcut: '\\', separatorBefore: true, disabled: !!comparisonId, reason: '请先关闭并排对比', run: wrap(() => setShowOriginal(value => !value)) },
    { id: 'auto-tone', label: '自动影调', icon: <Sparkles/>, disabled: isAdjusting || isAutoToning || !(currentDoc.sourceAssetId || currentDoc.previewAssetId), reason: isAutoToning ? '正在分析影调' : isAdjusting ? '请先结束当前调整' : '图像尚未载入', run: wrap(handleAutoTone) },
    { id: 'copy', label: '复制调色参数', icon: <Copy/>, separatorBefore: true, disabled: isAdjusting, reason: '请先结束当前调整', run: wrap(() => { defaultDevelopOperations.copySettings(currentDoc.id); setStatusMessage('调色参数已复制'); }) },
    { id: 'paste', label: '选择性粘贴调色…', icon: <ClipboardPaste/>, disabled: isAdjusting || !defaultDevelopOperations.clipboard.getSnapshot(), reason: isAdjusting ? '请先结束当前调整' : '请先复制调色参数', run: wrap(() => settingsMenu.current?.openPaste()) },
    ...(currentDoc.isRaw && currentDoc.settings.renderingVersion !== 2 ? [{ id: 'upgrade', label: '创建新版调色副本', icon: <Sparkles/>, disabled: isAdjusting || isCreatingRawVariant || rawState !== 'ready', reason: isAdjusting ? '请先结束当前调整' : isCreatingRawVariant ? '正在创建副本' : '请等待 RAW 解码完成', run: wrap(async () => {
      setIsCreatingRawVariant(true);
      try { await defaultDevelopOperations.createRenderingUpgrade(currentDoc.id); setStatusMessage('已创建新版调色副本，原工程已保留'); }
      finally { setIsCreatingRawVariant(false); }
    }) }] : []),
    { id: 'export', label: '导出…', icon: <Download/>, separatorBefore: true, disabled: isExporting || isAdjusting, reason: isExporting ? '正在导出' : '请先结束当前调整', run: wrap(onExport) },
  ];

  return (
    <ContextMenuScope.Provider value={{ id: currentDoc.id, guard, disabled: isAdjusting, reason: '请先结束当前调整' }}>
    <div className="develop-workbench flex-1 flex flex-col h-full bg-studio-950 text-studio-200 select-none overflow-hidden relative">
      {canvasMenu.node}
      {/* Debug Inspector Modal */}
      <PipelineDebugInspector
        document={currentDoc}
        canvasWidth={canvasRef.current?.width || currentDoc.width}
        canvasHeight={canvasRef.current?.height || currentDoc.height}
        isOpen={showDebugInspector}
        onClose={() => setShowDebugInspector(false)}
      />

      {/* Top Bar: RAW Pipeline Status & Actions */}
      <div className="develop-operation-bar h-10 bg-studio-900 border-b border-studio-800 px-3 flex items-center justify-between text-xs shrink-0 z-10">
        <div className="flex items-center space-x-2 min-w-0">
          <button type="button" className="develop-info-toggle" onClick={()=>setShowPhotoInfo(value=>!value)} aria-label="照片信息" aria-expanded={showPhotoInfo} aria-controls="develop-photo-info" title="显示或隐藏照片信息"><PanelLeft size={15}/></button>
          <span className="font-semibold text-studio-200 truncate max-w-[200px]" title={currentDoc.fileName}>
            {currentDoc.fileName}
          </span>
          <span className="text-studio-500 shrink-0 font-mono text-2xs">
            {currentDoc.width} × {currentDoc.height} px
          </span>

          {currentDoc.isRaw ? (
            <>
              {rawState === 'metadata' && (
                <span className="develop-source-state">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>读取元数据 ({rawProgress}%)</span>
                </span>
              )}
              {rawState === 'embedded-preview' && (
                <span className="develop-source-state" title="当前显示机内预览，完整图像仍在解码。">
                  RAW · 预览中
                </span>
              )}
              {rawState === 'decoding' && (
                <span className="develop-source-state">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>RAW · 解码 {rawProgress}%</span>
                </span>
              )}
              {rawState === 'ready' && (
                <span className="develop-source-state" title="原始文件保留；当前为解码后的调色预览，预览分辨率与导出不同。">
                  <span>RAW · 已解码</span>
                </span>
              )}
              {rawState === 'error' && (
                <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 font-mono shrink-0 flex items-center space-x-1" title={rawError || ''}>
                  <AlertCircle className="w-3 h-3" />
                  <span>RAW 状态异常</span>
                </span>
              )}
            </>
          ) : (
            <span className="develop-source-state">
              图像
            </span>
          )}

          {isExporting && (
            <span className="text-sky-400 flex items-center space-x-1 font-mono min-w-0" role="status" aria-live="polite">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              <span className="truncate min-w-0">正在转入图像编辑…</span>
            </span>
          )}
        </div>

        <div className="develop-operation-actions flex items-center space-x-2 shrink-0">
          <DevelopSettingsMenu ref={settingsMenu} key={currentDoc.id} documentId={currentDoc.id} disabled={isAdjusting} onStatus={setStatusMessage} />
          {/* Before/After Toggle */}
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            disabled={!isPreviewPainted}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded border transition-colors cursor-pointer text-2xs ${
              showOriginal
                ? 'bg-amber-950/80 text-amber-300 border-amber-700 font-medium'
                : 'bg-studio-800 text-studio-300 border-studio-700 hover:bg-studio-750'
            }`}
            title="对比原始图像（快捷键：\）"
          >
            {showOriginal ? <EyeOff className="w-3 h-3 text-amber-400" /> : <Eye className="w-3 h-3 text-studio-400" />}
            <span>{showOriginal ? '查看中: 原图' : '对比原图 (\\)'}</span>
          </button>

          <button disabled={!isPreviewPainted} onClick={() => setComparisonId(comparisonId ? null : 'original')} className="px-2 py-0.5 rounded border border-studio-700 bg-studio-800 text-2xs">{comparisonId ? '关闭并排' : '并排对比'}</button>
          {/* Pipeline Debug Toggle */}
          <button
            onClick={() => setShowDebugInspector(!showDebugInspector)}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded border transition-colors cursor-pointer text-2xs ${
              showDebugInspector
                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-700 font-medium'
                : 'bg-studio-800 text-studio-400 border-studio-700 hover:text-studio-200'
            }`}
            aria-label="诊断色彩管线" title="查看色彩管线与硬件加速状态"
          >
            <Activity className="w-3 h-3 text-cyan-400" />
          </button>

          <button
            onClick={onExport}
            disabled={isExporting || !isPreviewPainted}
            className="flex items-center space-x-1 bg-studio-800 hover:bg-studio-700 text-studio-200 px-2 py-0.5 rounded border border-studio-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title={currentDoc.isRaw ? '导出 JPEG、PNG 或 TIFF 成品' : '导出 JPEG 或 PNG 成品'}
          >
            <Download className="w-3 h-3 text-blue-400" />
            <span>导出成品…</span>
          </button>

          <button
            onClick={handleTransferToEdit}
            disabled={isExporting || !isPreviewPainted}
            className="flex items-center space-x-1 bg-purple-950/80 hover:bg-purple-900 text-purple-300 px-2.5 py-0.5 rounded border border-purple-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title="RAW 使用原始分辨率 PNG 转入；当前原生渲染器不支持的调整会给出提示"
          >
            <ArrowRightLeft className="w-3 h-3 text-purple-400" />
            <span>转入图像编辑</span>
          </button>
        </div>
      </div>

      {/* Main Work Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side Panel: EXIF & Info */}
        <aside id="develop-photo-info" aria-label="照片信息面板" hidden={!showPhotoInfo} className="develop-photo-info w-56 bg-studio-900 border-r border-studio-800 p-3 flex flex-col justify-between text-xs overflow-y-auto shrink-0">
          <div className="space-y-4">
            <div>
              <div className="flex items-center space-x-1.5 text-2xs font-bold uppercase tracking-wider text-studio-500 mb-2">
                <Info className="w-3 h-3 text-studio-400" />
                <span>相机 EXIF</span>
              </div>
              <div className="bg-studio-850 p-2.5 rounded border border-studio-800 font-mono text-2xs space-y-1.5 text-studio-300">
                <div className="flex justify-between">
                  <span className="text-studio-500">机型</span>
                  <span className="truncate max-w-[100px]">{currentDoc.exif.cameraModel || currentDoc.exif.cameraMake || '未知机型'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-studio-500">镜头</span>
                  <span className="truncate max-w-[100px]">{currentDoc.exif.lensModel || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-studio-500">焦距</span>
                  <span>{currentDoc.exif.focalLength || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-studio-500">光圈</span>
                  <span>{currentDoc.exif.aperture || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-studio-500">快门</span>
                  <span>{currentDoc.exif.shutterSpeed || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-studio-500">ISO</span>
                  <span>{currentDoc.exif.iso || '—'}</span>
                </div>
                {currentDoc.exif.cfaPattern && (
                  <div className="flex justify-between pt-1 border-t border-studio-800 text-studio-400">
                    <span>CFA 阵列</span>
                    <span className="text-emerald-400">{currentDoc.exif.cfaPattern}</span>
                  </div>
                )}
                {currentDoc.exif.orientation && (
                  <div className="flex justify-between text-studio-400">
                    <span>方向</span>
                    <span>{currentDoc.exif.orientation}</span>
                  </div>
                )}
              </div>
            </div>

            {/* AI Agent Quick Suggestion Box */}
            <div className="develop-assistant-entry">
              <button type="button" onClick={() => { if (!isAiPanelOpen) toggleAiPanel(); }} title="打开右侧 AI 助手" className="develop-assistant-button">
                <Sparkles className="w-3 h-3" />
                <span>调色助手</span>
              </button>
              <p>
                在助手中描述想要的调整，例如“降低高光”。结果可在历史中撤销。
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-studio-800 text-2xs text-studio-500 space-y-0.5">
            <div>原图 {currentDoc.width} × {currentDoc.height}</div>
            <div>概览 {overviewHandle?.width ?? previewSize.width} × {overviewHandle?.height ?? previewSize.height}</div>
            {currentDoc.isRaw && <div>{detail.region ? '当前视野：原始像素细节' : '放大后载入原始像素细节'}</div>}
            <div>原始文件保留</div>
          </div>
        </aside>

        {/* Center: Strict 18% Neutral Gray Canvas Viewport (Rule 8 & Stage E) */}
        <main ref={viewport.ref} tabIndex={0} aria-label="调色画布" style={{ backgroundColor: colorAssessment ? '#767676' : canvasBackground, cursor: maskDrawMode && !viewport.space ? 'crosshair' : viewport.cursor }} className={`develop-canvas-viewport flex-1 min-w-0 relative overflow-hidden${colorAssessment?' is-color-assessment':''}`}
          onContextMenu={event => canvasMenu.open(event, canvasMenuItems(), '调色画布操作')}
          onKeyDown={event => canvasMenu.key(event, canvasMenuItems, '调色画布操作')}
          onPointerDownCapture={event => { if (event.button === 2) { event.preventDefault(); event.stopPropagation(); return; } viewport.pointerDown(event); }} onPointerMove={event=>{viewport.pointerMove(event);inspectPreview(event);}} onPointerLeave={()=>setInspectedColor(null)} onPointerUp={viewport.pointerUp} onPointerCancel={viewport.pointerUp}>
          {showOriginal && !comparisonId && (
            <div className="develop-original-label">
              <Eye className="w-3.5 h-3.5" />
              <span>原图 · 未调整</span>
            </div>
          )}

          {currentDoc.isRaw && !isPreviewPainted && (
            <div className="develop-loading-state" role="status" aria-label="RAW 载入状态" aria-live="polite">
              {rawState === 'error' || previewError ? <AlertCircle size={20}/> : <Loader2 size={20} className="animate-spin"/>}
              <span>{rawState === 'error' ? 'RAW 解码失败' : previewError ? '调色预览失败' : rawState === 'ready' ? '正在生成调色预览' : '正在解码 RAW'}</span>
              {previewError && <small>{previewError}</small>}
            </div>
          )}
          <div className="develop-image-plane" aria-hidden={!isPreviewPainted} style={{visibility:isPreviewPainted?'visible':'hidden',transform:`translate(-50%, -50%) translate(${viewport.view.x}px, ${viewport.view.y}px)`}}>
          {comparisonId && <div className="develop-photo-frame relative shrink-0" style={{width:currentDoc.width*viewport.view.scale,height:currentDoc.height*viewport.view.scale}}><span className="absolute top-1 left-1 text-2xs bg-studio-950/80 px-2 py-1 z-10">{comparisonId === 'original' ? '原图' : currentDoc.settingsSnapshots?.find(s => s.id === comparisonId)?.name}</span><canvas ref={comparisonCanvasRef} className="w-full h-full block" /></div>}
          <div style={{ ...checkerStyle(checkerSize, checkerTone), width:currentDoc.width*viewport.view.scale,height:currentDoc.height*viewport.view.scale }} className="develop-photo-frame relative shrink-0">
            <canvas
              ref={attachPreviewCanvas}
              className="w-full h-full block"
            />
            <PreviewClippingOverlay source={canvasRef.current} revision={previewRevision} shadows={warnShadows} highlights={warnHighlights} onCounts={setClippingCounts} onError={setStatusMessage}/>
            <canvas ref={detail.canvasRef} aria-hidden="true" className="absolute pointer-events-none block" style={{
              display: detail.region ? 'block' : 'none',
              left: (detail.region?.x ?? 0) * viewport.view.scale,
              top: (detail.region?.y ?? 0) * viewport.view.scale,
              width: (detail.region?.width ?? 0) * viewport.view.scale,
              height: (detail.region?.height ?? 0) * viewport.view.scale,
            }} />
            {detail.region && <div className="absolute pointer-events-none" style={{left:detail.region.x*viewport.view.scale,top:detail.region.y*viewport.view.scale,width:detail.region.width*viewport.view.scale,height:detail.region.height*viewport.view.scale}}><PreviewClippingOverlay source={detail.canvasRef.current} revision={detail.region} shadows={warnShadows} highlights={warnHighlights} onError={setStatusMessage}/></div>}
            {comparisonId && <span className="absolute top-1 left-1 text-2xs bg-studio-950/80 px-2 py-1 z-10">当前调色</span>}
            <DevelopMaskOverlay
              mask={selectedMask}
              showOverlay={showMaskOverlay}
              drawMode={maskDrawMode}
              width={previewSize.width}
              height={previewSize.height}
              onDrawComplete={(mode, start, end, points) => { void handleMaskDraw(mode, start, end, points); }}
            />
          </div>
          </div>
          <div className="develop-view-controls" role="toolbar" aria-label="画布缩放与平移">
            <button type="button" onClick={()=>viewport.action('hand')} aria-label="抓手工具" aria-pressed={viewport.tool==='hand'} title="抓手 H；按住空格临时拖移"><Hand size={13}/></button>
            <button type="button" onClick={()=>viewport.action('zoom')} aria-label="缩放工具" aria-pressed={viewport.tool==='zoom'} title="缩放 Z；Alt 点击缩小"><ZoomIn size={13}/></button>
            <span className="develop-view-divider"/>
            <button type="button" onClick={()=>viewport.action('out')} aria-label="缩小图像" title="缩小 Ctrl / ⌘ −"><ZoomOut size={13}/></button>
            <output aria-label="图像缩放比例">{(viewport.view.scale*100).toFixed(viewport.view.scale<.1?1:0)}%</output>
            <button type="button" onClick={()=>viewport.action('in')} aria-label="放大图像" title="放大 Ctrl / ⌘ +"><ZoomIn size={13}/></button>
            <button type="button" onClick={()=>viewport.action('fit')} title="适应窗口 Ctrl / ⌘ 0">适应</button>
            <button type="button" onClick={()=>viewport.action('actual')} title="实际像素比例 Ctrl / ⌘ 1；RAW 解码后按需加载可见区域细节">100%</button>
            <span className="develop-view-divider"/>
            <button type="button" onClick={()=>setColorAssessment(value=>!value)} aria-pressed={colorAssessment} title="中性灰背景与白色参照边框；只改变观察环境">色彩评估</button>
          </div>
        </main>

        {/* Right Side Panel: Develop Sliders & Controls */}
        <aside aria-label="调色工具面板" className="develop-controls-panel w-80 bg-studio-900 border-l border-studio-800 flex flex-col text-xs overflow-y-auto shrink-0">
          {/* Real 256-bin Histogram */}
          <div className="p-3 border-b border-studio-800 space-y-1.5 bg-studio-900 sticky top-0 z-30 shadow-[0_8px_18px_rgba(0,0,0,0.18)]">
            <div className="flex items-center justify-between text-2xs font-bold uppercase tracking-wider text-studio-500">
              <span>直方图</span>
              <span className="font-mono text-studio-300">EV {settings.exposure.toFixed(2)}</span>
            </div>
            <HistogramView data={histogramData} height={96} />
            <div className="develop-histogram-actions">
              <div className="develop-warning-toggles" role="group" aria-label="预览输出警示">
                <button type="button" aria-pressed={warnShadows} onClick={()=>setWarnShadows(value=>!value)} title="蓝色标出 RGB 三通道均 ≤ 1 的预览像素">阴影</button>
                <button type="button" aria-pressed={warnHighlights} onClick={()=>setWarnHighlights(value=>!value)} title="红色标出任意 RGB 通道 ≥ 254 的预览像素">高光</button>
              </div>
              <button
                onClick={() => resetSettings(currentDoc.id)}
                className="text-2xs text-studio-400 hover:text-studio-200 flex items-center space-x-1 cursor-pointer transition-colors"
                title="将全部调色参数重置为默认值"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>全部重置</span>
              </button>
            </div>
            {clippingCounts && <p className="develop-clipping-counts">预览采样 · 阴影 {(clippingCounts.shadows/Math.max(1,clippingCounts.sampled)*100).toFixed(1)}% · 高光 {(clippingCounts.highlights/Math.max(1,clippingCounts.sampled)*100).toFixed(1)}%</p>}
            <details className="develop-color-contract"><summary>sRGB · 颜色管理</summary><dl>
              <div><dt>输入</dt><dd>{currentDoc.isRaw?'LibRaw 相机白平衡 + 相机矩阵':'浏览器颜色解码'}</dd></div>
              <div><dt>工作</dt><dd>线性 sRGB · 浮点调色</dd></div>
              <div><dt>显示</dt><dd>sRGB · 8 位预览</dd></div>
              <div><dt>输出</dt><dd>{currentDoc.isRaw?'PNG / TIFF 16 位 · ICC；JPEG 8 位':'PNG / JPEG 8 位'}</dd></div>
            </dl><p>{currentDoc.isRaw && currentDoc.rawProcessingVersion===2?'RAW 工作数据保留为 32 位浮点；成品输出时量化。':'当前使用兼容输入管线。'}尚未支持自定义相机 DCP / ICC，当前无打印软打样。</p></details>
          </div>

          <div className="p-3 space-y-2.5">
            <button type="button" onClick={handleAutoTone} disabled={isAutoToning || isAdjusting || !isPreviewPainted} className="w-full flex items-center justify-center gap-2 py-2 rounded border border-studio-700 bg-studio-800 hover:bg-studio-700 disabled:opacity-50" title="根据画面分布自动调整影调，并约束高光溢出；保留白平衡与色彩调整，可撤销。">
              <Sparkles className="w-3.5 h-3.5" />{isAutoToning ? '正在分析…' : '自动'}
            </button>
            <DevelopToolBrowser group={toolGroup} setGroup={setToolGroup} query={toolQuery} setQuery={setToolQuery}
              contextScope={currentDoc.id} contextItems={group => group === 'basic' || group === 'color' || group === 'detail' ? groupMenu(group) : []}>
            <div id="dev-sec-looks"><DevelopLooksPanel key={currentDoc.id} document={currentDoc} settings={settings} onCompare={setComparisonId} onError={message => setStatusMessage(`预设 / 快照失败：${message}`)} /></div>
            <AccordionSection
              id="dev-sec-masks"
              title={`局部蒙版${settings.masks.length ? ` · ${settings.masks.length}` : ''}`}
              defaultExpanded={false}
              icon={<Focus className="w-3.5 h-3.5 text-sky-400" />}
            >
              <DevelopMaskPanel
                documentId={currentDoc.id}
                masks={settings.masks}
                selectedMaskId={selectedMaskId}
                onSelectMask={setSelectedMaskId}
                onBeginDraw={(kind, replace) => {
                  setMaskDrawMode({ kind, replace });
                  setStatusMessage(`请在照片上拖动绘制${kind === 'linear' ? '线性渐变' : kind === 'radial' ? '径向渐变' : '画笔蒙版'}`);
                }}
                showOverlay={showMaskOverlay}
                onToggleOverlay={() => setShowMaskOverlay((current) => !current)}
                onError={(message) => setStatusMessage(`蒙版操作失败：${message}`)}
              />
            </AccordionSection>
            {/* Section 1: Basic Tone */}
            <AccordionSection
              id="dev-sec-basic"
              contextScope={currentDoc.id} contextItems={() => groupMenu('basic')}
              title="基础影调"
              icon={<Sun className="w-3.5 h-3.5 text-amber-400" />}
              onResetSection={() => resetSection(currentDoc.id, 'basic')}
            >
              <div className="space-y-1">
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.exposure}
                  value={settings.exposure}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Exposure')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'exposure', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.contrast}
                  value={settings.contrast}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Contrast')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'contrast', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.highlights}
                  value={settings.highlights}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Highlights')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'highlights', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.shadows}
                  value={settings.shadows}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Shadows')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'shadows', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.whites}
                  value={settings.whites}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Whites')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'whites', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.blacks}
                  value={settings.blacks}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Blacks')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'blacks', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
              </div>
            </AccordionSection>

            {/* Section 2: White Balance & Color */}
            <AccordionSection
              id="dev-sec-wb"
              contextScope={currentDoc.id} contextItems={() => groupMenu('color')}
              title="白平衡"
              icon={<Thermometer className="w-3.5 h-3.5 text-blue-400" />}
              onResetSection={() => resetSection(currentDoc.id, 'wb')}
            >
              <div className="space-y-2">
                {/* WB Mode Segmented Control */}
                <SegmentedControl<WhiteBalanceMode>
                  options={WB_SEGMENT_OPTIONS}
                  activeId={settings.whiteBalance.mode}
                  onChange={(val) => setWhiteBalance(currentDoc.id, {
                    ...settings.whiteBalance,
                    mode: val,
                    temperature: val === 'as-shot' ? 5500 : settings.whiteBalance.temperature ?? 5500,
                    tint: val === 'as-shot' ? 0 : settings.whiteBalance.tint ?? 0,
                  })}
                  size="sm"
                />

                <p className="text-2xs text-studio-500 leading-relaxed">相对原照校正：5500 K / 色调 0 不作调整。这里的 K 值不是相机实测色温；“原照”保留解码时的白平衡。</p>
                {whiteBalanceBusy && <p className="text-2xs text-studio-500" role="status">正在分析原始图像颜色…</p>}
                {whiteBalanceError && <p className="text-2xs text-rose-400" role="alert">{whiteBalanceError}</p>}
                {settings.whiteBalance.mode === 'auto' && settings.whiteBalance.resolvedAuto && (
                  <p className="text-2xs text-studio-500 leading-relaxed">
                    {settings.whiteBalance.resolvedAuto.status === 'as-shot-fallback'
                      ? '中性色样本不足，保留原照白平衡。'
                      : `自动相对颜色校正 · 样本支持 ${Math.round(settings.whiteBalance.resolvedAuto.confidence * 100)}%`}
                    {' '}自动是在相机白平衡后的颜色上校正。
                  </p>
                )}

                <div className="space-y-1 pt-1">
                  <ScrubbableInput
                    param={PARAM_DEFINITIONS.temperature}
                    value={settings.whiteBalance.temperature ?? 5500}
                    onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Temperature')}
                    onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'whiteBalance.temperature', val)}
                    onCommitDrag={() => commitSettingDrag()}
                  />
                  <ScrubbableInput
                    param={PARAM_DEFINITIONS.tint}
                    value={settings.whiteBalance.tint ?? 0}
                    onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Tint')}
                    onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'whiteBalance.tint', val)}
                    onCommitDrag={() => commitSettingDrag()}
                  />
                </div>
              </div>
            </AccordionSection>

            {/* Section 3: Presence & Vibrance */}
            <AccordionSection
              id="dev-sec-presence"
              contextScope={currentDoc.id} contextItems={() => groupMenu('color')}
              title="质感与饱和度"
              icon={<Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
              onResetSection={() => resetSection(currentDoc.id, 'presence')}
            >
              <div className="space-y-1">
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.texture}
                  value={settings.texture}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Texture')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'texture', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.clarity}
                  value={settings.clarity}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Clarity')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'clarity', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.dehaze}
                  value={settings.dehaze}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Dehaze')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'dehaze', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.vibrance}
                  value={settings.vibrance}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Vibrance')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'vibrance', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.saturation}
                  value={settings.saturation}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Saturation')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'saturation', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
              </div>
            </AccordionSection>

            {/* Section 4: Tone Curves */}
            <AccordionSection
              id="dev-sec-curves"
              contextScope={currentDoc.id} contextItems={() => groupMenu('curves')}
              title="色调曲线"
              icon={<Sliders className="w-3.5 h-3.5 text-purple-400" />}
              onResetSection={() => resetSection(currentDoc.id, 'curves')}
            >
              <div className="pt-1">
                <CurveEditor
                  key={currentDoc.id}
                  curves={settings.curves}
                  enabled={activeWorkspace === 'develop'}
                  onChangeCurves={newCurves => { defaultDevelopOperations.setCurves(currentDoc.id, newCurves, 'manual'); }}
                  onBegin={() => { defaultDevelopOperations.beginCurveChange(currentDoc.id); setIsAdjusting(true); }}
                  onPreview={newCurves => defaultDevelopOperations.previewCurves(currentDoc.id, newCurves)}
                  onCommit={() => { try { defaultDevelopOperations.commitCurveChange(); } finally { setIsAdjusting(false); } }}
                  onAbort={() => { try { defaultDevelopOperations.abortCurveChange(); } finally { setIsAdjusting(false); } }}
                  width={274}
                  height={190}
                />
              </div>
            </AccordionSection>

            {/* Section 5: HSL Color Mixer */}
            <AccordionSection
              id="dev-sec-hsl"
              contextScope={currentDoc.id} contextItems={() => groupMenu('color')}
              title="颜色混合 (HSL)"
              icon={<Palette className="w-3.5 h-3.5 text-emerald-400" />}
              onResetSection={() => resetSection(currentDoc.id, 'hsl')}
            >
              <div className="space-y-2">
                {/* 8 Channel Selector */}
                <div className="grid grid-cols-4 gap-1 bg-studio-950 p-1 rounded border border-studio-800">
                  {HSL_CHANNELS.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => setActiveHslChannel(ch.id)}
                      className={`flex items-center justify-center space-x-1 py-1 rounded text-2xs transition-colors cursor-pointer ${
                        activeHslChannel === ch.id
                          ? 'bg-studio-800 text-studio-100 font-semibold shadow-xs'
                          : 'text-studio-400 hover:text-studio-200'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ch.dotColor }} />
                      <span>{ch.label}</span>
                    </button>
                  ))}
                </div>

                {/* Active Channel Sliders */}
                <div className="space-y-1 pt-1 bg-studio-850/60 p-2 rounded border border-studio-800/80">
                  <div className="text-2xs font-semibold text-studio-300 pb-0.5 flex items-center space-x-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: HSL_CHANNELS.find((c) => c.id === activeHslChannel)?.dotColor }}
                    />
                    <span>{HSL_CHANNELS.find((c) => c.id === activeHslChannel)?.label}色调整</span>
                  </div>

                  <ScrubbableInput
                    param={PARAM_DEFINITIONS.hslHue}
                    value={currentHsl.hue}
                    onStartDrag={() => startSettingDrag(currentDoc.id, `Adjust ${activeHslChannel} Hue`)}
                    onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, `hsl.${activeHslChannel}.hue`, val)}
                    onCommitDrag={() => commitSettingDrag()}
                  />
                  <ScrubbableInput
                    param={PARAM_DEFINITIONS.hslSat}
                    value={currentHsl.saturation}
                    onStartDrag={() => startSettingDrag(currentDoc.id, `Adjust ${activeHslChannel} Saturation`)}
                    onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, `hsl.${activeHslChannel}.saturation`, val)}
                    onCommitDrag={() => commitSettingDrag()}
                  />
                  <ScrubbableInput
                    param={PARAM_DEFINITIONS.hslLum}
                    value={currentHsl.luminance}
                    onStartDrag={() => startSettingDrag(currentDoc.id, `Adjust ${activeHslChannel} Luminance`)}
                    onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, `hsl.${activeHslChannel}.luminance`, val)}
                    onCommitDrag={() => commitSettingDrag()}
                  />
                </div>
              </div>
            </AccordionSection>

            {/* Section 6: Detail & Sharpening */}
            <AccordionSection
              id="dev-sec-detail"
              contextScope={currentDoc.id} contextItems={() => groupMenu('detail')}
              title="细节与降噪"
              icon={<Focus className="w-3.5 h-3.5 text-rose-400" />}
              onResetSection={() => resetSection(currentDoc.id, 'detail')}
            >
              <div className="space-y-1">
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.sharpenAmount}
                  value={settings.detail?.sharpenAmount ?? 0}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Sharpen Amount')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'detail.sharpenAmount', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.sharpenRadius}
                  value={settings.detail?.sharpenRadius ?? 1.0}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Sharpen Radius')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'detail.sharpenRadius', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.sharpenThreshold}
                  value={settings.detail?.sharpenThreshold ?? 0}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Sharpen Threshold')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'detail.sharpenThreshold', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.lumaDenoise}
                  value={settings.detail?.lumaDenoise ?? 0}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Luma Denoise')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'detail.lumaDenoise', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.chromaDenoise}
                  value={settings.detail?.chromaDenoise ?? 0}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Chroma Denoise')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'detail.chromaDenoise', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
              </div>
            </AccordionSection>

            {/* Section 7: Optics & Vignette */}
            <AccordionSection
              id="dev-sec-optics"
              contextScope={currentDoc.id} contextItems={() => groupMenu('optics')}
              title="镜头与晕影"
              icon={<Disc className="w-3.5 h-3.5 text-cyan-400" />}
              onResetSection={() => resetSection(currentDoc.id, 'optics')}
            >
                {currentDoc.isRaw && (
                  <div className="flex items-center justify-between gap-2 pb-2 text-[11px] text-studio-400">
                    <span>{(currentDoc.rawProcessingVersion ?? 1) === 1 ? '旧版 RAW 管线' : currentDoc.rawCorrectionMode === 'uncorrected' ? '未校正 · 32 位浮点' : '相机校正 · 32 位浮点'}</span>
                    <div className="flex gap-1">
                      <button type="button" className="studio-btn-icon" title="新建未校正副本" aria-label="新建未校正副本"
                        disabled={isCreatingRawVariant || rawState !== 'ready' || currentDoc.rawCorrectionMode === 'uncorrected' || !!settings.masks.length}
                        onClick={() => void handleRawVariant('uncorrected')}><EyeOff size={14} /></button>
                      <button type="button" className="studio-btn-icon" title="新建浮点校正副本" aria-label="新建浮点校正副本"
                        disabled={isCreatingRawVariant || rawState !== 'ready' || ((currentDoc.rawProcessingVersion ?? 1) === 2 && currentDoc.rawCorrectionMode !== 'uncorrected') || !!settings.masks.length}
                        onClick={() => void handleRawVariant('camera')}><Focus size={14} /></button>
                    </div>
                  </div>
                )}
                {currentDoc.exif?.opticalCorrection && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pb-2 text-[11px] text-studio-400">
                    {currentDoc.exif.opticalCorrection.distortion_applied && <span>畸变已校正</span>}
                    {currentDoc.exif.opticalCorrection.aberration_applied && <span>色差已校正</span>}
                    {currentDoc.exif.opticalCorrection.shading_applied && <span>镜头暗角已校正</span>}
                    {currentDoc.exif.opticalCorrection.provenance === 'camera-active-area-only' && <span>无可用镜头标定</span>}
                  </div>
                )}
              <div className="space-y-1">
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.vignetteAmount}
                  value={settings.optics?.vignetteAmount ?? 0}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Vignette Amount')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'optics.vignetteAmount', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
                <ScrubbableInput
                  param={PARAM_DEFINITIONS.vignetteMidpoint}
                  value={settings.optics?.vignetteMidpoint ?? 50}
                  onStartDrag={() => startSettingDrag(currentDoc.id, 'Adjust Vignette Midpoint')}
                  onPreviewDrag={(val) => previewSettingDrag(currentDoc.id, 'optics.vignetteMidpoint', val)}
                  onCommitDrag={() => commitSettingDrag()}
                />
              </div>
            </AccordionSection>
            </DevelopToolBrowser>
          </div>
        </aside>
      </div>
      <div className="develop-observation-bar">
        <span className="develop-observation-source">{currentDoc.exif.cameraModel || (currentDoc.isRaw?'RAW 照片':'图像')}<span>{currentDoc.exif.iso?`ISO ${currentDoc.exif.iso}`:''}</span></span>
        <output className="develop-color-readout" aria-label="预览颜色读数"><Pipette size={12}/>{inspectedColor ? <><i style={{backgroundColor:`rgb(${inspectedColor.rgb.join(',')})`}}/><span>RGB {inspectedColor.rgb.join(' / ')}</span><span title="CIELAB · D50 / 2°">Lab {inspectedColor.lab.map(value=>value.toFixed(1)).join(' / ')}</span><small>{inspectedColor.label} · sRGB 8 位</small></>:<span>移到照片上查看颜色 · 预览采样</span>}</output>
      </div>
    </div>
    </ContextMenuScope.Provider>
  );
};
