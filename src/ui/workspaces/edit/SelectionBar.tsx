import { defaultDocumentManager } from '../../../document/DocumentManager';
import { assertCurrentLayer } from '../../../edit/LayerTree';
import { defaultAssetManager } from '../../../assets/AssetManager';
import { findLayerById } from '../../../document/EditDocument';
// src/ui/workspaces/edit/SelectionBar.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  Square,
  Wand2,
  Sparkles,
  Eraser,
  Maximize2,
  Minimize2,
  RotateCw,
  X,
  Check,
  Loader2,
  CloudSun,
  User,
  Plus,
  Minus,
  BoxSelect,
  SlidersHorizontal,
  Eye,
  ChevronDown
} from 'lucide-react';
import { useEditStore } from '../../../stores/useEditStore';
import { SelectionMode } from '../../../selection/types';
import { SelectSubjectTool, SelectSkyTool, SelectBackgroundTool } from '../../../ai/tools/edit/selectionTools';
import { defaultCommandBus } from '../../../history/CommandBus';
import { defaultInpaintingService } from '../../../ai/inpainting/InpaintingService';
import { GlassSurface } from '../../shared/GlassSurface';
import './SelectionBar.css';

interface SelectionBarProps {
  activeTool?: string;
  setActiveTool?: (tool: any) => void;
  selectionMode?: SelectionMode;
  onChangeSelectionMode?: (mode: SelectionMode) => void;
  canAutoCutout?: boolean;
  onAutoCutout?: () => void;
}

export const SelectionBar: React.FC<SelectionBarProps> = ({ activeTool, selectionMode, onChangeSelectionMode, canAutoCutout, onAutoCutout }) => {
  const currentDoc = useEditStore((s) => s.currentDoc);
  const maskViewMode = useEditStore((s) => s.maskViewMode);
  const setMaskViewMode = useEditStore((s) => s.setMaskViewMode);

  const clearSelection = useEditStore((s) => s.clearSelection);
  const selectAll = useEditStore((s) => s.selectAll);
  const invertSelection = useEditStore((s) => s.invertSelection);
  const featherSelection = useEditStore((s) => s.featherSelection);
  const expandSelection = useEditStore((s) => s.expandSelection);
  const contractSelection = useEditStore((s) => s.contractSelection);
  const addGeneratedPatchLayer = useEditStore((s) => s.addGeneratedPatchLayer);

  // Local selection parameters state
  const [localBooleanMode, setLocalBooleanMode] = useState<SelectionMode>('replace');
  const booleanMode = selectionMode ?? localBooleanMode;
  const setBooleanMode = onChangeSelectionMode ?? setLocalBooleanMode;
  const [featherRadius, setFeatherRadius] = useState<number>(0);
  const [expandContractPx, setExpandContractPx] = useState<number>(5);
  const [isProcessingAI, setIsProcessingAI] = useState<boolean>(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const selectionAbort = useRef<AbortController | null>(null);
  useEffect(() => () => selectionAbort.current?.abort(), [currentDoc?.id]);

  const [activePanel, setActivePanel] = useState<'adjust' | 'smart' | 'fill' | 'view' | null>(null);
  const [genFillPromptText, setGenFillPromptText] = useState<string>('');

  const hasSelection = !!(currentDoc?.selection?.active && currentDoc.selection.bounds.width > 0);
  const isSelectionToolActive = activeTool === 'marquee' || activeTool === 'lasso' || activeTool?.startsWith('select-');

  useEffect(() => { setActivePanel(null); }, [currentDoc?.id]);
  useEffect(() => {
    if (!hasSelection && activePanel === 'fill') setActivePanel(null);
  }, [hasSelection, activePanel]);

  if (!currentDoc) return null;
  if (!hasSelection && !isSelectionToolActive) {
    return canAutoCutout && onAutoCutout ? <GlassSurface variant="floating" shape="pill" interactive={false} chromatic={false} refractionScale={5} className="selection-taskbar selection-bar" role="toolbar" aria-label="自动抠图">
      <button type="button" className="selection-bar__button" onClick={onAutoCutout} title="自动识别所选图层并精修边缘"><Wand2 size={15} aria-hidden="true" /><span>自动抠图</span></button>
    </GlassSurface> : null;
  }

  const handleSmartSelection = async (kind: 'subject' | 'background' | 'sky') => {
    if (selectionAbort.current) return;
    const controller = new AbortController(); selectionAbort.current = controller;
    setIsProcessingAI(true); setAiStatus('正在本机计算选区…');
    try {
      const tool = kind === 'subject' ? new SelectSubjectTool() : kind === 'background' ? new SelectBackgroundTool() : new SelectSkyTool();
      const result = await tool.execute({ documentManager: defaultDocumentManager, commandBus: defaultCommandBus, currentWorkspace: 'edit' }, { documentId: currentDoc.id, target: 'composite', mode: booleanMode, feather: featherRadius, signal: controller.signal }, 'selection-toolbar');
      if (!result.success) throw new Error(result.error?.message || '无法生成选区。');
    } catch (reason) {
      if (!controller.signal.aborted) alert('选择失败：' + (reason instanceof Error ? reason.message : String(reason)));
    } finally {
      if (selectionAbort.current === controller) selectionAbort.current = null;
      setAiStatus(null); setIsProcessingAI(false);
    }
  };
  const handleSelectSubject = () => handleSmartSelection('subject');
  const handleSelectSky = () => handleSmartSelection('sky');
  const handleSelectBackground = () => handleSmartSelection('background');

  // AI Object Removal (Inpaint)
  const handleRemoveObject = async () => {
    if (!currentDoc || !currentDoc.selection) {
      alert('请先在画面中创建选区，再执行对象移除。');
      return;
    }

    const selectedLayer = (currentDoc.selectedLayerId ? findLayerById(currentDoc.layers, currentDoc.selectedLayerId) : null) || currentDoc.layers[0];
    if (!selectedLayer) {
      alert('未找到可用的图像图层，请在右侧「图层」标签页中选中一个图像图层后重试。');
      return;
    }

    setIsProcessingAI(true);
    setAiStatus('正在移除对象（内容感知修补）…');
    try {
      const inpaintResult = await defaultInpaintingService.executeInpaint(
        currentDoc,
        selectedLayer.id,
        currentDoc.selection.bounds,
        currentDoc.selection.assetId,
        { prompt: '' }
      );

      const patchLayer = await defaultInpaintingService.createPatchLayer(
        inpaintResult,
        `AI 移除（${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`
      );

      try {
        assertCurrentLayer(defaultDocumentManager, currentDoc, selectedLayer.id);
        addGeneratedPatchLayer(currentDoc.id, patchLayer);
      } catch (error) { defaultAssetManager.releaseAsset(patchLayer.sourceAssetId); defaultAssetManager.releaseAsset(patchLayer.maskAssetId); throw error; }
      clearSelection(currentDoc.id);
      setAiStatus(null);
    } catch (err: any) {
      alert('对象移除失败：' + err.message + '。请缩小选区范围，或改用内容填充重试。');
      setAiStatus(null);
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Generative Fill
  const handleGenerativeFill = async () => {
    if (!currentDoc || !currentDoc.selection) {
      alert('请先在画面中创建选区，再执行内容填充。');
      return;
    }

    const selectedLayer = (currentDoc.selectedLayerId ? findLayerById(currentDoc.layers, currentDoc.selectedLayerId) : null) || currentDoc.layers[0];
    if (!selectedLayer) {
      alert('未找到可用的图像图层，请在右侧「图层」标签页中选中一个图像图层后重试。');
      return;
    }

    setIsProcessingAI(true);
    setAiStatus('正在按提示词生成内容…');
    try {
      const inpaintResult = await defaultInpaintingService.executeInpaint(
        currentDoc,
        selectedLayer.id,
        currentDoc.selection.bounds,
        currentDoc.selection.assetId,
        { prompt: genFillPromptText }
      );

      const patchLayer = await defaultInpaintingService.createPatchLayer(
        inpaintResult,
        `内容填充：${genFillPromptText.slice(0, 15) || '补丁'}`
      );

      try {
        assertCurrentLayer(defaultDocumentManager, currentDoc, selectedLayer.id);
        addGeneratedPatchLayer(currentDoc.id, patchLayer);
      } catch (error) { defaultAssetManager.releaseAsset(patchLayer.sourceAssetId); defaultAssetManager.releaseAsset(patchLayer.maskAssetId); throw error; }
      clearSelection(currentDoc.id);
      setActivePanel(null);
      setGenFillPromptText('');
      setAiStatus(null);
    } catch (err: any) {
      alert('内容填充失败：' + err.message + '。请调整提示词或缩小选区范围后重试。');
      setAiStatus(null);
    } finally {
      setIsProcessingAI(false);
    }
  };

  const togglePanel = (panel: 'adjust' | 'smart' | 'fill' | 'view') => {
    setActivePanel(activePanel === panel ? null : panel);
  };

  const panelButton = (panel: 'adjust' | 'smart' | 'fill' | 'view', label: string, icon: React.ReactNode) => (
    <button
      type="button"
      className={'selection-bar__button' + (activePanel === panel ? ' is-active' : '')}
      data-panel-trigger={panel}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={activePanel === panel}
      disabled={isProcessingAI && panel === 'fill'}
      onClick={() => togglePanel(panel)}
    >
      {icon}<span>{label}</span><ChevronDown size={12} aria-hidden="true" />
    </button>
  );

  return (
    <GlassSurface
      variant="floating"
      shape="pill"
      interactive={false}
      chromatic={false}
      refractionScale={5}
      className="selection-taskbar selection-bar"
      role="toolbar"
      aria-label="选区工具栏"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && activePanel) {
          event.preventDefault();
          const panel = activePanel;
          setActivePanel(null);
          event.currentTarget.querySelector<HTMLButtonElement>('[data-panel-trigger="' + panel + '"]')?.focus();
        }
      }}
    >
      <div className="selection-bar__row">
        <div className="selection-bar__mode" role="group" aria-label="选区运算模式">
          {([
            ['replace', '新选区', Square],
            ['add', '添加到选区', Plus],
            ['subtract', '从选区减去', Minus],
            ['intersect', '与选区交叉', BoxSelect],
          ] as const).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              className={'selection-bar__mode-button' + (booleanMode === mode ? ' is-active' : '')}
              onClick={() => setBooleanMode(mode)}
              aria-label={label}
              aria-pressed={booleanMode === mode}
              title={label + '（用于选择工具）'}
            ><Icon size={15} aria-hidden="true" /></button>
          ))}
        </div>

        <span className="selection-bar__divider" aria-hidden="true" />
        <button type="button" className="selection-bar__button" onClick={() => { setActivePanel(null); onAutoCutout?.(); }} disabled={!canAutoCutout || !onAutoCutout || isProcessingAI} title={canAutoCutout ? '自动识别所选图层并精修边缘' : '请先选择图像图层'}><Wand2 size={15} aria-hidden="true" /><span>自动抠图</span></button>
        {panelButton('smart', '智能选择', <Wand2 size={15} aria-hidden="true" />)}
        {panelButton('adjust', '羽化与扩缩', <SlidersHorizontal size={15} aria-hidden="true" />)}

        {hasSelection && (
          <>
            <span className="selection-bar__divider" aria-hidden="true" />
            {panelButton('fill', '内容填充', <Sparkles size={15} aria-hidden="true" />)}
            <button
              type="button"
              className="selection-bar__button selection-bar__button--danger"
              onClick={() => { setActivePanel(null); void handleRemoveObject(); }}
              disabled={isProcessingAI}
              title="用 AI 移除当前选区，生成可撤销的补丁图层"
            ><Eraser size={15} aria-hidden="true" /><span>移除</span></button>
          </>
        )}

        <span className="selection-bar__divider" aria-hidden="true" />
        <button type="button" className="selection-bar__button" onClick={() => { setActivePanel(null); void invertSelection(currentDoc.id); }} title="反选 (Ctrl+Shift+I)"><RotateCw size={14} aria-hidden="true" /><span>反选</span></button>
        {hasSelection ? (
          <button type="button" className="selection-bar__button" onClick={() => { setActivePanel(null); clearSelection(currentDoc.id); }} title="取消选区 (Ctrl+D)"><X size={14} aria-hidden="true" /><span>取消</span></button>
        ) : (
          <button type="button" className="selection-bar__button" onClick={() => { setActivePanel(null); void selectAll(currentDoc.id); }} title="全选 (Ctrl+A)">全选</button>
        )}
        {panelButton('view', '显示', <Eye size={15} aria-hidden="true" />)}
      </div>

      {aiStatus && <div className="selection-bar__status" role="status" aria-live="polite"><Loader2 size={13} className="animate-spin" aria-hidden="true" />{aiStatus}</div>}

      {activePanel && (
        <div className="selection-bar__panel" role="dialog" aria-label={
          activePanel === 'adjust' ? '调整选区' : activePanel === 'smart' ? '智能选择' : activePanel === 'fill' ? '内容填充' : '选区显示'
        }>
          {activePanel === 'adjust' && (
            <>
              <div className="selection-bar__panel-title">调整选区</div>
              <div className="selection-bar__form-row">
                <label htmlFor="selection-feather">羽化半径</label>
                <input id="selection-feather" type="number" min="0" max="100" value={featherRadius} onChange={(event) => setFeatherRadius(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} aria-label="羽化半径（像素）" />
                <span className="selection-bar__unit">px</span>
                {hasSelection && <button type="button" className="selection-bar__button is-primary" disabled={featherRadius <= 0} onClick={() => { void featherSelection(currentDoc.id, featherRadius); setActivePanel(null); }}>应用羽化</button>}
              </div>
              {hasSelection && <div className="selection-bar__form-row">
                <label htmlFor="selection-size">扩缩距离</label>
                <input id="selection-size" type="number" min="1" max="100" value={expandContractPx} onChange={(event) => setExpandContractPx(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} aria-label="扩展或收缩的像素数" />
                <span className="selection-bar__unit">px</span>
                <button type="button" className="selection-bar__button" onClick={() => { void expandSelection(currentDoc.id, expandContractPx); setActivePanel(null); }}><Maximize2 size={13} aria-hidden="true" />扩展</button>
                <button type="button" className="selection-bar__button" onClick={() => { void contractSelection(currentDoc.id, expandContractPx); setActivePanel(null); }}><Minimize2 size={13} aria-hidden="true" />收缩</button>
              </div>}
              {!hasSelection && <p className="selection-bar__hint">此半径也用于接下来的智能选择。</p>}
            </>
          )}
          {activePanel === 'smart' && (
            <>
              <div className="selection-bar__panel-title">智能选择</div>
              <div className="selection-bar__choices">
                <button type="button" className="selection-bar__button" disabled={isProcessingAI} onClick={() => { setActivePanel(null); void handleSelectSubject(); }}><User size={15} aria-hidden="true" />选择主体（创建选区）</button>
                <button type="button" className="selection-bar__button" disabled={isProcessingAI} onClick={() => { setActivePanel(null); void handleSelectSky(); }}><CloudSun size={15} aria-hidden="true" />选择天空（颜色辅助）</button>
                <button type="button" className="selection-bar__button" disabled={isProcessingAI} onClick={() => { setActivePanel(null); void handleSelectBackground(); }}><Wand2 size={15} aria-hidden="true" />选择背景</button>
              </div>
            </>
          )}
          {activePanel === 'fill' && hasSelection && (
            <>
              <div className="selection-bar__panel-title">内容填充</div>
              <label htmlFor="selection-fill-prompt" className="selection-bar__hint">描述希望生成的内容，留空可直接修补。</label>
              <input
                id="selection-fill-prompt"
                className="selection-bar__prompt"
                type="text"
                value={genFillPromptText}
                onChange={(event) => setGenFillPromptText(event.target.value)}
                aria-label="内容填充提示词"
                placeholder="例如：一片蓝色的天空"
                autoFocus
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void handleGenerativeFill(); } }}
              />
              <div className="selection-bar__panel-actions">
                <button type="button" className="selection-bar__button" onClick={() => setActivePanel(null)}>取消</button>
                <button type="button" className="selection-bar__button is-primary" disabled={isProcessingAI} onClick={() => void handleGenerativeFill()}>{isProcessingAI ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}生成</button>
              </div>
            </>
          )}
          {activePanel === 'view' && (
            <>
              <div className="selection-bar__panel-title">选区显示</div>
              <div className="selection-bar__choices" role="group" aria-label="选区叠加显示方式">
                <button type="button" className={'selection-bar__button' + (maskViewMode === 'normal' ? ' is-active' : '')} aria-pressed={maskViewMode === 'normal'} onClick={() => { setMaskViewMode('normal'); setActivePanel(null); }}>蚂蚁线</button>
                <button type="button" className={'selection-bar__button' + (maskViewMode === 'mask-overlay' ? ' is-active' : '')} aria-pressed={maskViewMode === 'mask-overlay'} onClick={() => { setMaskViewMode('mask-overlay'); setActivePanel(null); }}>红色蒙版</button>
              </div>
            </>
          )}
        </div>
      )}
    </GlassSurface>
  );
};
