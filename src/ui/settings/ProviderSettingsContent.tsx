import React, { useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { defaultProviderRegistry } from '../../ai/providers/ProviderRegistry';
import { defaultCapabilityRouter } from '../../ai/capabilities/CapabilityRouter';
import { SettingsPageFrame } from './SettingsPageFrame';
import { SettingsRequestScope, hasSettingsDraftChanges, type SettingsControllerListener } from './settingsDraft';
import { SettingsUnsavedDialog } from './SettingsUnsavedDialog';
import { SettingsSaveFooter } from './SettingsSaveFooter';
import type { AIStackConfig, ConnectionTestResult, CostGuardConfig, PrivacyMode, ProviderConfig, ProviderType } from '../../ai/types';
import { validateProviderSettings } from '../ai/providerSettingsValidation';
import '../ai/providerSettings.css';
import { TasteSettings } from '../ai/TasteSettings';

interface ProviderSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveController?: SettingsControllerListener;
}

type Section = 'providers' | 'routing' | 'privacy' | 'taste';
const providerTypeLabels: Partial<Record<ProviderType, string>> = {
  openai: 'OpenAI', anthropic: 'Claude', gemini: 'Gemini',
  'openai-compatible': 'OpenAI 兼容', local: '现有兼容服务', 'agent-cli': '本机 Agent',
};

export const ProviderSettingsContent: React.FC<ProviderSettingsModalProps> = ({ isOpen, onClose, embedded, onDirtyChange, onSaveController }) => {
  const [section, setSection] = useState<Section>('providers');
  const [configs, setConfigs] = useState<ProviderConfig[]>(() => defaultProviderRegistry.getAllConfigs());
  const [draft, setDraft] = useState<ProviderConfig>(() => ({ ...defaultProviderRegistry.getActiveConfig() }));
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [notice, setNotice] = useState('');
  const [stack, setStack] = useState<AIStackConfig>(() => defaultCapabilityRouter.getStackConfig());
  const [privacy, setPrivacy] = useState<PrivacyMode>(() => defaultCapabilityRouter.getPrivacyMode());
  const [cost, setCost] = useState<CostGuardConfig>(() => defaultCapabilityRouter.getCostGuard());

  const scope = useRef(new SettingsRequestScope());
  const savingPage = useRef(false);
  const [savedDraft, setSavedDraft] = useState(draft);
  const [savedStack, setSavedStack] = useState(stack);
  const [savedPrivacy, setSavedPrivacy] = useState(privacy);
  const [savedCost, setSavedCost] = useState(cost);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const dirty = !configs.some(config => config.id === draft.id) || hasSettingsDraftChanges(savedDraft, draft, keyInput) || hasSettingsDraftChanges(savedStack, stack)
    || savedPrivacy !== privacy || hasSettingsDraftChanges(savedCost, cost);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const discardDrafts = () => {
    const restored = configs.some(config => config.id === savedDraft.id) ? savedDraft : { ...defaultProviderRegistry.getActiveConfig() };
    setDraft(restored); setSavedDraft(restored); setStack(savedStack); setPrivacy(savedPrivacy); setCost(savedCost); setKeyInput('');
  };
  const navigate = (action: () => void) => {
    if (busy) { setNotice('请等待当前服务操作完成。'); return; }
    if (dirty) setPendingNavigation(() => action); else action();
  };

  useEffect(() => {
    if (!isOpen) return;
    const active = defaultProviderRegistry.getActiveConfig();
    setConfigs(defaultProviderRegistry.getAllConfigs());
    setDraft({ ...active });
    setSavedDraft({ ...active });
    setSavedStack(defaultCapabilityRouter.getStackConfig());
    setSavedPrivacy(defaultCapabilityRouter.getPrivacyMode());
    setSavedCost(defaultCapabilityRouter.getCostGuard());
    setSection('providers');
    setStack(defaultCapabilityRouter.getStackConfig());
    setPrivacy(defaultCapabilityRouter.getPrivacyMode());
    setCost(defaultCapabilityRouter.getCostGuard());
    setNotice('');
    setResult(null);
    setKeyInput('');
    setShowKey(false);
    const request = scope.current.begin();
    defaultProviderRegistry.hasApiKey(active.id).then((stored) => {
      if (scope.current.isCurrent(request)) setHasKey(stored);
    }).catch(() => { if (scope.current.isCurrent(request)) setHasKey(false); });
    return () => { scope.current.invalidate(); };
  }, [isOpen]);

  const selectProvider = (config: ProviderConfig) => {
    scope.current.invalidate();
    setBusy(false);
    setDraft({ ...config });
    setSavedDraft({ ...config });
    setKeyInput('');
    setShowKey(false);
    setResult(null);
    setNotice('');
    setHasKey(false);
    const request = scope.current.begin();
    defaultProviderRegistry.hasApiKey(config.id).then(stored => { if (scope.current.isCurrent(request)) setHasKey(stored); }).catch(() => { if (scope.current.isCurrent(request)) setHasKey(false); });
  };

  const addProvider = () => {
    selectProvider({
      id: `router_${Date.now().toString(36)}`,
      name: '自定义服务', type: 'openai-compatible',
      baseUrl: '', model: '', enabled: true, isDefault: false,
      timeoutMs: 45000, maxRetries: 2,
    });
  };

  const saveProvider = async (): Promise<boolean> => {
    const error = validateProviderSettings(draft);
    if (error) { setNotice(error); return false; }
    const request = scope.current.begin();
    const savingDraft = { ...draft, name: draft.name.trim(), model: draft.model.trim(), baseUrl: draft.baseUrl.trim().replace(/\/+$/, '') };
    setBusy(true);
    try {
      if (savingDraft.type === 'agent-cli') {
        setKeyInput('');
        setHasKey(false);
      } else if (keyInput.trim()) {
        await defaultProviderRegistry.setApiKey(draft.id, keyInput.trim());
        if (!scope.current.isCurrent(request)) return false;
        setKeyInput('');
        setHasKey(true);
      } else {
        const stored = await defaultProviderRegistry.hasApiKey(savingDraft.id);
        if (!scope.current.isCurrent(request)) return false;
        setHasKey(stored);
      }
      if (!scope.current.isCurrent(request)) return false;
      defaultProviderRegistry.saveConfig(savingDraft);
      setDraft(savingDraft); setSavedDraft(savingDraft);
      setConfigs(defaultProviderRegistry.getAllConfigs());
      setNotice('连接设置已保存。');
      return true;
    } catch (error) {
      if (scope.current.isCurrent(request)) setNotice(`保存失败：${error instanceof Error ? error.message : '请重试'}`);
      return false;
    } finally { if (scope.current.isCurrent(request)) setBusy(false); }
  };

  const makeActive = async () => {
    if (!(await saveProvider())) return;
    try {
      defaultProviderRegistry.setActiveProvider(draft.id);
      const next = { ...stack, agentProviderId: draft.id };
      defaultCapabilityRouter.saveStackConfig(next);
      setStack(next); setSavedStack(next);
      setNotice(`${draft.name} 已设为 AI 对话模型。`);
    } catch (error) { setNotice(`切换失败：${error instanceof Error ? error.message : '请重试'}`); }
  };

  const clearKey = async () => {
    const request = scope.current.begin();
    setBusy(true);
    try {
      await defaultProviderRegistry.setApiKey(draft.id, '');
      if (!scope.current.isCurrent(request)) return;
      setHasKey(false);
      setKeyInput('');
      setNotice('密钥已移除。');
    } catch (error) {
      if (scope.current.isCurrent(request)) setNotice(`移除失败：${error instanceof Error ? error.message : '请重试'}`);
    } finally { if (scope.current.isCurrent(request)) setBusy(false); }
  };

  const removeProvider = async () => {
    if (!draft.id.startsWith('router_')) return;
    const request = scope.current.begin();
    setBusy(true);
    try {
      const active = defaultProviderRegistry.getActiveConfig();
      const next = active.id === draft.id ? defaultProviderRegistry.getAllConfigs().find(config => config.id !== draft.id)! : active;
      if (!next) throw new Error('至少保留一个模型服务。');
      const nextStack = { ...stack };
      if (nextStack.agentProviderId === draft.id) nextStack.agentProviderId = next.id;
      if (nextStack.visionProviderId === draft.id) nextStack.visionProviderId = next.id;
      if (nextStack.segmentationProviderId === draft.id) nextStack.segmentationProviderId = 'fallback-heuristic';
      if (nextStack.imageEditProviderId === draft.id) nextStack.imageEditProviderId = 'fallback-classical';
      defaultCapabilityRouter.saveStackConfig(nextStack);
      setStack(nextStack); setSavedStack(nextStack);
      defaultProviderRegistry.deleteConfig(draft.id);
      if (!scope.current.isCurrent(request)) return;
      setConfigs(defaultProviderRegistry.getAllConfigs());
      selectProvider(next);
      setNotice('自定义服务已移除。');
      const cleanupRequest = scope.current.capture();
      try { await defaultProviderRegistry.setApiKey(draft.id, ''); }
      catch { if (scope.current.isCurrent(cleanupRequest)) setNotice('服务已移除，但旧密钥未能清理。'); }
    } catch (error) {
      if (scope.current.isCurrent(request)) setNotice(`移除失败：${error instanceof Error ? error.message : '请重试'}`);
    } finally { if (scope.current.isCurrent(request)) setBusy(false); }
  };

  const testConnection = async () => {
    if (!(await saveProvider())) return;
    const request = scope.current.begin();
    setBusy(true);
    setResult(null);
    setNotice('');
    try {
      const response = await defaultProviderRegistry.getProvider(draft.id).testConnection();
      if (scope.current.isCurrent(request)) setResult(response);
    } catch (error) {
      if (scope.current.isCurrent(request)) setResult({ success: false, latencyMs: 0, model: draft.model,
        visionSupport: false, toolSupport: false,
        error: error instanceof Error ? error.message : String(error) });
    } finally { if (scope.current.isCurrent(request)) setBusy(false); }
  };

  const saveRouting = (): boolean => {
    try {
      const nextStack = { ...stack, segmentationProviderId: 'fallback-heuristic' };
      defaultCapabilityRouter.saveStackConfig(nextStack);
      if (configs.some(config => config.id === nextStack.agentProviderId)) defaultProviderRegistry.setActiveProvider(nextStack.agentProviderId);
      setStack(nextStack); setSavedStack(nextStack);
      setNotice('模型分工已保存。');
      return true;
    } catch (error) { setNotice(`保存失败：${error instanceof Error ? error.message : '请重试'}`); return false; }
  };

  const savePrivacy = (): boolean => {
    try {
      defaultCapabilityRouter.setPrivacyMode(privacy);
      defaultCapabilityRouter.setCostGuard(cost);
      const stored = defaultProviderRegistry.getConfig(draft.id);
      if (stored) defaultProviderRegistry.saveConfig({ ...stored, imageEditConfig: draft.imageEditConfig });
      setSavedPrivacy(privacy); setSavedCost(cost);
      if (stored) setSavedDraft(current => ({ ...current, imageEditConfig: draft.imageEditConfig }));
      setConfigs(defaultProviderRegistry.getAllConfigs());
      setNotice(stored ? '隐私和图像设置已保存。' : '隐私设置已保存；请先保存新服务，再保存图像设置。');
      return !!stored;
    } catch (error) { setNotice(`保存失败：${error instanceof Error ? error.message : '请重试'}`); return false; }
  };

  const savePage = async (): Promise<boolean> => {
    if (savingPage.current || busy) return false;
    savingPage.current = true;
    try {
      if ((!configs.some(config => config.id === draft.id) || hasSettingsDraftChanges(savedDraft, draft, keyInput)) && !(await saveProvider())) return false;
      if (hasSettingsDraftChanges(savedStack, stack) && !saveRouting()) return false;
      if ((savedPrivacy !== privacy || hasSettingsDraftChanges(savedCost, cost)) && !savePrivacy()) return false;
      setNotice('设置已保存。');
      return true;
    } finally { savingPage.current = false; }
  };
  useEffect(() => { onSaveController?.({ dirty, busy, save: savePage, discard: discardDrafts }); },
    [dirty, busy, draft, savedDraft, keyInput, stack, savedStack, privacy, savedPrivacy, cost, savedCost, configs, onSaveController]);

  if (!isOpen) return null;

  const isCurrent = defaultProviderRegistry.getActiveConfig().id === draft.id;
  const providerOptions = configs.filter((config) => config.enabled && config.type !== 'custom-rest');
  const visionProviderOptions = providerOptions.filter((config) => config.type !== 'agent-cli');

  return (
    <SettingsPageFrame embedded={embedded} open={isOpen} onClose={() => navigate(onClose)} label="AI 模型设置" className="provider-settings" overlayClassName="provider-settings-overlay">
      <header className="provider-settings-header">
        <div>
          <div className="provider-settings-eyebrow">AI ASSISTANT / CONNECTIONS</div>
          <h2>模型与连接</h2>
          <p>连接已登录的本机 Agent 或自己的 API，选择 AI 助手使用的模型。</p>
        </div>
        <button type="button" className="provider-settings-close" onClick={() => navigate(onClose)} aria-label="关闭 AI 模型设置"><X size={18} /></button>
      </header>

      <nav className="provider-settings-tabs" aria-label="设置分类">
        {([
          ['providers', '连接'], ['routing', '模型用途'], ['privacy', '隐私'], ['taste', '风格偏好'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={section === id ? 'is-active' : ''}
            aria-current={section === id ? 'page' : undefined}
            onClick={() => { if (section !== id) navigate(() => { setSection(id); setNotice(''); }); }}>{label}</button>
        ))}
      </nav>

      <fieldset disabled={busy} className="provider-settings-body provider-settings-fieldset">
        {section === 'taste' && <TasteSettings />}
        {section === 'providers' && (
          <div className="provider-settings-grid">
            <aside className="provider-settings-list" aria-label="模型服务">
              <div className="provider-settings-list-title">服务</div>
              {configs.map((config) => (
                <button key={config.id} type="button" onClick={() => { if (config.id !== draft.id) navigate(() => { selectProvider(defaultProviderRegistry.getConfig(config.id) || config); }); }}
                  className={`provider-settings-service ${draft.id === config.id ? 'is-selected' : ''}`}
                  aria-pressed={draft.id === config.id}>
                  <span className="provider-settings-service-mark">{config.name.slice(0, 1).toUpperCase()}</span>
                  <span className="provider-settings-service-copy"><strong>{config.name}</strong><small>{providerTypeLabels[config.type] || '未支持的协议'}</small></span>
                  {defaultProviderRegistry.getActiveConfig().id === config.id && <Check size={15} aria-label="当前选择" />}
                </button>
              ))}
              <button type="button" className="provider-settings-add" onClick={() => navigate(() => { addProvider(); })}><Plus size={15} /> 添加自定义服务</button>
            </aside>

            <div className="provider-settings-form">
              <div className="provider-settings-form-heading">
                <div><h3>{draft.name || '自定义服务'}</h3></div>
                {isCurrent && <span className="provider-settings-current">当前选择</span>}
              </div>

              {draft.type === 'agent-cli' ? <div className="provider-settings-section">
                <div className="provider-settings-intro"><h3>连接本机 Agent</h3><p>沿用 {draft.name} 的登录与模型服务配置。点击“测试连接”检查客户端是否已安装，再设为对话模型。编辑请求会经过 Lumiseq 的工具权限与撤销历史。</p></div>
                <p className="provider-settings-hint">本机客户端不会读取此处的 API 密钥；当前连接处理文字和编辑工具调用。</p>
              </div> : <><div className="provider-settings-fields">
                <label>服务名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                <label>接口协议<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as ProviderType })}>
                  <option value="openai">OpenAI</option><option value="anthropic">Anthropic Claude</option>
                  <option value="gemini">Google Gemini</option><option value="openai-compatible">OpenAI 兼容</option>
                  {draft.type === 'local' && <option value="local">现有兼容服务（原配置）</option>}
                  {draft.type === 'custom-rest' && <option value="custom-rest">旧版自定义 REST（不支持对话）</option>}
                </select></label>
                <label className="provider-settings-wide">API 基础地址<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} spellCheck={false} placeholder="https://api.example.com/v1" /></label>
                <label>对话模型 ID<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} spellCheck={false} placeholder="填写账号可用的模型 ID" /></label>
                <label>图像理解模型 ID <em>可选</em><input value={draft.visionModel || ''} onChange={(event) => setDraft({ ...draft, visionModel: event.target.value })} spellCheck={false} placeholder="留空则使用对话模型" /></label>
              </div>
              <p className="provider-settings-hint">填写服务提供的模型 ID。使用百炼时，地址需与密钥地域一致。</p>

              <div className="provider-settings-secret">
                <div className="provider-settings-secret-heading"><strong>API 密钥</strong><span>{hasKey ? '已安全保存' : '尚未填写'}</span></div>
                <div className="provider-settings-key-row">
                  <div className="provider-settings-key-input"><input type={showKey ? 'text' : 'password'} aria-label="API 密钥" autoComplete="off" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} placeholder={hasKey ? '输入新密钥以替换' : '粘贴 API 密钥'} /><button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? '隐藏密钥' : '显示密钥'}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
                  {hasKey && <button type="button" className="provider-settings-text-button" onClick={clearKey}>移除</button>}
                </div>
                <small>密钥由 Windows 加密保存在本机，不写入作品。在线请求会发送至所选模型服务。</small>
              </div></>}

              {result && <div className={`provider-settings-result ${result.success ? 'is-success' : 'is-error'}`} role="status">
                <strong>{result.success ? draft.type === 'agent-cli' ? '已找到客户端' : '连接成功' : '连接失败'}</strong>
                <span>{result.success ? draft.type === 'agent-cli' ? `${result.detail || '客户端已安装。'}首次发送消息时验证实际连接。` : `${result.model} · ${result.latencyMs} ms · 工具调用${result.toolSupport ? '可用' : '未验证'}` : result.error || '请检查服务地址、密钥和模型 ID。'}</span>
              </div>}
              <div className="provider-settings-actions">
                {draft.id.startsWith('router_') && configs.some((config) => config.id === draft.id) && <button type="button" className="provider-settings-delete" onClick={removeProvider} aria-label="删除自定义服务"><Trash2 size={16} /></button>}
                <button type="button" className="provider-settings-secondary" onClick={testConnection} disabled={busy}><RefreshCw size={15} className={busy ? 'provider-settings-spin' : ''} />{busy ? '处理中…' : hasSettingsDraftChanges(savedDraft, draft, keyInput) || !configs.some(config => config.id === draft.id) ? '保存并测试' : '测试连接'}</button>
                {!embedded && <button type="button" className="provider-settings-secondary" onClick={saveProvider}>保存连接</button>}
                <button type="button" className="provider-settings-primary" onClick={makeActive}>{hasSettingsDraftChanges(savedDraft, draft, keyInput) || !configs.some(config => config.id === draft.id) ? '保存并设为对话模型' : '设为对话模型'}</button>
              </div>
            </div>
          </div>
        )}

        {section === 'routing' && <div className="provider-settings-section">
          <div className="provider-settings-intro"><h3>按用途选择模型</h3><p>对话和图像理解可以分别选择服务。区域分割在本机完成。</p></div>
          <div className="provider-settings-routing-grid">
            <label>AI 对话与工具调用<select value={stack.agentProviderId} onChange={(event) => setStack({ ...stack, agentProviderId: event.target.value })}>{providerOptions.map((config) => <option key={config.id} value={config.id}>{config.name} · {config.model}</option>)}</select></label>
            <label>画面理解<select value={stack.visionProviderId} onChange={(event) => setStack({ ...stack, visionProviderId: event.target.value })}>{visionProviderOptions.map((config) => <option key={config.id} value={config.id}>{config.name} · {config.visionModel || config.model}</option>)}</select></label>
            <label>区域分割<select value="fallback-heuristic" disabled><option value="fallback-heuristic">本机区域分割</option></select></label>
            <label>局部填充<select value={stack.imageEditProviderId} onChange={(event) => setStack({ ...stack, imageEditProviderId: event.target.value })}><option value="fallback-classical">本机内容感知填充</option>{providerOptions.filter((config) => config.type !== 'agent-cli' && (config.type === 'openai' || config.imageEditConfig)).map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}</select></label>
          </div>
          {!embedded && <div className="provider-settings-section-actions"><button type="button" className="provider-settings-primary" onClick={saveRouting}>保存模型分工</button></div>}
        </div>}

        {section === 'privacy' && <div className="provider-settings-section">
          <div className="provider-settings-intro"><h3>图像与隐私</h3><p>选择上传方式，控制图像生成前的确认。</p></div>
          <fieldset className="provider-settings-choice-group"><legend>图像上传</legend>
            {([['allow', '允许上传', '图像理解或重绘时，发送所需的预览或裁剪图。'], ['ask', '上传前询问', '每次发送图像前，由你确认。'], ['never', '不上传图像', '停用远程图像理解与重绘；文字对话仍连接所选服务。']] as const).map(([value, title, description]) => <label key={value}><input type="radio" name="provider-privacy" checked={privacy === value} onChange={() => setPrivacy(value)} /><span><strong>{title}</strong><small>{description}</small></span></label>)}
          </fieldset>
          <fieldset className="provider-settings-choice-group"><legend>费用确认</legend>
            <label><input type="checkbox" checked={cost.askBeforeImageGeneration} onChange={(event) => setCost({ ...cost, askBeforeImageGeneration: event.target.checked })} /><span><strong>图像生成前确认</strong></span></label>
            <label><input type="checkbox" checked={cost.askBeforeBatch} onChange={event => setCost({ ...cost, askBeforeBatch: event.target.checked })} /><span><strong>批量处理前确认</strong></span></label>
            <label>批量照片上限<input type="number" min={1} max={100} value={cost.maxBatchPhotos} onChange={event => setCost({ ...cost, maxBatchPhotos: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })} /></label>
            <p>每次创作最多比较两个方向；任务最多使用 20 次模型请求和 40 次操作。</p>
          </fieldset>
          {draft.type !== 'agent-cli' && <div className="provider-settings-image-config"><strong>当前服务的局部重绘接口</strong><div className="provider-settings-fields">
            <label>协议<select value={draft.imageEditConfig?.style || 'openai-edits'} onChange={(event) => setDraft({ ...draft, imageEditConfig: { ...draft.imageEditConfig, style: event.target.value as 'openai-edits' | 'generic-rest' } })}><option value="openai-edits">OpenAI Images Edits</option><option value="generic-rest">通用 JSON REST</option></select></label>
            <label>图像编辑模型 ID<input value={draft.imageEditConfig?.imageEditModel ?? (draft.type === 'openai' ? 'gpt-image-2' : '')} onChange={(event) => setDraft({ ...draft, imageEditConfig: { ...draft.imageEditConfig, style: draft.imageEditConfig?.style || 'openai-edits', imageEditModel: event.target.value } })} spellCheck={false} placeholder="输入该接口支持的图像模型" /></label>
          </div></div>}
          {!embedded && <div className="provider-settings-section-actions"><button type="button" className="provider-settings-primary" onClick={savePrivacy}>保存隐私设置</button></div>}
        </div>}
      </fieldset>
      <SettingsUnsavedDialog open={!!pendingNavigation} onCancel={() => setPendingNavigation(null)} onDiscard={() => { const action = pendingNavigation; setPendingNavigation(null); discardDrafts(); action?.(); }} onSave={async () => {
        if (!(await savePage())) return false;
        const action = pendingNavigation; setPendingNavigation(null); action?.(); return true;
      }} />
      {notice && <div className="provider-settings-notice" role="status" aria-live="polite">{notice}</div>}
      {!embedded && <SettingsSaveFooter dirty={dirty} busy={busy} onSave={() => { void savePage(); }} />}
    </SettingsPageFrame>
  );
};
