// src/ui/workspaces/edit/ContextToolbar.tsx
//! Contextual Top Tool Options Bar (Phase 6)
//! Dynamically updates options for Brush, Retouch, Gradient, Eyedropper, Crop, and Transform.

import React from 'react';
import type { EditTool } from './editTools';
import type { SelectionMode } from '../../../selection/types';
import { BrushSettings } from '../../../brush/BrushSettings';
import { BlendMode } from '../../../types/edit';
import { EyedropperSampleSize } from '../../../tools/eyedropper';
import { GradientType, GradientPreset } from '../../../tools/gradient';
import { BLEND_MODE_LABELS, ALL_BLEND_MODES } from '../../../types/blendModeLabels';
import { Check, RotateCcw } from 'lucide-react';

interface ContextToolbarProps {
  activeTool: EditTool;
  selectionMode: SelectionMode;
  onChangeSelectionMode: (mode: SelectionMode) => void;
  selectionFeather: number;
  onChangeSelectionFeather: (value: number) => void;
  cropRatio: number | null;
  onChangeCropRatio: (value: number | null) => void;
  hasCropDraft: boolean;
  autoSelectLayer: boolean;
  onChangeAutoSelectLayer: (value: boolean) => void;
  snapEnabled: boolean;
  onChangeSnapEnabled: (value: boolean) => void;
  showTransformControls: boolean;
  onChangeShowTransformControls: (value: boolean) => void;
  brushSettings: BrushSettings;
  onChangeBrushSettings: (settings: Partial<BrushSettings>) => void;
  eyedropperSize: EyedropperSampleSize;
  onChangeEyedropperSize: (size: EyedropperSampleSize) => void;
  gradientType: GradientType;
  onChangeGradientType: (type: GradientType) => void;
  gradientPreset: GradientPreset;
  onChangeGradientPreset: (preset: GradientPreset) => void;
  onApplyCrop?: () => void;
  onResetCrop?: () => void;
}

export const ContextToolbar: React.FC<ContextToolbarProps> = ({
  activeTool,
  selectionMode,
  onChangeSelectionMode,
  selectionFeather,
  onChangeSelectionFeather,
  cropRatio,
  onChangeCropRatio,
  hasCropDraft,
  autoSelectLayer,
  onChangeAutoSelectLayer,
  snapEnabled,
  onChangeSnapEnabled,
  showTransformControls,
  onChangeShowTransformControls,
  brushSettings,
  onChangeBrushSettings,
  eyedropperSize,
  onChangeEyedropperSize,
  gradientType,
  onChangeGradientType,
  gradientPreset,
  onChangeGradientPreset,
  onApplyCrop,
  onResetCrop,
}) => {
  // Derived from the shared label map so the option list can never drift from the BlendMode union.
  const blendModes = ALL_BLEND_MODES;
  const blendModeLabels = BLEND_MODE_LABELS;

  return (
    <div className="editor-options h-10 bg-[#18181b]/95 border-b border-white/10 px-4 flex items-center flex-nowrap whitespace-nowrap text-xs text-white/70 select-none z-10">
      {activeTool.startsWith('select-') && (
        <>
          <span className="text-white/80">{activeTool === 'select-rect' ? '矩形选框' : activeTool === 'select-ellipse' ? '椭圆选框' : activeTool === 'select-lasso' ? '自由套索' : activeTool === 'select-polygon' ? '多边形套索' : '对象选择'}</span>
          <div role="group" aria-label="选区运算模式" className="flex items-center rounded border border-white/10 bg-[#27272a] p-0.5">
            {([['replace', '新建'], ['add', '添加'], ['subtract', '减去'], ['intersect', '交叉']] as const).map(([mode, label]) =>
              <button key={mode} type="button" aria-pressed={selectionMode === mode} onClick={() => onChangeSelectionMode(mode)} className={`px-2 py-0.5 rounded ${selectionMode === mode ? 'bg-[#b6d2f51c] text-[#d3e4ff]' : 'hover:bg-white/5'}`}>{label}</button>)}
          </div>
          <label className="flex items-center gap-1">羽化 <input aria-label="选择羽化像素" type="number" min="0" max="100" value={selectionFeather} onChange={event => onChangeSelectionFeather(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className="w-12 rounded border border-white/10 bg-[#27272a] px-1 py-0.5 text-white" /> px</label>
          {activeTool === 'select-polygon' && <span className="text-white/50">点击添加节点 · Enter / 双击闭合 · Backspace 回退</span>}
        </>
      )}
      {/* Brush Tool Options */}
      {activeTool === 'brush' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-white/40">大小</span>
            <input
              type="range"
              min="1"
              max="300"
              value={brushSettings.size}
              onChange={(e) => onChangeBrushSettings({ size: Number(e.target.value) })}
              className="w-20 h-1 bg-white/10 rounded-lg cursor-pointer"
            />
            <span className="font-mono text-white/90 w-8">{brushSettings.size}px</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-white/40">硬度</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={brushSettings.hardness}
              onChange={(e) => onChangeBrushSettings({ hardness: Number(e.target.value) })}
              className="w-16 h-1 bg-white/10 rounded-lg cursor-pointer"
            />
            <span className="font-mono text-white/90 w-8">{Math.round(brushSettings.hardness * 100)}%</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-white/40">不透明度</span>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={brushSettings.opacity}
              onChange={(e) => onChangeBrushSettings({ opacity: Number(e.target.value) })}
              className="w-16 h-1 bg-white/10 rounded-lg cursor-pointer"
            />
            <span className="font-mono text-white/90 w-8">{Math.round(brushSettings.opacity * 100)}%</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-white/40">流量</span>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={brushSettings.flow}
              onChange={(e) => onChangeBrushSettings({ flow: Number(e.target.value) })}
              className="w-16 h-1 bg-white/10 rounded-lg cursor-pointer"
            />
            <span className="font-mono text-white/90 w-8">{Math.round(brushSettings.flow * 100)}%</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-white/40">混合模式</span>
            <select
              value={brushSettings.blendMode}
              aria-label="混合模式"
              onChange={(e) => onChangeBrushSettings({ blendMode: e.target.value as BlendMode })}
              className="bg-[#27272a] border border-white/10 rounded px-2 py-0.5 text-xs text-white focus:outline-none capitalize"
            >
              {blendModes.map((bm) => (
                <option key={bm} value={bm}>
                  {blendModeLabels[bm]}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Retouch Tools Options */}
      {(activeTool === 'spot-heal' || activeTool === 'clone-stamp') && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-white/40">大小</span>
            <input
              type="range"
              min="2"
              max="200"
              value={brushSettings.size}
              onChange={(e) => onChangeBrushSettings({ size: Number(e.target.value) })}
              className="w-24 h-1 bg-white/10 rounded-lg cursor-pointer"
            />
            <span className="font-mono text-white/90 w-8">{brushSettings.size}px</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white/40">硬度</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={brushSettings.hardness}
              onChange={(e) => onChangeBrushSettings({ hardness: Number(e.target.value) })}
              className="w-20 h-1 bg-white/10 rounded-lg cursor-pointer"
            />
            <span className="font-mono text-white/90 w-8">{Math.round(brushSettings.hardness * 100)}%</span>
          </div>
          {activeTool === 'clone-stamp' && (
            <span className="text-[11px] text-white/40 italic">按住 Alt 点击定义取样源</span>
          )}
        </>
      )}

      {/* Gradient Tool Options */}
      {activeTool === 'gradient' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-white/40">渐变类型</span>
            <div className="flex bg-[#27272a] rounded p-0.5 border border-white/10">
              <button
                onClick={() => onChangeGradientType('linear')}
                aria-pressed={gradientType === 'linear'}
                className={`px-2.5 py-0.5 rounded text-xs transition-colors ${
                  gradientType === 'linear' ? 'bg-[#b6d2f51c] text-[#d3e4ff] font-medium' : 'text-white/60 hover:text-white'
                }`}
              >
                线性
              </button>
              <button
                onClick={() => onChangeGradientType('radial')}
                aria-pressed={gradientType === 'radial'}
                className={`px-2.5 py-0.5 rounded text-xs transition-colors ${
                  gradientType === 'radial' ? 'bg-[#b6d2f51c] text-[#d3e4ff] font-medium' : 'text-white/60 hover:text-white'
                }`}
              >
                径向
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-white/40">预设</span>
            <select
              value={gradientPreset}
              aria-label="渐变预设"
              onChange={(e) => onChangeGradientPreset(e.target.value as GradientPreset)}
              className="bg-[#27272a] border border-white/10 rounded px-2 py-0.5 text-xs text-white focus:outline-none"
            >
              <option value="fg-to-bg">前景色到背景色</option>
              <option value="fg-to-transparent">前景色到透明</option>
            </select>
          </div>
        </>
      )}

      {/* Eyedropper Options */}
      {activeTool === 'eyedropper' && (
        <div className="flex items-center gap-2">
          <span className="text-white/40">取样大小</span>
          <div className="flex bg-[#27272a] rounded p-0.5 border border-white/10">
            {([1, 3, 5] as const).map((sz) => (
              <button
                key={sz}
                onClick={() => onChangeEyedropperSize(sz)}
                aria-pressed={eyedropperSize === sz}
                aria-label={`取样大小 ${sz}x${sz}`}
                className={`px-2.5 py-0.5 rounded text-xs transition-colors ${
                  eyedropperSize === sz ? 'bg-[#b6d2f51c] text-[#d3e4ff] font-medium' : 'text-white/60 hover:text-white'
                }`}
              >
                {sz}x{sz}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Crop Tool Options */}
      {activeTool === 'crop' && (
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1">比例
            <select aria-label="裁剪比例" value={cropRatio === null ? 'free' : String(cropRatio)} onChange={event => onChangeCropRatio(event.target.value === 'free' ? null : Number(event.target.value))} className="rounded border border-white/10 bg-[#27272a] px-2 py-0.5 text-white">
              <option value="free">自由</option><option value="1">1:1</option><option value="1.5">3:2</option><option value="1.7777777777777777">16:9</option>
            </select>
          </label>
          <span className="text-white/40">无损裁剪 · 三分线</span>
          {onApplyCrop && (
            <button
              onClick={onApplyCrop}
              disabled={!hasCropDraft}
              className="flex items-center gap-1 px-3 py-1 bg-[#c7dbf5] text-[#1a1c20] text-xs font-medium rounded hover:bg-[#dceafd] transition-colors shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              应用裁剪
            </button>
          )}
          {onResetCrop && (
            <button
              onClick={onResetCrop}
              disabled={!hasCropDraft}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-white/60 hover:text-white hover:bg-white/5 rounded transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              取消
            </button>
          )}
        </div>
      )}

      {/* Move / Default */}
      {activeTool === 'move' && (
        <>
          <label className="flex items-center gap-1"><input type="checkbox" checked={autoSelectLayer} onChange={event => onChangeAutoSelectLayer(event.target.checked)} /> 自动选层</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={showTransformControls} onChange={event => onChangeShowTransformControls(event.target.checked)} /> 显示变换控件</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={snapEnabled} onChange={event => onChangeSnapEnabled(event.target.checked)} /> 智能吸附</label>
          <span className="text-white/40">拖动对齐边缘与中心 · Alt 临时关闭吸附</span>
        </>
      )}
    </div>
  );
};
