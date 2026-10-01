import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { defaultModelManager, type ModelManifest } from '../../ai/models/ModelManager';
import { SettingsPageFrame } from './SettingsPageFrame';
import { SettingsRequestScope } from './settingsDraft';

export function ModelSettingsModal({ isOpen, onClose, embedded }: { isOpen: boolean; onClose: () => void; embedded?: boolean }) {
  const [models, setModels] = useState<ModelManifest[]>([]);
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const scope = useRef(new SettingsRequestScope());
  useEffect(() => {
    if (!isOpen) return;
    scope.current.begin(); setModels(defaultModelManager.listModels());
    const unsubscribe = defaultModelManager.subscribe(() => setModels(defaultModelManager.listModels()));
    return () => { unsubscribe(); scope.current.invalidate(); };
  }, [isOpen]);
  if (!isOpen) return null;
  const download = async (id: string) => {
    const request = scope.current.capture();
    try { const success = await defaultModelManager.downloadModel(id); if (scope.current.isCurrent(request)) setNotice(success ? '可选模型下载完成。' : '下载未完成，请检查模型错误信息。'); }
    catch (error) { if (scope.current.isCurrent(request)) setNotice(`下载失败：${error instanceof Error ? error.message : '请重试'}`); }
  };
  return <SettingsPageFrame open={isOpen} onClose={onClose} embedded={embedded} label="可选备用模型" className="model-settings max-w-2xl">
    {!embedded && <header className="settings-center-header"><h2>可选备用模型</h2><button type="button" onClick={onClose} aria-label="关闭可选模型设置"><X size={18} /></button></header>}
    <p className="settings-help">这些模型是可选组件，与主程序内置的 BiRefNet 离线抠图独立。下载或删除它们不会影响内置抠图；备用模型是否可用取决于相应功能的支持。</p>
    <p className="settings-help settings-storage-path">存储位置：{defaultModelManager.getStorageDirectory()}</p>
    {models.length === 0 && <p className="settings-help">暂无可选模型。内置离线抠图仍可使用。</p>}
    {models.map(model => <section className="settings-group" key={model.modelId}><div className="settings-row"><div className="settings-row-copy"><strong>{model.name}</strong><p>{(model.sizeBytes / 1048576).toFixed(1)} MB · {model.license} · v{model.version}</p><p>{model.status === 'ready' ? '已安装' : model.status === 'downloading' ? '正在下载…' : model.status === 'error' ? `下载失败：${model.errorMessage || '请重试'}` : '未安装'}</p></div><div className="settings-row-control">{model.status === 'ready' ? <button type="button" onClick={() => setDeleting(model.modelId)}>删除备用模型</button> : model.status === 'downloading' ? <button type="button" onClick={() => { defaultModelManager.cancelDownload(model.modelId); setNotice('下载已取消。'); }}>取消下载</button> : <button type="button" onClick={() => void download(model.modelId)}>下载备用模型</button>}</div></div>{model.status === 'downloading' && <progress aria-label={`${model.name} 下载进度`} max={1} value={model.progress} />}{deleting === model.modelId && <div className="settings-draft-warning" role="alert"><span>删除后需要重新下载此备用模型。</span><button type="button" onClick={() => setDeleting(null)}>取消</button><button type="button" onClick={() => { defaultModelManager.deleteModel(model.modelId); setDeleting(null); setModels(defaultModelManager.listModels()); setNotice('备用模型已删除，内置抠图仍保留。'); }}>确认删除</button></div>}</section>)}
    {notice && <div className="settings-feedback" role="status">{notice}</div>}
  </SettingsPageFrame>;
}
