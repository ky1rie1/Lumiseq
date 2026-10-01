import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Point2D } from '../../../types/common';
import { ToneCurves } from '../../../types/develop';
import { SegmentedControl } from '../../shared/SegmentedControl';
import { buildMonotonicCurveLUT } from '../../../engine/curveLut';
import { RotateCcw } from 'lucide-react';
import { cssToCurve, curveToCss, hitCurvePoint, moveCurvePoint, numericCurvePosition, startCurvePointer } from './curveCoordinates';

export type CurveChannelType = keyof ToneCurves;
interface CurveEditorProps {
  curves: ToneCurves;
  onChangeCurves: (curves: ToneCurves) => void;
  onBegin?: () => void;
  onPreview?: (curves: ToneCurves) => void;
  onCommit?: () => void;
  onAbort?: () => void;
  enabled?: boolean;
  width?: number;
  height?: number;
}
const identity = (): Point2D[] => [{ x: 0, y: 0 }, { x: 1, y: 1 }];

export const CurveEditor: React.FC<CurveEditorProps> = ({ curves, onChangeCurves, onBegin, onPreview, onCommit, onAbort, enabled = true, width = 240, height = 200 }) => {
  const [channel, setChannel] = useState<CurveChannelType>('rgb');
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState({ x: '', y: '' });
  const [error, setError] = useState('');
  // The edit adjustment panel also uses this editor: keep its discrete callback compatible.
  const [localCurves, setLocalCurves] = useState<ToneCurves | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const values = useRef(curves);
  const selection = useRef(selected);
  const transaction = useRef(false);
  const pointer = useRef<number | null>(null);
  const keys = useRef(new Set<string>());
  const callbacks = useRef({ onBegin, onPreview, onCommit, onAbort, onChangeCurves });
  callbacks.current = { onBegin, onPreview, onCommit, onAbort, onChangeCurves };
  values.current = localCurves ?? curves;
  selection.current = selected;
  const points = (localCurves ?? curves)[channel];
  const point = selected === null ? undefined : points[selected];

  const end = useCallback((abort: boolean) => {
    if (transaction.current) {
      transaction.current = false;
      if (abort) callbacks.current.onAbort?.();
      else if (callbacks.current.onCommit) callbacks.current.onCommit();
      else callbacks.current.onChangeCurves(values.current);
      setLocalCurves(null);
    }
    keys.current.clear();
    const captured = pointer.current;
    pointer.current = null;
    if (captured !== null && canvasRef.current?.hasPointerCapture(captured)) canvasRef.current.releasePointerCapture(captured);
  }, []);
  useEffect(() => () => end(true), [end]);
  useEffect(() => { if (!enabled) end(true); }, [enabled, end]);
  useEffect(() => {
    setDraft({ x: point ? String(Math.round(point.x * 255)) : '', y: point ? String(Math.round(point.y * 255)) : '' });
    setError('');
  }, [point?.x, point?.y, selected, channel]);
  const begin = () => { if (!transaction.current) { callbacks.current.onBegin?.(); transaction.current = true; } };
  const preview = (next: ToneCurves) => {
    try { if (callbacks.current.onPreview) callbacks.current.onPreview(next); else setLocalCurves(next); values.current = next; }
    catch (cause) { end(true); setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const select = (index: number | null) => { selection.current = index; setSelected(index); };
  const update = (position: Point2D) => {
    const index = selection.current;
    if (index !== null) {
      const old = values.current[channel][index];
      const next = moveCurvePoint(values.current[channel], index, position);
      if (next[index].x !== old.x || next[index].y !== old.y) preview({ ...values.current, [channel]: next });
    }
  };
  const change = (next: ToneCurves) => {
    try { onChangeCurves(next); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const box = canvas.getBoundingClientRect();
    const w = box.width || width, h = box.height || height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(canvas);
    const token = (name: string) => style.getPropertyValue(name).trim();
    const background = token('--ui-base'), stroke = token(channel === 'rgb' ? '--ui-text' : `--curve-${channel}`);
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = background; ctx.fillRect(12, 12, w - 24, h - 24);
    ctx.strokeStyle = token('--ui-divider'); ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const x = 12 + (w - 24) * i / 4, y = 12 + (h - 24) * i / 4;
      ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, h - 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(w - 12, y); ctx.stroke();
    }
    ctx.strokeStyle = token('--ui-border'); ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(12, h - 12); ctx.lineTo(w - 12, 12); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeRect(12, 12, w - 24, h - 24);
    const lut = buildMonotonicCurveLUT(points, 256);
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const p = curveToCss({ x: i / 255, y: lut[i] }, w, h);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    points.forEach((point, index) => {
      const p = curveToCss(point, w, h);
      ctx.fillStyle = index === selected ? token('--ui-accent') : stroke;
      ctx.beginPath(); ctx.arc(p.x, p.y, index === selected ? 5.5 : 4, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = background; ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI); ctx.fill();
    });
  }, [points, channel, selected, width, height]);
  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    window.addEventListener('resize', draw);
    return () => { observer.disconnect(); window.removeEventListener('resize', draw); };
  }, [draw]);
  const position = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const css = { x: event.clientX - box.left, y: event.clientY - box.top };
    return { css, coord: cssToCurve(css, box.width, box.height), box };
  };
  const remove = () => {
    end(false);
    const index = selection.current, points = values.current[channel];
    if (index === null || index === 0 || index === points.length - 1) return;
    change({ ...values.current, [channel]: points.filter((_, i) => i !== index) }); select(null);
  };
  const keyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); end(true); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (selection.current === null || !enabled || pointer.current !== null) return;
    const point = values.current[channel][selection.current];
    if (!point) return;
    keys.current.add(event.key); begin();
    const step = (event.shiftKey ? 10 : 1) / 255;
    update({ x: point.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      y: point.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0) });
  };
  const submitNumbers = () => {
    end(false);
    if (!point) return;
    try {
      const next = moveCurvePoint(values.current[channel], selected!, numericCurvePosition(point, draft));
      if (next[selected!].x !== point.x || next[selected!].y !== point.y) change({ ...values.current, [channel]: next });
      setDraft({ x: String(Math.round(next[selected!].x * 255)), y: String(Math.round(next[selected!].y * 255)) });
    } catch { setError('坐标必须是 0–255 的有限数字'); }
  };
  const numberKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      setDraft({ x: String(Math.round((point?.x ?? 0) * 255)), y: String(Math.round((point?.y ?? 0) * 255)) }); setError('');
    }
  };

  return <div className="curve-editor space-y-2 select-none">
    <div className="flex items-center justify-between">
      <div className="w-56"><SegmentedControl<CurveChannelType> options={[
        { id: 'rgb', label: 'RGB' }, { id: 'red', label: '红' }, { id: 'green', label: '绿' }, { id: 'blue', label: '蓝' },
      ]} activeId={channel} onChange={next => { end(true); setChannel(next); select(null); }} /></div>
      <button type="button" aria-label="重置通道" title="重置当前通道曲线" onClick={() => { end(true); change({ ...values.current, [channel]: identity() }); select(null); }} className="text-studio-500 hover:text-studio-300 p-1"><RotateCcw size={12} /></button>
    </div>
    <div className="flex justify-center bg-studio-950 rounded p-1 border border-studio-800">
      <canvas ref={canvasRef} style={{ width, height, maxWidth: '100%', touchAction: 'none' }} tabIndex={0} role="application" aria-label="色调曲线控制点" aria-describedby="curve-keyboard-help"
        onPointerDown={event => {
          if (event.button !== 0 || !enabled) return;
          event.preventDefault(); end(false);
          const { css, coord, box } = startCurvePointer(event.currentTarget, { x: event.clientX, y: event.clientY });
          const points = values.current[channel];
          let index = hitCurvePoint(points, css, box.width, box.height);
          if (index === null && (points.length < 2 || coord.x <= points[0].x || coord.x >= points[points.length - 1].x || points.some(p => Math.abs(p.x - coord.x) < 1e-6))) return;
          begin(); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId);
          if (index === null) {
            const next = [...points, coord].sort((a, b) => a.x - b.x);
            index = next.indexOf(coord); preview({ ...values.current, [channel]: next });
          }
          select(index);
        }}
        onPointerMove={event => { if (event.pointerId === pointer.current) update(position(event).coord); }}
        onPointerUp={event => { if (event.pointerId === pointer.current) end(false); }}
        onPointerCancel={() => end(true)} onLostPointerCapture={() => { if (pointer.current !== null) end(true); }}
        onKeyDown={keyDown} onKeyUp={event => { if (keys.current.delete(event.key)) { event.preventDefault(); event.stopPropagation(); if (!keys.current.size) end(false); } }}
        onBlur={() => end(false)} onContextMenu={event => { event.preventDefault(); remove(); }} className="cursor-crosshair rounded block" />
    </div>
    <form className="curve-coordinates" onSubmit={event => { event.preventDefault(); submitNumbers(); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) submitNumbers(); }}>
      <label>X <input aria-label="曲线输入 X" type="number" min={0} max={255} step={1} disabled={!point || selected === 0 || selected === points.length - 1} value={draft.x} onChange={event => setDraft({ ...draft, x: event.target.value })} onKeyDown={numberKey} /></label>
      <label>Y <input aria-label="曲线输出 Y" type="number" min={0} max={255} step={1} disabled={!point} value={draft.y} onChange={event => setDraft({ ...draft, y: event.target.value })} onKeyDown={numberKey} /></label>
      <button type="submit" disabled={!point}>应用</button>
      <button type="button" onClick={() => { end(true); change({ rgb: identity(), red: identity(), green: identity(), blue: identity() }); select(null); }}>全部重置</button>
    </form>
    {error && <p role="alert" className="text-2xs text-studio-400">{error}</p>}
    <p id="curve-keyboard-help" className="text-2xs text-studio-500">点击添加 / 选择 · 方向键 1，Shift 10 · Delete 删除内点 · Esc 取消</p>
  </div>;
};
