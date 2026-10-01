// src/ui/workspaces/edit/ColorPickerModal.tsx
//! Photoshop-Style Color Picker Dialog (Phase 6)
//! HEX, RGB and HSL editing share exact RGB values; only labels are rounded.

import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, normalizeHexColor, defaultColorState } from '../../../color/colorState';
import { OverlayModal } from '../../shared/OverlayModal';

interface ColorPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: 'foreground' | 'background';
}

export const ColorPickerModal: React.FC<ColorPickerModalProps> = ({ isOpen, onClose, target }) => {
  const currentState = defaultColorState.getState();
  const initialHex = target === 'foreground' ? currentState.foreground : currentState.background;

  const [hex, setHex] = useState(initialHex);
  const [rgb, setRgb] = useState(hexToRgb(initialHex));
  const [hsl, setHsl] = useState(rgbToHsl(rgb.r, rgb.g, rgb.b));
  const validHex = normalizeHexColor(hex);
  const previewHex = rgbToHex(rgb.r, rgb.g, rgb.b);

  const handleHexChange = (newHex: string) => {
    setHex(newHex);
    const normalized = normalizeHexColor(newHex);
    if (normalized) {
      const newRgb = hexToRgb(normalized);
      setRgb(newRgb);
      setHsl(rgbToHsl(newRgb.r, newRgb.g, newRgb.b));
    }
  };

  const handleRgbChange = (channel: 'r' | 'g' | 'b', value: number) => {
    if (!Number.isFinite(value)) return;
    const updated = { ...rgb, [channel]: Math.round(Math.max(0, Math.min(255, value))) };
    setRgb(updated);
    const newHex = rgbToHex(updated.r, updated.g, updated.b);
    setHex(newHex);
    setHsl(rgbToHsl(updated.r, updated.g, updated.b));
  };

  const handleHslChange = (channel: 'h' | 's' | 'l', value: number) => {
    if (!Number.isFinite(value)) return;
    const maxVal = channel === 'h' ? 360 : 100;
    const updated = { ...hsl, [channel]: Math.max(0, Math.min(maxVal, value)) };
    setHsl(updated);
    const newRgb = hslToRgb(updated.h, updated.s, updated.l);
    setRgb(newRgb);
    setHex(rgbToHex(newRgb.r, newRgb.g, newRgb.b));
  };

  const handleApply = () => {
    if (!validHex) return;
    if (target === 'foreground') {
      defaultColorState.setForeground(validHex);
    } else {
      defaultColorState.setBackground(validHex);
    }
    onClose();
  };

  return (
    <OverlayModal
      open={isOpen}
      onClose={onClose}
      label={target === 'foreground' ? '拾色器 · 前景色' : '拾色器 · 背景色'}
      overlayClassName="p-4"
      className="color-picker max-w-md"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#27272a]">
        <h2 className="text-sm font-semibold text-white/90">
          拾色器（{target === 'foreground' ? '前景色' : '背景色'}）
        </h2>
        <button
          onClick={onClose}
          aria-label="关闭拾色器"
          title="关闭拾色器 (Esc)"
          className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
          <X className="w-4 h-4" />
        </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
        {/* Swatch Previews */}
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-lg border border-white/20 shadow-inner flex-shrink-0"
            style={{ backgroundColor: previewHex }}
            role="img"
            aria-label={`当前颜色 ${previewHex}`}
            />
          <div className="flex-1 space-y-1">
            <label className="text-[11px] font-medium text-white/50 uppercase tracking-wider">HEX</label>
            <input
              type="text"
              value={hex}
              onChange={(e) => handleHexChange(e.target.value)}
              aria-label="十六进制颜色值"
              aria-invalid={!validHex}
              aria-describedby={!validHex ? 'picker-hex-error' : undefined}
              className="w-full bg-[#27272a] border border-white/10 rounded-md px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
              />
            {!validHex && <p id="picker-hex-error" role="alert" className="text-xs text-red-300">请输入 3 位或 6 位十六进制颜色，例如 #1167e7。</p>}
          </div>
        </div>

        {/* RGB Sliders */}
        <div className="space-y-3 bg-[#27272a] p-3 rounded-lg border border-white/5">
          <div className="flex items-center justify-between text-xs text-white/60 mb-1">
            <span>RGB 通道</span>
          </div>
          {(['r', 'g', 'b'] as const).map((ch) => (
            <div key={ch} className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold text-white/70 w-3 uppercase">{ch}</span>
              <input
                type="range"
                min="0"
                max="255"
                value={rgb[ch]}
                onChange={(e) => handleRgbChange(ch, Number(e.target.value))}
                aria-label={`${ch.toUpperCase()} 通道`}
                className="flex-1 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
              <input
                type="number"
                min="0"
                max="255"
                value={rgb[ch]}
                onChange={(e) => handleRgbChange(ch, Number(e.target.value))}
                aria-label={`${ch.toUpperCase()} 通道数值`}
                className="w-14 bg-[#27272a] border border-white/10 rounded px-2 py-0.5 text-xs font-mono text-white text-right"
                />
            </div>
          ))}
        </div>

        {/* HSL Sliders */}
        <div className="space-y-3 bg-[#27272a] p-3 rounded-lg border border-white/5">
          <div className="flex items-center justify-between text-xs text-white/60 mb-1">
            <span>HSL 通道</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-bold text-white/70 w-3">H</span>
            <input
              type="range"
              min="0"
              max="360"
              step="any"
              value={hsl.h}
              onChange={(e) => handleHslChange('h', Number(e.target.value))}
              aria-label="色相 H"
              className="flex-1 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
            <span className="w-14 text-xs font-mono text-white/80 text-right">{Number(hsl.h.toFixed(1))}°</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-bold text-white/70 w-3">S</span>
            <input
              type="range"
              min="0"
              max="100"
              step="any"
              value={hsl.s}
              onChange={(e) => handleHslChange('s', Number(e.target.value))}
              aria-label="饱和度 S"
              className="flex-1 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
            <span className="w-14 text-xs font-mono text-white/80 text-right">{Number(hsl.s.toFixed(1))}%</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-bold text-white/70 w-3">L</span>
            <input
              type="range"
              min="0"
              max="100"
              step="any"
              value={hsl.l}
              onChange={(e) => handleHslChange('l', Number(e.target.value))}
              aria-label="亮度 L"
              className="flex-1 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
            <span className="w-14 text-xs font-mono text-white/80 text-right">{Number(hsl.l.toFixed(1))}%</span>
          </div>
        </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10 bg-[#27272a]">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/5 rounded-md transition-colors"
          >
          取消
        </button>
        <button
          onClick={handleApply}
          disabled={!validHex}
          title="应用当前颜色"
          className="color-picker-apply flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          应用颜色
        </button>
      </div>
    </OverlayModal>
  );
};
