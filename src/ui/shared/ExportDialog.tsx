import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { StudioDocument } from '../../types/document';
import { getPlatformBridge } from '../../platform';
import { defaultImageExportService, getImageExportColorContract, type ImageExportOptions } from '../../app/ImageExportService';
import { Modal } from './Modal';
import {defaultExportOptions} from '../../app/preferenceRuntime';
import {getStudioPreferences} from '../../stores/useStudioPreferences';

function initialOptions(document: StudioDocument): ImageExportOptions {
  return defaultExportOptions(document,getStudioPreferences());
}

export function ExportDialog({ document, open, onClose, onExported }: {
  document: StudioDocument | null;
  open: boolean;
  onClose: () => void;
  onExported: (path: string) => void;
}) {
  const [options, setOptions] = useState<ImageExportOptions>({ format: 'jpeg', quality: 90, width: 1, height: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (document && open) { setOptions(initialOptions(document)); setError(null); }
  }, [document?.id, open]);
  const valid = Number.isInteger(options.width) && Number.isInteger(options.height) &&
    options.width > 0 && options.height > 0 && options.width * options.height <= 150_000_000;
  const colorContract = document ? getImageExportColorContract(document,options.format) : null;
  const changeWidth = (width: number) => {
    if (!document) return;
    const base = initialOptions(document);
    setOptions(current => ({ ...current, width, height: Math.max(1, Math.round(width * base.height / base.width)) }));
  };
  const changeHeight = (height: number) => {
    if (!document) return;
    const base = initialOptions(document);
    setOptions(current => ({ ...current, height, width: Math.max(1, Math.round(height * base.width / base.height)) }));
  };
  const exportImage = async () => {
    if (!document || !valid || busy) return;
    setBusy(true); setError(null);
    try {
      const extension = options.format === 'jpeg' ? 'jpg' : 'png';
      const base = (document.kind === 'edit' ? document.name : document.fileName)
        .replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]/g, '_');
      const path = await getPlatformBridge().saveFileDialog({
        title: `导出成品 · ${options.format === 'jpeg' ? 'JPEG' : 'PNG'}`,
        defaultPath: `${base}_export.${extension}`,
        filters: [{ name: options.format === 'jpeg' ? 'JPEG 图片' : 'PNG 图片', extensions: [extension] }],
      });
      if (!path) return;
      await defaultImageExportService.export(document, path, options);
      onExported(path);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="导出成品图像">
    {document && <div className="image-export-dialog">
      <div className="image-export-intro"><span>{document.kind === 'develop' ? '照片调色' : '图像编辑'} / 渲染输出</span><strong>{document.kind === 'edit' ? document.name : document.fileName}</strong><small>导出渲染后的成品图像；原工程与编辑记录完整保留。</small></div>
      <div className="image-export-section"><span className="image-export-label">文件格式</span><div className="image-export-formats" role="group" aria-label="文件格式">
        <button type="button" aria-pressed={options.format === 'jpeg'} onClick={() => setOptions(current => ({ ...current, format: 'jpeg' }))}>JPEG <small>高通用性 · 适合网络分享与交付</small></button>
        <button type="button" aria-pressed={options.format === 'png'} onClick={() => setOptions(current => ({ ...current, format: 'png' }))}>PNG <small>{document.kind === 'edit' ? '无损压缩 · 支持透明背景' : document.isRaw ? '无损压缩 · 16 位色彩' : '无损压缩 · sRGB'}</small></button>
      </div></div>
      {options.format === 'jpeg' && <div className="image-export-section"><label className="image-export-label" htmlFor="export-quality">JPEG 品质 <strong>{options.quality}%</strong></label><input id="export-quality" type="range" min="1" max="100" value={options.quality} onChange={event => setOptions(current => ({ ...current, quality: Number(event.target.value) }))} /></div>}
      <div className="image-export-section"><span className="image-export-label">图像尺寸 <small>锁定原始比例</small></span><div className="image-export-size"><label>宽度 <input type="number" min="1" max="30000" value={options.width} onChange={event => changeWidth(Number(event.target.value))} /> px</label><span aria-hidden="true">×</span><label>高度 <input type="number" min="1" max="30000" value={options.height} onChange={event => changeHeight(Number(event.target.value))} /> px</label></div><small className="image-export-note">原始尺寸 {document.width} × {document.height} px · {colorContract?.bitDepth ? `sRGB / ${colorContract.bitDepth} 位` : '等待图像数据就绪'}</small></div>
      <div className="image-export-section image-export-color"><span className="image-export-label">色彩输出</span><p>{colorContract?.metadata==='srgb-chunks'?'嵌入 sRGB 色彩标记 · 原生 16 位无损输出':colorContract?.metadata==='icc-profile'?'嵌入 sRGB ICC 描述文件':colorContract?.metadata==='browser-managed'?'sRGB · 由浏览器图像编码器输出':'图像数据尚未就绪，当前不能导出。'}</p></div>
      {error && <p className="image-export-error" role="alert">{error}</p>}
      {!valid && <p className="image-export-error" role="alert">请输入有效尺寸，且总像素不超过 1.5 亿。</p>}
      <div className="image-export-footer"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary" disabled={busy || !valid} onClick={() => { void exportImage(); }}><Download size={15} />{busy ? '正在导出…' : '导出到文件'}</button></div>
    </div>}
  </Modal>;
}
