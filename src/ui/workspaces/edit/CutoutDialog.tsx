import { useEffect, useRef, useState } from 'react';
import { Check, Eraser, Hand, Plus, RefreshCw, RotateCcw, Undo2 } from 'lucide-react';
import { Modal } from '../../shared/Modal';
import type { EditDocument, Layer } from '../../../types/edit';
import { alphaCanvas, renderCutoutSource, segmentForeground } from '../../../cutout/CutoutService';
import { defaultRefinement, type Refinement } from '../../../cutout/cutoutMath';
import { refineInWorker } from '../../../cutout/refineInWorker';
import { cutoutSourceFingerprint } from '../../../cutout/cutoutSource';
import { ApplyCutoutMaskCommand } from '../../../cutout/ApplyCutoutMaskCommand';
import { defaultDocumentManager } from '../../../document/DocumentManager';
import { defaultCommandBus } from '../../../history/CommandBus';
import { defaultAssetManager } from '../../../assets/AssetManager';
import type { Point } from '../../../selection/types';
import { useStudioPreferences } from '../../../stores/useStudioPreferences';
import { checkerStyle } from './canvasPreferences';
import { cutoutPreviewLayout } from './cutoutPreviewLayout';
import './CutoutDialog.css';

interface Stroke { point: Point; radius: number; mode: 'add' | 'remove'; gesture: number }
export function CutoutDialog({ doc: inputDoc, layer: inputLayer, onClose }: { doc: EditDocument; layer: Layer; onClose: () => void }) {
  const checkerSize = useStudioPreferences(s => s.preferences.checkerSize);
  const checkerTone = useStudioPreferences(s => s.preferences.checkerTone);
  const [{ doc, layer }] = useState(() => ({ doc: structuredClone(inputDoc), layer: structuredClone(inputLayer) }));
  const sourceFingerprint = cutoutSourceFingerprint(doc, layer.id);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(''), [error, setError] = useState('');
  const [source, setSource] = useState<HTMLCanvasElement>(), [base, setBase] = useState<Uint8ClampedArray>();
  const [options, setOptions] = useState<Refinement>(defaultRefinement), [strokes, setStrokes] = useState<Stroke[]>([]);
  const [background, setBackground] = useState('checker');
  const [view, setView] = useState<'result' | 'original' | 'mask'>('result');
  const [mode, setMode] = useState<'inspect' | 'add' | 'remove'>('inspect'), [radius, setRadius] = useState(20);
  const [zoom, setZoom] = useState(1);
  const [frame, setFrame] = useState({ width: 760, height: 520 });
  const viewport = useRef<HTMLDivElement>(null), brushCursor = useRef<HTMLSpanElement>(null);
  const panStart = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const preview = useRef<HTMLCanvasElement>(null), abort = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true), drawing = useRef(false), previousPoint = useRef<Point | null>(null);
  const busyRef = useRef(false), gesture = useRef(0), autoStarted = useRef(false);
  const width = Math.max(1, Math.round(doc.width * Math.min(1, 1100 / doc.width, 750 / doc.height)));
  const height = Math.max(1, Math.round(doc.height * width / doc.width));
  const layout = cutoutPreviewLayout(width, height, frame.width, frame.height, zoom);
  const gestures = new Set(strokes.map(stroke => stroke.gesture)).size;
  const canPaint = !!source && !busy && view !== 'original' && mode !== 'inspect';
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth && element.clientHeight) setFrame({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    alive.current = true;
    void renderCutoutSource(doc, layer).then(result => { if (alive.current) setSource(result); }).catch(reason => { if (alive.current) setError(String(reason)); });
    return () => { alive.current = false; abort.current?.abort(); };
  }, [doc.id, layer.id]);

  const verifySource = () => {
    const current = defaultDocumentManager.getEditDocument(doc.id);
    if (!current || cutoutSourceFingerprint(current, layer.id) !== sourceFingerprint) throw new Error('画布或原图已变化，请重新打开抠图工作台。');
  };
  useEffect(() => {
    if (!source || !preview.current) return;
    const previewAbort = new AbortController();
    const timer = setTimeout(() => { void (async () => {
      const canvas = preview.current; if (!canvas) return;
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      if (view === 'original' || !base && !strokes.length) {
        ctx.clearRect(0, 0, width, height); ctx.drawImage(source, 0, 0, width, height);
        return;
      }
      const alpha = await refineInWorker(base, doc.width, doc.height, options, strokes, width, height, previewAbort.signal);
      if (previewAbort.signal.aborted) return;
      ctx.clearRect(0, 0, width, height); ctx.drawImage(source, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < alpha.length; i++) pixels.data[i * 4 + 3] = Math.round(pixels.data[i * 4 + 3] * alpha[i] / 255);
      ctx.putImageData(pixels, 0, 0);
      if (view === 'mask') { ctx.clearRect(0, 0, width, height); ctx.drawImage(alphaCanvas(alpha, width, height), 0, 0); }
    })().catch(reason => { if (!previewAbort.signal.aborted && alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }); }, drawing.current ? 16 : 70);
    return () => { clearTimeout(timer); previewAbort.abort(); };
  }, [source, base, options, strokes, view, width, height]);

  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError('');
    try { await task(controller.signal); }
    catch (reason) { if (alive.current) setError(controller.signal.aborted ? '已取消，可重新操作。' : reason instanceof Error ? reason.message : String(reason)); }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); setStatus(''); } }
  };
  const generate = () => run(async signal => {
    if (!source) throw new Error('原始图像尚未就绪。');
    verifySource();
    setStatus('正在识别主体并细化边缘，首次运行需要准备模型…');
    const result = (await segmentForeground(source, signal)).mask;
    signal.throwIfAborted();
    verifySource();
    if (alive.current) { setBase(result); setStrokes([]); }
  });
  useEffect(() => {
    if (source && !autoStarted.current) {
      autoStarted.current = true;
      void generate();
    }
  }, [source]);
  const apply = () => run(async signal => {
    verifySource();
    setStatus('正在保存可编辑蒙版…');
    const alpha = await refineInWorker(base, doc.width, doc.height, options, strokes, doc.width, doc.height, signal);
    const asset = await defaultAssetManager.registerMask(alpha, doc.width, doc.height, `${layer.name} · 抠图`);
    try {
      signal.throwIfAborted();
      verifySource();
      await defaultCommandBus.execute(new ApplyCutoutMaskCommand(doc.id, layer.id, asset.id, defaultDocumentManager));
    } catch (reason) { defaultAssetManager.releaseAsset(asset.id); throw reason; }
    onClose();
  });
  const paint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !canPaint) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: (event.clientX - bounds.left) / bounds.width * doc.width, y: (event.clientY - bounds.top) / bounds.height * doc.height };
    const last = previousPoint.current ?? point;
    const steps = Math.min(256, Math.max(1, Math.ceil(Math.hypot(point.x - last.x, point.y - last.y) / Math.max(1, radius / 3))));
    const next: Stroke[] = [];
    for (let i = 1; i <= steps; i++) next.push({ point: { x: last.x + (point.x - last.x) * i / steps, y: last.y + (point.y - last.y) * i / steps }, radius, mode, gesture: gesture.current });
    previousPoint.current = point;
    setStrokes(previous => [...previous, ...next].slice(0, 20_000));
  };
  const stopGesture = () => {
    drawing.current = false; previousPoint.current = null; panStart.current = null;
    if (brushCursor.current) brushCursor.current.hidden = true;
  };
  const movePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pan = panStart.current;
    if (pan && viewport.current) {
      viewport.current.scrollLeft = pan.left - (event.clientX - pan.x);
      viewport.current.scrollTop = pan.top - (event.clientY - pan.y);
      return;
    }
    if (brushCursor.current) {
      const bounds = event.currentTarget.getBoundingClientRect();
      brushCursor.current.style.transform = `translate(${event.clientX - bounds.left}px, ${event.clientY - bounds.top}px) translate(-50%, -50%)`;
      brushCursor.current.hidden = !canPaint;
    }
    paint(event);
  };
  return <Modal open onClose={onClose} title="自动抠图">
    <div className="cutout-shell">
      <div className="cutout-layout">
        <section className="cutout-visual" aria-label="抠图预览区">
          <div className="cutout-view-controls">
            <div className="cutout-segmented" role="group" aria-label="预览视图">
              <button aria-label="查看抠图结果" aria-pressed={view === 'result'} onClick={() => setView('result')}>结果</button>
              <button aria-label="查看原图" aria-pressed={view === 'original'} onClick={() => setView('original')}>原图</button>
              <button aria-label="查看蒙版" aria-pressed={view === 'mask'} disabled={!base && !strokes.length} onClick={() => setView('mask')}>蒙版</button>
            </div>
            <div className="cutout-preview-options">
              <div className="cutout-backgrounds" role="group" aria-label="预览底色">
                {([{ value: 'checker', label: '透明棋盘' }, { value: '#ffffff', label: '白色' }, { value: '#202124', label: '深灰' }] as const).map(item =>
                  <button key={item.value} aria-label={`预览底色：${item.label}`} title={item.label} aria-pressed={background === item.value} onClick={() => setBackground(item.value)}>
                    <span className={item.value === 'checker' ? 'is-checker' : ''} style={item.value === 'checker' ? undefined : { backgroundColor: item.value }} />
                  </button>)}
              </div>
              <select aria-label="预览缩放" value={zoom} onChange={e => { setZoom(Number(e.target.value)); stopGesture(); }}>
                <option value={1}>适应窗口</option><option value={2}>放大 2×</option><option value={4}>放大 4×</option>
              </select>
            </div>
          </div>
          <div className="cutout-preview" ref={viewport} aria-busy={busy}>
            <div className="cutout-preview-content" style={{ width: layout.contentWidth, height: layout.contentHeight }}>
              <div className="cutout-image" style={{ width: layout.width, height: layout.height, ...(view !== 'original' && background === 'checker' ? checkerStyle(checkerSize, checkerTone) : { backgroundColor: view === 'mask' ? '#111' : background === 'checker' ? '#202124' : background }) }}>
                <canvas ref={preview} className={canPaint ? 'is-painting' : 'is-inspecting'} style={{ width: layout.width, height: layout.height }}
                  aria-label={view === 'original' ? '原图预览' : '抠图预览，可使用补回或擦除画笔'}
                  onPointerDown={event => {
                    if (event.button !== 0) return;
                    if (!canPaint && mode !== 'inspect' && view !== 'original') return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    if (!canPaint) {
                      if (viewport.current) panStart.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop };
                      return;
                    }
                    drawing.current = true; gesture.current++; previousPoint.current = null; paint(event);
                  }} onPointerMove={movePointer} onPointerUp={stopGesture} onPointerCancel={stopGesture} onLostPointerCapture={stopGesture}
                  onPointerLeave={() => { if (brushCursor.current) brushCursor.current.hidden = true; }} />
                <span ref={brushCursor} hidden aria-hidden="true" className={`cutout-brush-cursor ${mode === 'remove' ? 'is-remove' : ''}`} style={{ width: radius * 2 * layout.width / doc.width, height: radius * 2 * layout.height / doc.height }} />
              </div>
            </div>
            {!source && <div className="cutout-loading">正在读取原图…</div>}
          </div>
          <div className="cutout-preview-caption"><span title={layer.name}>{layer.name}</span><span>{doc.width} × {doc.height} px</span></div>
        </section>
        <aside className="cutout-controls" aria-label="抠图精修工具">
          <section className="cutout-control-section">
            <div className="cutout-section-heading"><h3>局部修补</h3><span>{gestures ? `${gestures} 笔` : '画笔'}</span></div>
            <div className="cutout-brush-modes cutout-segmented" role="group" aria-label="精修工具">
              <button aria-label="查看与拖动" aria-pressed={mode === 'inspect'} onClick={() => { stopGesture(); setMode('inspect'); }}><Hand size={15} /><span>查看</span></button>
              <button aria-label="补回主体" aria-pressed={mode === 'add'} disabled={busy || !source} onClick={() => { stopGesture(); setMode('add'); setView('result'); }}><Plus size={15} /><span>补回</span></button>
              <button aria-label="擦除背景" aria-pressed={mode === 'remove'} disabled={busy || !source} onClick={() => { stopGesture(); setMode('remove'); setView('result'); }}><Eraser size={15} /><span>擦除</span></button>
            </div>
            <p className="cutout-tool-hint">{mode === 'inspect' ? '切换到补回或擦除后，在图像上涂抹。' : mode === 'add' ? '涂抹遗漏的主体，将它补回。' : '涂抹残留的背景，将它擦除。'}</p>
            <label className="cutout-slider"><span>画笔半径</span><output>{radius}<small> px</small></output><input aria-label="精修画笔半径" type="range" min={1} max={100} value={radius} disabled={!canPaint} onChange={e => setRadius(Number(e.target.value))} /></label>
            <button className="cutout-quiet-button" disabled={busy || !strokes.length} onClick={() => setStrokes(previous => previous.filter(stroke => stroke.gesture !== previous[previous.length - 1]?.gesture))}><Undo2 size={14} />撤销上一笔</button>
          </section>
          <section className="cutout-control-section">
            <div className="cutout-section-heading"><h3>边缘调整</h3><button className="cutout-icon-button" aria-label="重置边缘参数" title="重置边缘参数" disabled={busy} onClick={() => setOptions(defaultRefinement)}><RotateCcw size={14} /></button></div>
            {([{ key: 'shift', label: '边缘扩缩', min: -30, max: 30 }, { key: 'smooth', label: '平滑', min: 0, max: 10 }, { key: 'feather', label: '羽化', min: 0, max: 30 }, { key: 'contrast', label: '边缘对比', min: 0, max: 100 }] as const).map(control =>
              <label className="cutout-slider" key={control.key}><span>{control.label}</span><output>{options[control.key]}<small>{control.key === 'contrast' ? '%' : ' px'}</small></output><input aria-label={control.label} type="range" min={control.min} max={control.max} value={options[control.key]} disabled={busy || !source} onChange={e => setOptions(previous => ({ ...previous, [control.key]: Number(e.target.value) }))} /></label>)}
            <p className="cutout-section-note">向内收缩可减少杂边；少量羽化让边缘更柔和。</p>
          </section>
          <section className="cutout-secondary-actions">
            <button className="cutout-quiet-button" disabled={!source || busy} onClick={() => void generate()}><RefreshCw size={14} />重新识别主体</button>
            <button className="cutout-quiet-button" disabled={busy} onClick={() => { setOptions(defaultRefinement); setStrokes([]); }}><RotateCcw size={14} />重置全部精修</button>
          </section>
        </aside>
      </div>
      <footer className="cutout-footer">
        <div className="cutout-feedback">
          {error ? <p role="alert" className="cutout-error">{error}</p> : <p role="status"><span className={`cutout-state-dot ${busy || !source ? 'is-busy' : ''}`} />{status || (!source ? '正在准备图像…' : base ? '主体已识别，可继续精修。' : '可以重新识别或手动修补。')}</p>}
          <small>本机处理 · 原图保留 · 应用后可撤销</small>
        </div>
        <div className="cutout-footer-actions">
          {busy ? <button className="cutout-button" onClick={() => abort.current?.abort()}>取消处理</button> : <button className="cutout-button" onClick={onClose}>取消</button>}
          <button className="cutout-apply-button" disabled={busy || !source || (!base && !strokes.length)} onClick={() => void apply()}><Check size={15} />应用蒙版</button>
        </div>
      </footer>
    </div>
  </Modal>;
}
