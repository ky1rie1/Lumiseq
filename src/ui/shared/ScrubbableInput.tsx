// src/ui/shared/ScrubbableInput.tsx
//! High-Density Professional Scrubbable Parameter Input
//! Supports: 1) Horizontal Label Drag, 2) Slider, 3) Click-to-type numeric entry, 4) Double-click reset, 5) Shift/Alt precision.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ParameterDefinition } from './parameterDefinitions';
import { nudgeParameter, shouldNudgeHoveredParameter } from './parameterKeyboard';
import { RotateCcw } from 'lucide-react';

interface ScrubbableInputProps {
  param: ParameterDefinition;
  value: number;
  onStartDrag?: () => void;
  onPreviewDrag: (val: number) => void;
  onCommitDrag?: (val: number) => void;
  showSlider?: boolean;
}

export const ScrubbableInput: React.FC<ScrubbableInputProps> = ({
  param,
  value,
  onStartDrag,
  onPreviewDrag,
  onCommitDrag,
  showSlider = true,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editString, setEditString] = useState('');
  const [isSliderHovered, setIsSliderHovered] = useState(false);
  const startXRef = useRef(0);
  const startValRef = useRef(0);
  const isDraggingRef = useRef(false);
  const sliderActiveRef = useRef(false);
  const cancelEditRef = useRef(false);
  const keyboardActiveRef = useRef(false);
  const keyboardValueRef = useRef(value);
  const rangeRef = useRef<HTMLInputElement>(null);

  const safeParam = param || {
    id: 'param',
    label: '参数',
    min: -100,
    max: 100,
    step: 1,
    fineStep: 0.1,
    defaultValue: 0,
    formatter: (v: number) => String(v),
  };

  const formattedDisplay = safeParam.formatter
    ? safeParam.formatter(value)
    : `${value}${safeParam.unit ? ' ' + safeParam.unit : ''}`;
  const position = (number: number) => Math.max(0, Math.min(100, ((number - safeParam.min) / (safeParam.max - safeParam.min || 1)) * 100));
  const defaultPosition = position(safeParam.defaultValue);
  const valuePosition = position(value);

  const handleReset = useCallback(() => {
    onStartDrag?.();
    onPreviewDrag(safeParam.defaultValue);
    onCommitDrag?.(safeParam.defaultValue);
  }, [safeParam.defaultValue, onStartDrag, onPreviewDrag, onCommitDrag]);

  // Direct numeric entry submit
  const commitEdit = () => {
    setIsEditing(false);
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      return;
    }
    const parsed = parseFloat(editString);
    if (!isNaN(parsed) && isFinite(parsed)) {
      const clamped = Math.max(safeParam.min, Math.min(safeParam.max, parsed));
      onStartDrag?.();
      onPreviewDrag(clamped);
      onCommitDrag?.(clamped);
    }
  };

  const beginSliderChange = () => {
    if (sliderActiveRef.current) return;
    sliderActiveRef.current = true;
    onStartDrag?.();
  };

  const commitSliderChange = (finalValue: number) => {
    if (!sliderActiveRef.current) return;
    sliderActiveRef.current = false;
    onCommitDrag?.(finalValue);
  };

  useEffect(() => { keyboardValueRef.current = value; }, [value]);

  useEffect(() => {
    if (!isSliderHovered || isEditing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!shouldNudgeHoveredParameter(event,target instanceof HTMLElement?target.tagName:null,
        target===rangeRef.current,target instanceof HTMLElement&&target.isContentEditable)) return;
      event.preventDefault();
      if (!keyboardActiveRef.current) {
        keyboardActiveRef.current = true;
        beginSliderChange();
      }
      const next = nudgeParameter(keyboardValueRef.current, safeParam, event.key, event.shiftKey);
      keyboardValueRef.current = next;
      onPreviewDrag(next);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!keyboardActiveRef.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      keyboardActiveRef.current = false;
      commitSliderChange(keyboardValueRef.current);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isSliderHovered, isEditing, safeParam, onPreviewDrag, onStartDrag, onCommitDrag]);

  const leaveSlider = () => {
    setIsSliderHovered(false);
    if (keyboardActiveRef.current) {
      keyboardActiveRef.current = false;
      commitSliderChange(keyboardValueRef.current);
    }
  };

  // Label horizontal scrub drag
  const handleLabelMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startValRef.current = value;
    isDraggingRef.current = true;
    onStartDrag?.();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = moveEvent.clientX - startXRef.current;
      let stepFactor = safeParam.step;
      if (moveEvent.shiftKey) stepFactor = safeParam.fineStep;
      if (moveEvent.altKey) stepFactor = safeParam.fineStep * 0.1;

      const delta = dx * stepFactor * 0.5;
      const nextVal = Math.max(safeParam.min, Math.min(safeParam.max, startValRef.current + delta));
      onPreviewDrag(nextVal);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      const dx = upEvent.clientX - startXRef.current;
      let stepFactor = safeParam.step;
      if (upEvent.shiftKey) stepFactor = safeParam.fineStep;
      if (upEvent.altKey) stepFactor = safeParam.fineStep * 0.1;
      const nextVal = Math.max(safeParam.min, Math.min(safeParam.max, startValRef.current + dx * stepFactor * 0.5));
      onCommitDrag?.(nextVal);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="scrubbable-input select-none">
      <div className="flex items-center justify-between">
        {/* Scrubbable Label */}
        <div className="flex items-center space-x-1">
          <span
            onMouseDown={handleLabelMouseDown}
            onDoubleClick={handleReset}
            className="scrubbable-label text-studio-300 hover:text-studio-100 cursor-ew-resize transition-colors select-none"
            title="左右拖动微调，按住 Shift 更精细，双击恢复默认值"
          >
            {safeParam.label}
          </span>
          {Math.abs(value - safeParam.defaultValue) > 1e-4 && (
            <button
              onClick={handleReset}
              className="text-studio-500 hover:text-studio-300 p-0.5 rounded cursor-pointer"
              title={`恢复默认值 (${safeParam.defaultValue})`}
              aria-label={`重置 ${safeParam.label}`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Value: Click to directly type or display */}
        {isEditing ? (
          <input
            type="text"
            autoFocus
            value={editString}
            onChange={(e) => setEditString(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') {
                cancelEditRef.current = true;
                e.currentTarget.blur();
              }
            }}
            className="w-20 bg-studio-950 border border-sky-500 rounded px-1 py-1 text-right font-mono text-studio-100 outline-none text-xs"
          />
        ) : (
          <button type="button"
            onClick={() => {
              cancelEditRef.current = false;
              setEditString(value.toString());
              setIsEditing(true);
            }}
            className="scrubbable-value font-mono text-studio-100 hover:text-sky-300 cursor-text px-1 rounded transition-colors text-right"
            title="点击直接键入数值；双击参数名称恢复默认值"
          >
            {formattedDisplay}
          </button>
        )}
      </div>

      {/* Mini Slider Track */}
      {showSlider && (
        <div className="scrubbable-track-wrap">
        <span className="scrubbable-default-mark" style={{ left: `${defaultPosition}%` }} aria-hidden="true" />
        <input
          ref={rangeRef}
          type="range"
          min={safeParam.min}
          max={safeParam.max}
          step={safeParam.step}
          value={value}
          aria-label={safeParam.label}
          aria-valuetext={formattedDisplay}
          style={{ '--slider-start': `${Math.min(defaultPosition, valuePosition)}%`, '--slider-end': `${Math.max(defaultPosition, valuePosition)}%` } as React.CSSProperties}
          onPointerDown={beginSliderChange}
          onPointerEnter={() => setIsSliderHovered(true)}
          onPointerLeave={leaveSlider}
          onChange={(e) => {
            beginSliderChange();
            onPreviewDrag(parseFloat(e.target.value));
          }}
          onPointerUp={(e) => commitSliderChange(parseFloat(e.currentTarget.value))}
          onPointerCancel={(e) => commitSliderChange(parseFloat(e.currentTarget.value))}
          onKeyUp={(e) => { if (!keyboardActiveRef.current) commitSliderChange(parseFloat(e.currentTarget.value)); }}
          onBlur={(e) => commitSliderChange(parseFloat(e.currentTarget.value))}
          className="scrubbable-range w-full"
        />
        </div>
      )}
    </div>
  );
};
