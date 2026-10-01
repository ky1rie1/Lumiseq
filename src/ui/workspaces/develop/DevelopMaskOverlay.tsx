import React, { useEffect, useRef, useState } from 'react';
import { defaultAssetManager } from '../../../assets/AssetManager';
import { Point2D } from '../../../types/common';
import { DevelopMask } from '../../../types/develop';

export interface MaskDrawMode { kind: DevelopMask['kind']; replace: boolean }

interface Props {
  mask: DevelopMask | null;
  showOverlay: boolean;
  drawMode: MaskDrawMode | null;
  width: number;
  height: number;
  onDrawComplete: (mode: MaskDrawMode, start: Point2D, end: Point2D, points: Point2D[]) => void;
}

function pointForEvent(event: React.PointerEvent<HTMLCanvasElement>): Point2D {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

export const DevelopMaskOverlay: React.FC<Props> = ({ mask, showOverlay, drawMode, width, height, onDrawComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draftRef = useRef<{ start: Point2D; points: Point2D[] } | null>(null);
  const [draft, setDraft] = useState<{ start: Point2D; end: Point2D; points: Point2D[] } | null>(null);

  useEffect(() => {
    if (!drawMode) {
      draftRef.current = null;
      setDraft(null);
    }
  }, [drawMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!mask || !showOverlay) return;
    let cancelled = false;
    void (async () => {
      const handle = defaultAssetManager.getHandle(mask.maskAssetId);
      const pixels = await defaultAssetManager.getMask(mask.maskAssetId);
      if (cancelled || !handle?.width || !handle.height || !pixels || pixels.length !== handle.width * handle.height) return;
      const bitmapCanvas = document.createElement('canvas');
      bitmapCanvas.width = handle.width;
      bitmapCanvas.height = handle.height;
      const bitmapContext = bitmapCanvas.getContext('2d');
      if (!bitmapContext) return;
      const image = bitmapContext.createImageData(handle.width, handle.height);
      for (let index = 0; index < pixels.length; index++) {
        const amount = mask.inverted ? 255 - pixels[index] : pixels[index];
        const offset = index * 4;
        image.data[offset] = 255;
        image.data[offset + 1] = 90;
        image.data[offset + 2] = 85;
        image.data[offset + 3] = Math.round(amount * mask.opacity * 0.48);
      }
      bitmapContext.putImageData(image, 0, 0);
      if (!cancelled) context.drawImage(bitmapCanvas, 0, 0, width, height);
    })();
    return () => { cancelled = true; };
  }, [mask, showOverlay, width, height]);

  const draftStroke = draft?.points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ');
  return <>
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full ${drawMode ? 'cursor-crosshair' : 'pointer-events-none'}`}
      style={{ touchAction: drawMode ? 'none' : 'auto' }}
      onPointerDown={(event) => {
        if (!drawMode) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = pointForEvent(event);
        draftRef.current = { start: point, points: [point] };
        setDraft({ start: point, end: point, points: [point] });
      }}
      onPointerMove={(event) => {
        if (!drawMode || !draftRef.current) return;
        const point = pointForEvent(event);
        if (drawMode.kind === 'brush') draftRef.current.points.push(point);
        setDraft({ start: draftRef.current.start, end: point, points: [...draftRef.current.points] });
      }}
      onPointerUp={(event) => {
        if (!drawMode || !draftRef.current) return;
        const draft = draftRef.current;
        const end = pointForEvent(event);
        if (drawMode.kind === 'brush') draft.points.push(end);
        draftRef.current = null;
        setDraft(null);
        onDrawComplete(drawMode, draft.start, end, draft.points);
      }}
      onPointerCancel={() => {
        draftRef.current = null;
        setDraft(null);
      }}
      title={drawMode ? `拖动绘制${drawMode.kind === 'linear' ? '线性渐变' : drawMode.kind === 'radial' ? '径向渐变' : '画笔蒙版'}` : undefined}
      aria-label={drawMode ? '在图像上绘制局部蒙版' : undefined}
      data-drawing={draft ? 'true' : 'false'}
    />
    {draft && drawMode && <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {drawMode.kind === 'linear' && <>
        <line x1={draft.start.x * 1000} y1={draft.start.y * 1000} x2={draft.end.x * 1000} y2={draft.end.y * 1000} stroke="#fef3c7" strokeWidth="3" strokeDasharray="10 7" />
        <circle cx={draft.start.x * 1000} cy={draft.start.y * 1000} r="9" fill="#fef3c7" />
        <circle cx={draft.end.x * 1000} cy={draft.end.y * 1000} r="9" fill="#fef3c7" />
      </>}
      {drawMode.kind === 'radial' && <ellipse
        cx={draft.start.x * 1000} cy={draft.start.y * 1000}
        rx={Math.abs(draft.end.x - draft.start.x) * 1000}
        ry={Math.abs(draft.end.y - draft.start.y) * 1000}
        fill="rgba(244, 114, 112, 0.18)" stroke="#fca5a5" strokeWidth="3" strokeDasharray="10 7"
      />}
      {drawMode.kind === 'brush' && <polyline points={draftStroke} fill="none" stroke="#fca5a5" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />}
    </svg>}
  </>;
};
