import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { defaultMCPServerManager } from '../../ai/mcp/MCPServerManager';
import type { PermissionLevel } from '../../ai/types';
import { getPlatformBridge } from '../../platform';
import { SettingsPageFrame } from './SettingsPageFrame';
import { SettingsRequestScope, type SettingsControllerListener } from './settingsDraft';
import { SettingsSaveFooter } from './SettingsSaveFooter';
import { SettingsUnsavedDialog } from './SettingsUnsavedDialog';

export function ExternalAgentsModal({ isOpen, onClose, embedded, onDirtyChange, onSaveController }: {
  isOpen: boolean; onClose: () => void; embedded?: boolean; onDirtyChange?: (dirty: boolean) => void; onSaveController?: SettingsControllerListener;
}) {
  const [status, setStatus] = useState(() => defaultMCPServerManager.getStatus());
  const [port, setPort] = useState(defaultMCPServerManager.getSettings().fixedPort || 18280);
  const [portMode, setPortMode] = useState<'auto' | 'fixed'>(status.portMode);
  const [savedPort, setSavedPort] = useState(port);
  const [savedMode, setSavedMode] = useState(portMode);
  const [permission, setPermission] = useState(status.permissionMode);
  const [savedPermission, setSavedPermission] = useState(permission);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [confirmToken, setConfirmToken] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const scope = useRef(new SettingsRequestScope());
  const dirty = portMode !== savedMode || port !== savedPort || permission !== savedPermission;
  const running = status.state === 'running';
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!isOpen) return;
    const current = defaultMCPServerManager.getStatus();
    const stored = defaultMCPServerManager.getSettings();
    setStatus(current); setPort(stored.fixedPort); setSavedPort(stored.fixedPort);
    setPermission(stored.permissionMode); setSavedPermission(stored.permissionMode);
    setPortMode(current.portMode); setSavedMode(current.portMode);
    scope.current.begin();
    const unsubscribe = defaultMCPServerManager.subscribe(() => setStatus(defaultMCPServerManager.getStatus()));
    return () => { unsubscribe(); scope.current.invalidate(); };
  }, [isOpen]);
  const discard = () => { setPort(savedPort); setPortMode(savedMode); setPermission(savedPermission); };
  const save = async (): Promise<boolean> => {
    if (busy) return false;
    try {
      defaultMCPServerManager.saveSettings({ portMode, fixedPort: port, permissionMode: permission });
      setSavedMode(portMode); setSavedPort(port); setSavedPermission(permission);
      setNotice('设置已保存。HTTP 服务仅在点击开启后运行。');
      return true;
    } catch (error) { setNotice(`保存失败：${error instanceof Error ? error.message : '请重试'}`); return false; }
  };
  useEffect(() => { onSaveController?.({ dirty, busy, save, discard }); }, [dirty, busy, portMode, port, permission, savedMode, savedPort, savedPermission, onSaveController]);
  if (!isOpen) return null;
  const requestClose = () => { if (busy) { setNotice('请等待当前操作完成。'); return; } if (dirty) setConfirmClose(true); else onClose(); };
  const copy = async (text: string, success: string) => {
    const request = scope.current.capture();
    try { await getPlatformBridge().writeClipboardText(text); if (scope.current.isCurrent(request)) setNotice(success); }
    catch { if (scope.current.isCurrent(request)) setNotice('无法访问剪贴板，请检查权限后重试。'); }
  };
  const toggleHttp = async () => {
    if (dirty) { setNotice('请先保存设置，再开启或关闭 HTTP 服务。'); return; }
    if (!running && portMode === 'fixed' && (!Number.isInteger(port) || port < 1024 || port > 65535)) {
      setNotice('请输入 1024–65535 之间的整数端口。'); return;
    }
    const request = scope.current.capture();
    setBusy(true); setNotice('');
    try {
      if (running) { await defaultMCPServerManager.stopHttp(); if (scope.current.isCurrent(request)) setNotice('HTTP 服务已关闭。'); }
      else {
        const result = await defaultMCPServerManager.startHttp({ portMode, fixedPort: port });
        if (!scope.current.isCurrent(request)) return;
        if (result.success) { setSavedMode(portMode); setSavedPort(port); setNotice('HTTP 设置已保存，服务已开启。'); }
        else setNotice(`HTTP 启动失败：${result.error || '请更换端口或使用 stdio。'}`);
      }
    } catch (error) { if (scope.current.isCurrent(request)) setNotice(`操作失败：${error instanceof Error ? error.message : '请重试'}`); }
    finally { if (scope.current.isCurrent(request)) setBusy(false); }
  };
  return <SettingsPageFrame open={isOpen} onClose={requestClose} embedded={embedded} label="外部应用与代理联动 (MCP)" className="external-agent-settings max-w-2xl">
    {!embedded && <header className="settings-center-header"><h2>外部应用与代理联动 (MCP)</h2><button type="button" onClick={requestClose} aria-label="关闭外部工具设置"><X size={18} /></button></header>}
    <div className="external-agent-body">
      <section className="settings-group"><h3>stdio MCP 连接</h3><div className="settings-row"><div className="settings-row-copy"><strong>连接桌面工具</strong><p>适用于 Claude Desktop、Cursor 等工具，无需开放网络端口。</p></div><div className="settings-row-control"><button type="button" onClick={() => void copy(defaultMCPServerManager.getClaudeDesktopConfig(), 'stdio 配置已复制。')}>复制 stdio 配置</button></div></div></section>
      <section className="settings-group"><h3>可选 HTTP 服务</h3><div className="settings-row"><div className="settings-row-copy"><strong>{running ? 'HTTP 服务运行中' : 'HTTP 服务已关闭'}</strong><p>{running ? status.endpoint : '按需开启，仅接受本机连接。'}</p></div><div className="settings-row-control"><button type="button" disabled={busy} onClick={() => void toggleHttp()}>{busy ? '正在处理…' : running ? '关闭 HTTP 服务' : '开启 HTTP 服务'}</button></div></div>
        <div className="settings-row"><div className="settings-row-copy"><strong>端口选择方式</strong><p>修改前，请先关闭 HTTP 服务。</p></div><div className="settings-row-control"><select aria-label="端口选择方式" disabled={running || busy} value={portMode} onChange={event => setPortMode(event.target.value as 'auto' | 'fixed')}><option value="auto">自动（优先 18280）</option><option value="fixed">固定端口</option></select></div></div>
        <div className="settings-row"><div className="settings-row-copy"><strong>HTTP 端口</strong><p>保存后用于下次开启服务。</p></div><div className="settings-row-control"><input type="number" aria-label="HTTP 服务端口" min={1024} max={65535} disabled={running || busy || portMode === 'auto'} value={port} onChange={event => setPort(Number(event.target.value))} /></div></div>
        <div className="settings-group-actions"><button type="button" onClick={() => { if (!running) { setNotice('请先开启 HTTP 服务后复制配置。'); return; } void copy(defaultMCPServerManager.getCursorConfig(), 'HTTP 客户端配置已复制。'); }}>复制 HTTP 配置</button></div>
        {status.lastError && <p className="settings-help">服务错误：{status.lastError}</p>}
      </section>
      <section className="settings-group"><h3>外部工具权限</h3><div className="settings-row"><div className="settings-row-copy"><strong>编辑权限级别</strong><p>保存后生效。自动执行与完全控制允许直接编辑、保存和导出。</p></div><div className="settings-row-control"><select aria-label="外部工具权限级别" value={permission} onChange={event => setPermission(event.target.value as PermissionLevel)}><option value="ask">编辑前询问</option><option value="readonly">仅允许查看</option><option value="auto">自动执行编辑与文件操作</option><option value="full">完全控制</option></select></div></div></section>
      <section className="settings-group"><h3>访问令牌</h3><p className="settings-help">外部工具需要此令牌才能连接。重新生成后，旧令牌立即失效。</p><div className="settings-token-row"><input aria-label="本地访问令牌" readOnly type={showToken ? 'text' : 'password'} value={defaultMCPServerManager.getAuthToken()} /><button type="button" onClick={() => setShowToken(!showToken)} aria-label={showToken ? '隐藏访问令牌' : '显示访问令牌'}>{showToken ? <EyeOff size={16} /> : <Eye size={16} />}</button><button type="button" onClick={() => void copy(defaultMCPServerManager.getAuthToken(), '访问令牌已复制。')}>复制</button></div><div className="settings-group-actions"><button type="button" onClick={() => setConfirmToken(true)}>重新生成令牌</button></div>{confirmToken && <div className="settings-draft-warning" role="alert"><span>重新生成后，现有客户端需要更新连接配置。</span><button type="button" onClick={() => setConfirmToken(false)}>取消</button><button type="button" onClick={() => { defaultMCPServerManager.regenerateToken(); setStatus(defaultMCPServerManager.getStatus()); setConfirmToken(false); setNotice('新令牌已生成，请更新客户端配置。'); }}>确认重新生成</button></div>}</section>
      {notice && <div className="settings-feedback" role="status">{notice}</div>}
      <SettingsUnsavedDialog open={confirmClose} onCancel={() => setConfirmClose(false)} onDiscard={() => { discard(); setConfirmClose(false); onClose(); }} onSave={async () => { if (!(await save())) return false; setConfirmClose(false); onClose(); return true; }} />
    </div>
  {!embedded && <SettingsSaveFooter dirty={dirty} busy={busy} onSave={() => { void save(); }} />}</SettingsPageFrame>;
}
