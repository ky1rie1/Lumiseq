import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { defaultProviderRegistry } from '../../ai/providers/ProviderRegistry';
import { defaultAssetManager } from '../../assets/AssetManager';
import { defaultSegmentationCache } from '../../ai/segmentation/SegmentationCache';
import { defaultLocalCutoutProvider } from '../../cutout/LocalCutoutProvider';
import { defaultImageEngine } from '../../engine/WebGLImageEngine';
import { Redactor } from '../../ai/security/Redactor';
import { APP_NAME, APP_VERSION } from '../../core/brand';
import { getPlatformBridge } from '../../platform';
import { SettingsPageFrame } from './SettingsPageFrame';
import { SettingsRequestScope } from './settingsDraft';
import { ReleaseSettings } from '../../releases/ReleaseSettings';

export function DiagnosticsModal({ isOpen, onClose, embedded }: { isOpen: boolean; onClose: () => void; embedded?: boolean }) {
  const [notice, setNotice] = useState('');
  const [, setRefresh] = useState(0);
  const scope = useRef(new SettingsRequestScope());
  useEffect(() => { if (isOpen) { scope.current.begin(); } return () => scope.current.invalidate(); }, [isOpen]);
  if (!isOpen) return null;
  const provider = defaultProviderRegistry.getActiveConfig();
  let capabilitySummary: string;
  try {
    const caps = defaultProviderRegistry.getProvider(provider.id).capabilities;
    capabilitySummary = `工具调用：${caps.toolCalling ? '已声明' : '未声明'}；图像理解：${caps.vision ? '已声明' : '未声明'}`;
  } catch {
    capabilitySummary = '当前协议不支持对话，无法读取能力声明；请在 AI 与隐私中检查服务配置。';
  }
  const cache = defaultSegmentationCache.getStats();
  const cutout = defaultLocalCutoutProvider.getRuntimeStatus();
  const native = '__TAURI_INTERNALS__' in window;
  const rendering = defaultImageEngine.getRenderingStatus();
  const rows = [
    ['应用版本', `${APP_NAME} ${APP_VERSION}`],
    ['宿主环境', native ? 'Tauri 桌面应用' : '浏览器预览'],
    ['最近调色渲染后端', rendering.backend === 'webgl2' ? 'WebGL 2 GPU' : rendering.backend === 'canvas2d' ? 'Canvas 2D CPU' : '尚未完成调色渲染'],
    ...(rendering.fallbackReason ? [['调色渲染回退原因', rendering.fallbackReason]] : []),
    ['编辑合成后端', 'Canvas 2D'],
    ['文档图像资源', `${(defaultAssetManager.getTotalByteSize() / 1048576).toFixed(2)} MB（保留，不参与缓存清理）`],
    ['可重建分割缓存', `${cache.count} 项 · ${(cache.byteSize / 1048576).toFixed(2)} MB`],
    ['内置抠图会话', cutout.busy ? '正在识别' : cutout.loaded ? '已加载，空闲' : '未加载，下次使用时加载'],
    ['抠图实际计算后端', cutout.backend === 'webgpu' ? 'WebGPU GPU' : cutout.backend === 'wasm' ? 'WASM CPU' : '尚未运行'],
    ...(cutout.fallbackReason ? [['抠图后端说明', cutout.fallbackReason]] : []),
    ['AI 对话服务', `${provider.name} · ${provider.model}`],
    ['服务能力声明', capabilitySummary],
  ];
  const copyDiagnostics = async () => {
    const request = scope.current.capture();
    const text = Redactor.redact(`# ${APP_NAME} 诊断\n${rows.map(([name, value]) => `- ${name}: ${value}`).join('\n')}`);
    try { await getPlatformBridge().writeClipboardText(text); if (scope.current.isCurrent(request)) setNotice('脱敏诊断信息已复制。不包含密钥、令牌或项目内容。'); }
    catch { if (scope.current.isCurrent(request)) setNotice('无法访问剪贴板，请检查权限后重试。'); }
  };
  const openLogsFolder = async () => {
    try {
      const paths = await getPlatformBridge().getAppPaths();
      await getPlatformBridge().revealPathInExplorer(paths.logsDir);
    } catch {
      setNotice('无法打开日志目录。');
    }
  };
  return <SettingsPageFrame open={isOpen} onClose={onClose} embedded={embedded} label="诊断与关于" className="diagnostic-settings max-w-2xl">
    {!embedded && <header className="settings-center-header"><h2>诊断与关于</h2><button type="button" onClick={onClose} aria-label="关闭诊断信息"><X size={18} /></button></header>}
    <section className="settings-group"><h3>当前运行状态</h3><dl className="settings-diagnostics">{rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><p className="settings-help">模型能力是服务的声明，实际可用性以连接测试为准。计算后端来自实际渲染或抠图会话；尚未运行时不假定 GPU 可用。</p><div className="settings-group-actions"><button type="button" onClick={() => { setRefresh(value => value + 1); }}>刷新状态</button><button type="button" onClick={() => void copyDiagnostics()}>复制脱敏诊断</button><button type="button" onClick={() => void openLogsFolder()}>打开日志目录</button></div></section>
    <section className="settings-group"><h3>可重建资源</h3><p className="settings-help">释放分割特征缓存及空闲抠图会话。正在识别的会话会保留；文档图像、历史资源、恢复包和内置模型均保留。</p><div className="settings-group-actions"><button type="button" onClick={() => { defaultSegmentationCache.clear(); const released = defaultLocalCutoutProvider.releaseIdleSession(); setRefresh(value => value + 1); setNotice(released ? '可重建缓存及空闲会话已释放。' : '可重建缓存已释放；正在识别的抠图会话已保留。'); }}>释放可重建资源</button></div></section>
    <ReleaseSettings />
    {notice && <div className="settings-feedback" role="status">{notice}</div>}
  </SettingsPageFrame>;
}
