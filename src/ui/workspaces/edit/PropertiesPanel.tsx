import { defaultLayerOperationService, LAYER_ALIGNMENTS, LayerAlignment } from '../../../edit/LayerOperationService';
import { isLayerLocked, locateLayer } from '../../../edit/LayerTree';
// src/ui/workspaces/edit/PropertiesPanel.tsx
//! Photoshop-Class Contextual Properties Inspector (Phase 6)
//! Provides real-time parameter controls for Adjustments, Smart Objects, Typography, and Transforms.

import React, { useState } from 'react';
import {
  EditDocument,
  Layer,
  LayerType,
  AdjustmentLayer,
  SmartObjectLayer,
  TextLayer,
  BlendMode,
  AdjustmentSettings,
  ColorBalanceSettings,
  BlackAndWhiteSettings,
  LevelsSettings,
  CurvesSettings,
  SmartFilter,
  SmartFilterType,
} from '../../../types/edit';
import { Sliders, Sparkles, Type, Box, RefreshCw, Palette, Eye, EyeOff, Trash2, ArrowUp, ArrowDown, Plus } from 'lucide-react';
import { useAppStore } from '../../../stores/useAppStore';
import { ADJUSTMENT_TYPE_LABELS } from '../../../types/adjustmentLabels';
import { BLEND_MODE_LABELS } from '../../../types/blendModeLabels';
import { ToneCurves } from '../../../types/develop';
import { CurveEditor } from '../develop/CurveEditor';
import { TextEffectsPanel } from './TextEffectsPanel';
import { SMART_FILTER_LABELS, SMART_FILTER_TYPES } from '../../../filters/smartFilters';
import { defaultRawSmartObjects } from '../../../smartobject/RawSmartObjectService';

interface PropertiesPanelProps {
  document?: EditDocument;
  selectedLayer: Layer | null;
  onUpdateAdjustment: (layerId: string, settings: AdjustmentSettings) => void;
  onUpdateTransform: (layerId: string, transform: { x?: number; y?: number; width?: number; height?: number; rotation?: number }) => void;
  onUpdateOpacity: (layerId: string, opacity: number) => void;
  onUpdateBlendMode: (layerId: string, blendMode: BlendMode) => void;
  onRasterizeSmartObject?: (layerId: string) => void;
  onAddSmartFilter?: (layerId: string, type: SmartFilterType) => void;
  onUpdateSmartFilter?: (layerId: string, filterId: string, patch: Partial<SmartFilter>) => void;
  onSetSmartFilterEnabled?: (layerId: string, filterId: string, enabled: boolean) => void;
  onRemoveSmartFilter?: (layerId: string, filterId: string) => void;
  onReorderSmartFilter?: (layerId: string, filterId: string, toIndex: number) => void;
}

/** 混合模式与调整类型显示名统一来自 src/types/，与图层快捷属性、工具选项条共用同一份。 */
/** 图层类型显示名；仅用于界面展示，不改变图层数据结构。 */
const LAYER_TYPE_LABELS: Record<LayerType, string> = {
  image: '图像',
  text: '文字',
  paint: '绘画',
  retouch: '修饰',
  adjustment: '调整',
  'smart-object': '智能对象',
  group: '图层组',
  shape: '形状',
  'develop-smart-object': '调色智能对象',
  'generated-patch': 'AI 生成补丁',
};

/** 调整类型显示名统一来自 src/types/adjustmentLabels.ts，与图层工厂、图层面板共用同一份。 */
export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  document: _document,
  selectedLayer,
  onUpdateAdjustment,
  onUpdateTransform,
  onUpdateOpacity,
  onUpdateBlendMode,
  onRasterizeSmartObject,
  onAddSmartFilter,
  onUpdateSmartFilter,
  onSetSmartFilterEnabled,
  onRemoveSmartFilter,
  onReorderSmartFilter,
}) => {
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const [operationError, setOperationError] = useState('');
  const locked = selectedLayer ? (_document ? isLayerLocked(_document, selectedLayer.id) : !!selectedLayer.locked) : false;
  const inheritedLock = !!(_document && selectedLayer && locateLayer(_document.layers, selectedLayer.id)?.ancestors.some(layer => layer.locked));
  const perform = (operation: () => unknown) => {
    setOperationError('');
    try { void Promise.resolve(operation()).catch(error => setOperationError(error instanceof Error ? error.message : String(error))); }
    catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
  };
  const alignmentLabels: Record<LayerAlignment, string> = { left: '左对齐', center: '水平居中', right: '右对齐', top: '顶部对齐', middle: '垂直居中', bottom: '底部对齐' };

  if (!selectedLayer) {
    return (
      <div className="w-72 bg-[#18181b] border-l border-white/10 p-4 text-center text-white/40 text-xs flex flex-col items-center justify-center h-full select-none">
        <Box className="w-8 h-8 mb-2 opacity-30" />
        <span>未选择图层</span>
        <span className="text-[11px] text-white/30 mt-1">请在右侧「图层」标签页中选择一个图层，即可查看并调整属性</span>
      </div>
    );
  }

  const blendModes: BlendMode[] = [
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'color-dodge',
    'color-burn',
    'hard-light',
    'soft-light',
    'difference',
    'exclusion',
    'hue',
    'saturation',
    'color',
    'luminosity',
  ];

  return (
    <div className="w-72 bg-[#18181b] border-l border-white/10 flex flex-col h-full text-xs text-white/80 select-none overflow-y-auto">
      {/* Header: Layer Info */}
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-white/90 truncate" title={selectedLayer.name}>{selectedLayer.name}</span>
          <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono tracking-wider bg-white/5 border border-white/10 text-cyan-400">
            {LAYER_TYPE_LABELS[selectedLayer.type]}
          </span>
        </div>

        {_document && <div className="flex gap-1">
          <button type="button" className="icon-button text-2xs" title="复制所选图层" aria-label="复制所选图层" disabled={inheritedLock} onClick={() => perform(() => defaultLayerOperationService.duplicate(_document.id, selectedLayer.id))}>复制</button>
          <button type="button" className="icon-button text-2xs" title={inheritedLock ? '父图层组已锁定' : selectedLayer.locked ? '解锁图层' : '锁定图层'} aria-label={selectedLayer.locked ? '解锁图层' : '锁定图层'} disabled={inheritedLock} onClick={() => perform(() => defaultLayerOperationService.setLocked(_document.id, selectedLayer.id, !selectedLayer.locked))}>{selectedLayer.locked ? '解锁' : '锁定'}</button>
        </div>}
        {locked && <p className="text-[10px] text-white/45">图层或父组已锁定，请先解锁以修改。</p>}
        {operationError && <p role="alert" className="text-[10px] text-red-300">{operationError}</p>}
        {_document && selectedLayer.type === 'develop-smart-object' && <button type="button" disabled={locked} className="button-secondary w-full" onClick={() => perform(async () => {
          await defaultRawSmartObjects.openRecipe(_document.id, selectedLayer.id);
          setWorkspace('develop');
        })}><Sliders className="w-3.5 h-3.5"/>编辑 RAW 参数</button>}
        <fieldset disabled={locked}>
        {/* Blend Mode & Opacity */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <label className="text-[10px] font-medium text-white/40 uppercase block mb-1">混合模式</label>
            <select
              value={selectedLayer.blendMode}
              onChange={(e) => onUpdateBlendMode(selectedLayer.id, e.target.value as BlendMode)}
              aria-label="混合模式"
              className="w-full bg-[#27272a] border border-white/10 rounded px-2 py-1 text-xs text-white capitalize focus:outline-none"
            >
              {blendModes.map((bm) => (
                <option key={bm} value={bm}>
                  {BLEND_MODE_LABELS[bm]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-medium text-white/40 uppercase">不透明度</label>
              <span className="font-mono text-white/70">{Math.round(selectedLayer.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={selectedLayer.opacity}
              onChange={(e) => onUpdateOpacity(selectedLayer.id, Number(e.target.value))}
              aria-label={`不透明度 ${Math.round(selectedLayer.opacity * 100)}%`}
              className="w-full h-1.5 bg-white/10 rounded-lg cursor-pointer"
            />
          </div>
        </div>
      </fieldset>
      </div>

      {/* Contextual Properties Content */}
      <fieldset disabled={locked} className="p-4 space-y-5 flex-1 min-w-0">
        {/* 1. Adjustment Layer Controls */}
        {selectedLayer.type === 'adjustment' && (
          <AdjustmentInspector
            layer={selectedLayer as AdjustmentLayer}
            onChangeSettings={(newSettings) => onUpdateAdjustment(selectedLayer.id, newSettings)}
          />
        )}

        {/* 2. Smart Object Layer Controls */}
        {selectedLayer.type === 'smart-object' && (
          <SmartObjectInspector
            layer={selectedLayer as SmartObjectLayer}
            onOpenInDevelop={() => setWorkspace('develop')}
            onRasterize={() => onRasterizeSmartObject && onRasterizeSmartObject(selectedLayer.id)}
            onAddFilter={(type) => onAddSmartFilter?.(selectedLayer.id, type)}
            onUpdateFilter={(filterId, patch) => onUpdateSmartFilter?.(selectedLayer.id, filterId, patch)}
            onSetFilterEnabled={(filterId, enabled) => onSetSmartFilterEnabled?.(selectedLayer.id, filterId, enabled)}
            onRemoveFilter={(filterId) => onRemoveSmartFilter?.(selectedLayer.id, filterId)}
            onReorderFilter={(filterId, toIndex) => onReorderSmartFilter?.(selectedLayer.id, filterId, toIndex)}
          />
        )}

        {/* 3. Text Layer Typography */}
        {selectedLayer.type === 'text' && <><TextLayerInspector layer={selectedLayer as TextLayer} />{_document && <TextEffectsPanel key={selectedLayer.id} layer={selectedLayer} documentId={_document.id} />}</>}

        {/* 4. Transform Inspector */}
        <div className="space-y-3 pt-3 border-t border-white/10">
          <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
            <Box className="w-3.5 h-3.5 text-cyan-400" />
            <span>变换</span>
          </div>
          {_document && <div className="space-y-1.5">
            <div className="grid grid-cols-3 gap-1">{LAYER_ALIGNMENTS.map(alignment => <button key={alignment} type="button" className="bg-white/5 border border-white/10 rounded px-1 py-1.5 text-[10px]" title={`${alignmentLabels[alignment]}到画布`} aria-label={`${alignmentLabels[alignment]}到画布`} onClick={() => perform(() => defaultLayerOperationService.align(_document.id, selectedLayer.id, alignment))}>{alignmentLabels[alignment]}</button>)}</div>
            <div className="grid grid-cols-2 gap-1"><button type="button" className="bg-white/5 border border-white/10 rounded py-1.5 text-[10px]" title="围绕显示中心水平翻转" aria-label="水平翻转图层" onClick={() => perform(() => defaultLayerOperationService.flip(_document.id, selectedLayer.id, 'horizontal'))}>水平翻转</button><button type="button" className="bg-white/5 border border-white/10 rounded py-1.5 text-[10px]" title="围绕显示中心垂直翻转" aria-label="垂直翻转图层" onClick={() => perform(() => defaultLayerOperationService.flip(_document.id, selectedLayer.id, 'vertical'))}>垂直翻转</button></div>
          </div>}
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div>
              <span className="text-white/40 block text-[10px]">X 坐标 (px)</span>
              <input
                type="number"
                value={Math.round(selectedLayer.transform.x)}
                onChange={(e) => onUpdateTransform(selectedLayer.id, { x: Number(e.target.value) })}
                aria-label="X 坐标（像素）"
                className="w-full bg-[#27272a] border border-white/10 rounded px-2 py-1 text-white"
              />
            </div>
            <div>
              <span className="text-white/40 block text-[10px]">Y 坐标 (px)</span>
              <input
                type="number"
                value={Math.round(selectedLayer.transform.y)}
                onChange={(e) => onUpdateTransform(selectedLayer.id, { y: Number(e.target.value) })}
                aria-label="Y 坐标（像素）"
                className="w-full bg-[#27272a] border border-white/10 rounded px-2 py-1 text-white"
              />
            </div>
            <div>
              <span className="text-white/40 block text-[10px]">宽度 (px)</span>
              <input
                type="number"
                value={Math.round(selectedLayer.transform.width)}
                onChange={(e) => onUpdateTransform(selectedLayer.id, { width: Math.max(1, Number(e.target.value)) })}
                aria-label="宽度（像素）"
                className="w-full bg-[#27272a] border border-white/10 rounded px-2 py-1 text-white"
              />
            </div>
            <div>
              <span className="text-white/40 block text-[10px]">高度 (px)</span>
              <input
                type="number"
                value={Math.round(selectedLayer.transform.height)}
                onChange={(e) => onUpdateTransform(selectedLayer.id, { height: Math.max(1, Number(e.target.value)) })}
                aria-label="高度（像素）"
                className="w-full bg-[#27272a] border border-white/10 rounded px-2 py-1 text-white"
              />
            </div>
          </div>
        </div>
      </fieldset>
    </div>
  );
};

/**
 * Adjustment Layer Parameter Sliders
 */
const AdjustmentInspector: React.FC<{
  layer: AdjustmentLayer;
  onChangeSettings: (settings: AdjustmentSettings) => void;
}> = ({ layer, onChangeSettings }) => {
  const { adjustmentType, settings } = layer;

  if (adjustmentType === 'exposure' && settings.type === 'exposure') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          <span>曝光设置</span>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-white/60">曝光</span>
            <span className="font-mono">{settings.values.exposure.toFixed(2)} EV</span>
          </div>
          <input
            type="range"
            min="-5"
            max="5"
            step="0.05"
            value={settings.values.exposure}
            onChange={(e) =>
              onChangeSettings({
                type: 'exposure',
                values: { ...settings.values, exposure: Number(e.target.value) },
              })
            }
            aria-label="曝光"
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
          />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-white/60">偏移</span>
            <span className="font-mono">{(settings.values.offset ?? 0).toFixed(3)}</span>
          </div>
          <input
            type="range"
            min="-0.5"
            max="0.5"
            step="0.01"
            value={settings.values.offset ?? 0}
            onChange={(e) =>
              onChangeSettings({
                type: 'exposure',
                values: { ...settings.values, offset: Number(e.target.value) },
              })
            }
            aria-label="偏移"
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
          />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-white/60">灰度系数校正</span>
            <span className="font-mono">{(settings.values.gamma ?? 1).toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="4.0"
            step="0.05"
            value={settings.values.gamma ?? 1}
            onChange={(e) =>
              onChangeSettings({
                type: 'exposure',
                values: { ...settings.values, gamma: Number(e.target.value) },
              })
            }
            aria-label="灰度系数校正"
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
          />
        </div>
      </div>
    );
  }

  if (adjustmentType === 'brightness_contrast' && settings.type === 'brightness_contrast') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          <span>亮度/对比度</span>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-white/60">亮度</span>
            <span className="font-mono">{settings.values.brightness}</span>
          </div>
          <input
            type="range"
            min="-100"
            max="100"
            value={settings.values.brightness}
            onChange={(e) =>
              onChangeSettings({
                type: 'brightness_contrast',
                values: { ...settings.values, brightness: Number(e.target.value) },
              })
            }
            aria-label="亮度"
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
          />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-white/60">对比度</span>
            <span className="font-mono">{settings.values.contrast}</span>
          </div>
          <input
            type="range"
            min="-100"
            max="100"
            value={settings.values.contrast}
            onChange={(e) =>
              onChangeSettings({
                type: 'brightness_contrast',
                values: { ...settings.values, contrast: Number(e.target.value) },
              })
            }
            aria-label="对比度"
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
          />
        </div>
      </div>
    );
  }

  if (adjustmentType === 'hue_saturation' && settings.type === 'hue_saturation') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          <span>色相/饱和度</span>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-white/60">色相</span>
            <span className="font-mono">{settings.values.hue}°</span>
          </div>
          <input
            type="range"
            min="-180"
            max="180"
            value={settings.values.hue}
            onChange={(e) =>
              onChangeSettings({
                type: 'hue_saturation',
                values: { ...settings.values, hue: Number(e.target.value) },
              })
            }
            aria-label="色相"
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
          />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-white/60">饱和度</span>
            <span className="font-mono">{settings.values.saturation}</span>
          </div>
          <input
            type="range"
            min="-100"
            max="100"
            value={settings.values.saturation}
            onChange={(e) =>
              onChangeSettings({
                type: 'hue_saturation',
                values: { ...settings.values, saturation: Number(e.target.value) },
              })
            }
            aria-label="饱和度"
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
          />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-white/60">明度</span>
            <span className="font-mono">{settings.values.lightness}</span>
          </div>
          <input
            type="range"
            min="-100"
            max="100"
            value={settings.values.lightness}
            onChange={(e) =>
              onChangeSettings({
                type: 'hue_saturation',
                values: { ...settings.values, lightness: Number(e.target.value) },
              })
            }
            aria-label="明度"
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
          />
        </div>
      </div>
    );
  }

  if (adjustmentType === 'color_balance' && settings.type === 'color_balance') {
    return (
      <ColorBalanceInspector
        settings={settings.values}
        onChange={(newVals) =>
          onChangeSettings({
            type: 'color_balance',
            values: newVals,
          })
        }
      />
    );
  }

  if (adjustmentType === 'black_and_white' && settings.type === 'black_and_white') {
    return (
      <BlackAndWhiteInspector
        settings={settings.values}
        onChange={(newVals) =>
          onChangeSettings({
            type: 'black_and_white',
            values: newVals,
          })
        }
      />
    );
  }

  if (adjustmentType === 'levels' && settings.type === 'levels') {
    return (
      <LevelsInspector
        settings={settings.values}
        onChange={(newVals) =>
          onChangeSettings({
            type: 'levels',
            values: newVals,
          })
        }
      />
    );
  }

  if (adjustmentType === 'curves' && settings.type === 'curves') {
    return (
      <CurvesInspector
        settings={settings.values}
        onChange={(newVals) =>
          onChangeSettings({
            type: 'curves',
            values: newVals,
          })
        }
      />
    );
  }

  return (
    <div className="space-y-1 text-white/50 text-[11px]">
      <span>调整：{ADJUSTMENT_TYPE_LABELS[adjustmentType]}</span>
      <span className="block">该调整类型暂未在此面板提供可调参数。</span>
    </div>
  );
};

/**
 * Color Balance Inspector
 */
const ColorBalanceInspector: React.FC<{
  settings: ColorBalanceSettings;
  onChange: (newSettings: ColorBalanceSettings) => void;
}> = ({ settings, onChange }) => {
  const [toneRange, setToneRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const currentTone = settings[toneRange];

  const updateRange = (field: 'cyanRed' | 'magentaGreen' | 'yellowBlue', val: number) => {
    onChange({
      ...settings,
      [toneRange]: {
        ...currentTone,
        [field]: val,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
        <Palette className="w-3.5 h-3.5 text-yellow-400" />
        <span>色彩平衡设置</span>
      </div>

      <div className="grid grid-cols-3 gap-1 bg-[#27272a] p-0.5 rounded text-[10px]">
        {(['shadows', 'midtones', 'highlights'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setToneRange(r)}
            className={`py-1 rounded text-center transition-colors cursor-pointer ${
              toneRange === r ? 'bg-[#3f3f46] text-white font-medium shadow-xs' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {r === 'shadows' ? '阴影' : r === 'midtones' ? '中间调' : '高光'}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="text-cyan-400">青色</span>
          <span className="font-mono text-white/80">{currentTone.cyanRed > 0 ? `+${currentTone.cyanRed}` : currentTone.cyanRed}</span>
          <span className="text-red-400">红色</span>
        </div>
        <input
          type="range"
          min="-100"
          max="100"
          value={currentTone.cyanRed}
          onChange={(e) => updateRange('cyanRed', Number(e.target.value))}
          className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
        />
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="text-fuchsia-400">洋红</span>
          <span className="font-mono text-white/80">{currentTone.magentaGreen > 0 ? `+${currentTone.magentaGreen}` : currentTone.magentaGreen}</span>
          <span className="text-emerald-400">绿色</span>
        </div>
        <input
          type="range"
          min="-100"
          max="100"
          value={currentTone.magentaGreen}
          onChange={(e) => updateRange('magentaGreen', Number(e.target.value))}
          className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
        />
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="text-yellow-400">黄色</span>
          <span className="font-mono text-white/80">{currentTone.yellowBlue > 0 ? `+${currentTone.yellowBlue}` : currentTone.yellowBlue}</span>
          <span className="text-blue-400">蓝色</span>
        </div>
        <input
          type="range"
          min="-100"
          max="100"
          value={currentTone.yellowBlue}
          onChange={(e) => updateRange('yellowBlue', Number(e.target.value))}
          className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
        />
      </div>

      <label className="flex items-center space-x-2 cursor-pointer pt-1 text-[11px] text-white/70">
        <input
          type="checkbox"
          checked={settings.preserveLuminosity}
          onChange={(e) => onChange({ ...settings, preserveLuminosity: e.target.checked })}
          className="rounded bg-[#27272a] border-white/20 text-cyan-500 focus:ring-0"
        />
        <span>保持明度</span>
      </label>
    </div>
  );
};

/**
 * Black & White Inspector
 */
const BlackAndWhiteInspector: React.FC<{
  settings: BlackAndWhiteSettings;
  onChange: (newSettings: BlackAndWhiteSettings) => void;
}> = ({ settings, onChange }) => {
  const channels = [
    { key: 'reds', label: '红色', color: 'text-red-400' },
    { key: 'yellows', label: '黄色', color: 'text-yellow-400' },
    { key: 'greens', label: '绿色', color: 'text-green-400' },
    { key: 'cyans', label: '青色', color: 'text-cyan-400' },
    { key: 'blues', label: '蓝色', color: 'text-blue-400' },
    { key: 'magentas', label: '洋红', color: 'text-pink-400' },
  ] as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
        <Sliders className="w-3.5 h-3.5 text-cyan-400" />
        <span>黑白混合比例</span>
      </div>

      {channels.map(({ key, label, color }) => (
        <div key={key} className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className={color}>{label}</span>
            <span className="font-mono text-white/80">{(settings as any)[key]}%</span>
          </div>
          <input
            type="range"
            min="-50"
            max="200"
            value={(settings as any)[key]}
            onChange={(e) =>
              onChange({
                ...settings,
                [key]: Number(e.target.value),
              })
            }
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
          />
        </div>
      ))}
    </div>
  );
};

/**
 * Levels Inspector
 */
const LevelsInspector: React.FC<{
  settings: LevelsSettings;
  onChange: (newSettings: LevelsSettings) => void;
}> = ({ settings, onChange }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
        <Sliders className="w-3.5 h-3.5 text-cyan-400" />
        <span>色阶调整 (Levels)</span>
      </div>

      <div className="space-y-3 bg-[#27272a]/50 p-2.5 rounded border border-white/5">
        <span className="text-white/40 block text-[10px] uppercase font-bold">输入色阶</span>
        <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
          <div>
            <span className="text-white/50 block">黑场</span>
            <input
              type="number"
              min="0"
              max={settings.inputWhite - 1}
              value={settings.inputBlack}
              onChange={(e) => onChange({ ...settings, inputBlack: Math.min(settings.inputWhite - 1, Math.max(0, Number(e.target.value))) })}
              className="w-full bg-[#18181b] border border-white/10 rounded px-1.5 py-0.5 text-center text-white font-mono mt-0.5"
            />
          </div>
          <div>
            <span className="text-white/50 block">灰度系数</span>
            <input
              type="number"
              step="0.05"
              min="0.1"
              max="9.9"
              value={settings.inputGamma}
              onChange={(e) => onChange({ ...settings, inputGamma: Math.max(0.1, Math.min(9.9, Number(e.target.value))) })}
              className="w-full bg-[#18181b] border border-white/10 rounded px-1.5 py-0.5 text-center text-white font-mono mt-0.5"
            />
          </div>
          <div>
            <span className="text-white/50 block">白场</span>
            <input
              type="number"
              min={settings.inputBlack + 1}
              max="255"
              value={settings.inputWhite}
              onChange={(e) => onChange({ ...settings, inputWhite: Math.max(settings.inputBlack + 1, Math.min(255, Number(e.target.value))) })}
              className="w-full bg-[#18181b] border border-white/10 rounded px-1.5 py-0.5 text-center text-white font-mono mt-0.5"
            />
          </div>
        </div>

        <div className="space-y-1.5 pt-1">
          <input
            type="range"
            min="0"
            max="255"
            value={settings.inputBlack}
            onChange={(e) => onChange({ ...settings, inputBlack: Math.min(settings.inputWhite - 1, Number(e.target.value)) })}
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
            title="输入黑场"
          />
          <input
            type="range"
            min="0"
            max="255"
            value={settings.inputWhite}
            onChange={(e) => onChange({ ...settings, inputWhite: Math.max(settings.inputBlack + 1, Number(e.target.value)) })}
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
            title="输入白场"
          />
        </div>
      </div>

      <div className="space-y-3 bg-[#27272a]/50 p-2.5 rounded border border-white/5">
        <span className="text-white/40 block text-[10px] uppercase font-bold">输出色阶</span>
        <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
          <div>
            <span className="text-white/50 block">输出黑场</span>
            <input
              type="number"
              min="0"
              max="255"
              value={settings.outputBlack}
              onChange={(e) => onChange({ ...settings, outputBlack: Math.max(0, Math.min(255, Number(e.target.value))) })}
              className="w-full bg-[#18181b] border border-white/10 rounded px-1.5 py-0.5 text-center text-white font-mono mt-0.5"
            />
          </div>
          <div>
            <span className="text-white/50 block">输出白场</span>
            <input
              type="number"
              min="0"
              max="255"
              value={settings.outputWhite}
              onChange={(e) => onChange({ ...settings, outputWhite: Math.max(0, Math.min(255, Number(e.target.value))) })}
              className="w-full bg-[#18181b] border border-white/10 rounded px-1.5 py-0.5 text-center text-white font-mono mt-0.5"
            />
          </div>
        </div>

        <div className="space-y-1.5 pt-1">
          <input
            type="range"
            min="0"
            max="255"
            value={settings.outputBlack}
            onChange={(e) => onChange({ ...settings, outputBlack: Number(e.target.value) })}
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
            title="输出黑场"
          />
          <input
            type="range"
            min="0"
            max="255"
            value={settings.outputWhite}
            onChange={(e) => onChange({ ...settings, outputWhite: Number(e.target.value) })}
            className="w-full h-1.5 bg-white/10 rounded cursor-pointer"
            title="输出白场"
          />
        </div>
      </div>
    </div>
  );
};

/**
 * Curves Inspector
 */
const CurvesInspector: React.FC<{
  settings: CurvesSettings;
  onChange: (newSettings: CurvesSettings) => void;
}> = ({ settings, onChange }) => {
  const toneCurves: ToneCurves = {
    rgb: (settings.rgb || [{ x: 0, y: 0 }, { x: 255, y: 255 }]).map((p) => ({ x: p.x / 255, y: p.y / 255 })),
    red: (settings.red || [{ x: 0, y: 0 }, { x: 255, y: 255 }]).map((p) => ({ x: p.x / 255, y: p.y / 255 })),
    green: (settings.green || [{ x: 0, y: 0 }, { x: 255, y: 255 }]).map((p) => ({ x: p.x / 255, y: p.y / 255 })),
    blue: (settings.blue || [{ x: 0, y: 0 }, { x: 255, y: 255 }]).map((p) => ({ x: p.x / 255, y: p.y / 255 })),
  };

  const handleChangeToneCurves = (tc: ToneCurves) => {
    onChange({
      rgb: tc.rgb.map((p) => ({ x: Math.round(p.x * 255), y: Math.round(p.y * 255) })),
      red: tc.red.map((p) => ({ x: Math.round(p.x * 255), y: Math.round(p.y * 255) })),
      green: tc.green.map((p) => ({ x: Math.round(p.x * 255), y: Math.round(p.y * 255) })),
      blue: tc.blue.map((p) => ({ x: Math.round(p.x * 255), y: Math.round(p.y * 255) })),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
        <Sliders className="w-3.5 h-3.5 text-purple-400" />
        <span>曲线调整 (Curves)</span>
      </div>
      <div className="pt-1">
        <CurveEditor
          curves={toneCurves}
          onChangeCurves={handleChangeToneCurves}
          width={245}
          height={180}
        />
      </div>
    </div>
  );
};

/**
 * Smart Object Inspector
 */
const SmartObjectInspector: React.FC<{
  layer: SmartObjectLayer;
  onOpenInDevelop: () => void;
  onRasterize: () => void;
  onAddFilter: (type: SmartFilterType) => void;
  onUpdateFilter: (filterId: string, patch: Partial<SmartFilter>) => void;
  onSetFilterEnabled: (filterId: string, enabled: boolean) => void;
  onRemoveFilter: (filterId: string) => void;
  onReorderFilter: (filterId: string, toIndex: number) => void;
}> = ({ layer, onOpenInDevelop, onRasterize, onAddFilter, onUpdateFilter, onSetFilterEnabled, onRemoveFilter, onReorderFilter }) => {
  const [newFilterType, setNewFilterType] = useState<SmartFilterType>('gaussian_blur');
  const filters = layer.smartFilters || [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
        <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
        <span>智能对象</span>
      </div>

      <div className="space-y-2 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-white/60">智能滤镜</span>
          <span className="text-[10px] text-white/35">{filters.length} 个</span>
        </div>
        <div className="flex gap-1.5">
          <select
            value={newFilterType}
            onChange={(event) => setNewFilterType(event.target.value as SmartFilterType)}
            aria-label="选择智能滤镜"
            className="min-w-0 flex-1 bg-[#27272a] border border-white/10 rounded px-2 py-1.5 text-[11px] text-white"
          >
            {SMART_FILTER_TYPES.map((type) => <option key={type} value={type}>{SMART_FILTER_LABELS[type]}</option>)}
          </select>
          <button
            type="button"
            onClick={() => onAddFilter(newFilterType)}
            aria-label="添加智能滤镜"
            className="px-2 py-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
          ><Plus className="w-3.5 h-3.5" /></button>
        </div>

        {filters.length === 0 ? (
          <p className="text-[10px] leading-4 text-white/35 border border-dashed border-white/10 rounded p-2">添加后仍保留原始像素，可随时修改、关闭或删除。</p>
        ) : filters.map((filter, index) => (
          <div key={filter.id} className="rounded border border-white/10 bg-black/15 p-2 space-y-2">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => onSetFilterEnabled(filter.id, !filter.enabled)} aria-label={filter.enabled ? `关闭${filter.name}` : `启用${filter.name}`} className="text-white/55 hover:text-white">
                {filter.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <strong className={`flex-1 text-[11px] ${filter.enabled ? 'text-white/80' : 'text-white/35'}`}>{filter.name}</strong>
              <button type="button" disabled={index === 0} onClick={() => onReorderFilter(filter.id, index - 1)} aria-label={`上移${filter.name}`} className="disabled:opacity-25 text-white/45 hover:text-white"><ArrowUp className="w-3 h-3" /></button>
              <button type="button" disabled={index === filters.length - 1} onClick={() => onReorderFilter(filter.id, index + 1)} aria-label={`下移${filter.name}`} className="disabled:opacity-25 text-white/45 hover:text-white"><ArrowDown className="w-3 h-3" /></button>
              <button type="button" onClick={() => onRemoveFilter(filter.id)} aria-label={`删除${filter.name}`} className="text-white/40 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            <SmartFilterControls filter={filter} onChange={(settings) => onUpdateFilter(filter.id, { settings })} />
            <label className="flex items-center gap-2 text-[10px] text-white/45">
              <span>强度</span>
              <input className="flex-1" type="range" min="0" max="1" step="0.01" value={filter.opacity} onChange={(event) => onUpdateFilter(filter.id, { opacity: Number(event.target.value) })} aria-label={`${filter.name}强度`} />
              <span className="w-8 text-right font-mono">{Math.round(filter.opacity * 100)}%</span>
            </label>
          </div>
        ))}
      </div>

      <div className="bg-[#27272a]/50 p-3 rounded-lg border border-white/5 space-y-2 text-[11px]">
        <div className="flex justify-between">
          <span className="text-white/40">原始尺寸</span>
          <span className="font-mono text-white/80">
            {layer.originalWidth} x {layer.originalHeight} px
          </span>
        </div>
        {layer.sourceRawUri && (
          <div>
            <span className="text-white/40 block">RAW 源文件</span>
            <span className="font-mono text-white/70 text-[10px] break-all">{layer.sourceRawUri}</span>
          </div>
        )}
      </div>

      {layer.developSettings && (
        <button
          onClick={onOpenInDevelop}
          title="切换到照片调色工作区，继续调整该 RAW 的原始参数"
          className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          在照片调色中编辑 RAW
        </button>
      )}

      <button
        onClick={onRasterize}
        title="栅格化后将转换为普通图像图层，不再保留 RAW 调整"
        className="w-full flex items-center justify-center gap-2 py-1.5 px-3 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-lg text-xs transition-colors"
      >
        栅格化图层
      </button>
    </div>
  );
};

const SmartFilterControls: React.FC<{ filter: SmartFilter; onChange: (settings: SmartFilter['settings']) => void }> = ({ filter, onChange }) => {
  const slider = (label: string, value: number, minimum: number, maximum: number, step: number, update: (value: number) => SmartFilter['settings']) => (
    <label className="grid grid-cols-[48px_1fr_38px] items-center gap-1.5 text-[10px] text-white/45">
      <span>{label}</span>
      <input type="range" min={minimum} max={maximum} step={step} value={value} onChange={(event) => onChange(update(Number(event.target.value)))} aria-label={`${filter.name}${label}`} />
      <span className="text-right font-mono text-white/60">{Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}</span>
    </label>
  );
  if (filter.type === 'gaussian_blur') {
    const settings = filter.settings as { radius: number };
    return slider('半径', settings.radius, 0, 64, 1, (radius) => ({ radius }));
  }
  if (filter.type === 'unsharp_mask') {
    const settings = filter.settings as { radius: number; amount: number; threshold: number };
    return <div className="space-y-1.5">
      {slider('半径', settings.radius, 1, 32, 1, (radius) => ({ ...settings, radius }))}
      {slider('数量', settings.amount, 0, 4, 0.05, (amount) => ({ ...settings, amount }))}
      {slider('阈值', settings.threshold, 0, 255, 1, (threshold) => ({ ...settings, threshold }))}
    </div>;
  }
  const settings = filter.settings as { radius: number; strength: number; preserveEdges: number };
  return <div className="space-y-1.5">
    {slider('半径', settings.radius, 1, 16, 1, (radius) => ({ ...settings, radius }))}
    {slider('强度', settings.strength, 0, 1, 0.01, (strength) => ({ ...settings, strength }))}
    {slider('保边', settings.preserveEdges, 0, 1, 0.01, (preserveEdges) => ({ ...settings, preserveEdges }))}
  </div>;
};

/**
 * Text Layer Inspector
 */
const TextLayerInspector: React.FC<{ layer: TextLayer }> = ({ layer }) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-white/50 font-medium text-[11px] uppercase tracking-wider">
        <Type className="w-3.5 h-3.5 text-cyan-400" />
        <span>文字属性</span>
      </div>
      <div className="space-y-2 text-[11px]">
        <span className="text-white/40 block">文字内容</span>
        <textarea
          readOnly
          value={layer.text}
          rows={2}
          aria-label="文字内容"
          className="w-full bg-[#27272a] border border-white/10 rounded p-2 text-white resize-none"
        />
        <div className="flex justify-between">
          <span className="text-white/40">字号</span>
          <span className="font-mono">{layer.fontSize} px</span>
        </div>
      </div>
    </div>
  );
};
