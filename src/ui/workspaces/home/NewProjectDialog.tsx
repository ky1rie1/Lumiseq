import { useEffect, useRef, useState } from 'react';
import { FileImage, FolderOpen, Plus, X } from 'lucide-react';
import type { CreateDocumentRequest } from '../../../app/DocumentOperationService';

const presets = [
  { id: 'screen', name: '屏幕画布', detail: '1920 × 1080 px', width: 1920, height: 1080, dpi: 72 },
  { id: 'square', name: '方形作品', detail: '1080 × 1080 px', width: 1080, height: 1080, dpi: 72 },
  { id: 'print', name: 'A4 印刷', detail: '2480 × 3508 px · 300 PPI', width: 2480, height: 3508, dpi: 300 },
  { id: 'uhd', name: '4K 画布', detail: '3840 × 2160 px', width: 3840, height: 2160, dpi: 72 },
] as const;

export function NewProjectDialog({ onClose, onCreate, onOpenFile }: {
  onClose: () => void;
  onCreate: (request: CreateDocumentRequest) => void;
  onOpenFile: () => void | Promise<void>;
}) {
  const [preset, setPreset] = useState<string>('screen');
  const [name, setName] = useState('未命名画布');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [dpi, setDpi] = useState(72);
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>('input[name="document-name"]')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choosePreset = (item: typeof presets[number]) => {
    setPreset(item.id);
    setWidth(item.width);
    setHeight(item.height);
    setDpi(item.dpi);
    setError('');
  };
  const create = () => {
    if (!name.trim()) { setError('请输入文档名称。'); return; }
    if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 16384)) { setError('宽度和高度需在 1–16384 像素之间。'); return; }
    if (!Number.isInteger(dpi) || dpi < 1 || dpi > 1200) { setError('分辨率需在 1–1200 PPI 之间。'); return; }
    onCreate({ kind: 'edit', name: name.trim(), width, height, dpi, backgroundColor });
    onClose();
  };

  return <div className="new-project-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="new-project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
      <header className="new-project-header"><div><span className="new-project-eyebrow">影序 STUDIO / 文档</span><h2 id="new-project-title">新建文档</h2><p>选择预设，或设置自己的画布。</p></div><button className="new-project-close" onClick={onClose} aria-label="关闭新建文档"><X size={18} /></button></header>
      <div className="new-project-body">
        <div className="new-project-main"><div className="new-project-section-label">空白画布预设</div><div className="new-project-presets">{presets.map(item => <button key={item.id} className={preset === item.id ? 'is-selected' : ''} aria-pressed={preset === item.id} onClick={() => choosePreset(item)}><FileImage size={20} /><strong>{item.name}</strong><small>{item.detail}</small></button>)}</div>
          <button className="new-project-open-file" onClick={() => { onClose(); void onOpenFile(); }}><FolderOpen size={18} /><span><strong>从照片或 RAW 开始</strong><small>打开本地文件，自动进入合适的工作区</small></span></button>
        </div>
        <div className="new-project-properties"><div className="new-project-section-label">文档设置</div><label className="new-project-field">名称<input name="document-name" value={name} onChange={event => setName(event.target.value)} /></label><div className="new-project-dimensions"><label className="new-project-field">宽度 <span>px</span><input type="number" min="1" max="16384" value={width} onChange={event => { setWidth(Number(event.target.value)); setPreset('custom'); }} /></label><label className="new-project-field">高度 <span>px</span><input type="number" min="1" max="16384" value={height} onChange={event => { setHeight(Number(event.target.value)); setPreset('custom'); }} /></label></div><label className="new-project-field">分辨率 <span>PPI</span><input type="number" min="1" max="1200" value={dpi} onChange={event => { setDpi(Number(event.target.value)); setPreset('custom'); }} /></label><div className="new-project-section-label new-project-background-title">背景</div><div className="new-project-colors">{[{ id: '#ffffff', label: '白色' }, { id: '#242831', label: '深灰' }].map(color => <button key={color.id} aria-pressed={backgroundColor === color.id} onClick={() => setBackgroundColor(color.id)}><i style={{ background: color.id }} />{color.label}</button>)}</div>{error && <p className="new-project-error" role="alert">{error}</p>}</div>
      </div>
      <footer className="new-project-footer"><span>{width} × {height} px · {dpi} PPI</span><div><button onClick={onClose}>取消</button><button className="new-project-create" onClick={create}><Plus size={16} />创建画布</button></div></footer>
    </div>
  </div>;
}
