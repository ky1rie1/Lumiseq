import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, Brush, Cpu, Download, Layout, Palette, Search, Server, Shield, X } from 'lucide-react';
import { OverlayModal } from '../shared/OverlayModal';
import { useStudioPreferences } from '../../stores/useStudioPreferences';
import type { PreferenceSection, StudioPreferences } from '../../stores/studioPreferences';
import { resetPreferenceSection } from '../../stores/studioPreferences';
import { hasSettingsDraftChanges, preferenceSectionPatch, type SettingsSaveController } from './settingsDraft';
import { SettingsSaveFooter } from './SettingsSaveFooter';
import { SettingsUnsavedDialog } from './SettingsUnsavedDialog';
import { ProviderSettingsContent } from './ProviderSettingsContent';
import { ExternalAgentsModal } from './ExternalAgentsModal';
import { DiagnosticsModal } from './DiagnosticsModal';
import { defaultSegmentationCache } from '../../ai/segmentation/SegmentationCache';
import { AppearancePreview } from './AppearancePreview';
import './settingsCenter.css';

export type SettingsCategory = PreferenceSection | 'ai' | 'agents' | 'diagnostics';
const categories = [
  { id: 'general', label: '常规', icon: Layout, description: '按你的习惯开始工作。', keywords: '首页 启动 最近 项目 AI 面板 快捷键 工作区' },
  { id: 'appearance', label: '外观', icon: Palette, description: '按阅读和操作习惯调整界面。', keywords: '界面 密度 紧凑 舒适 动画 动效 背景 颜色' },
  { id: 'canvas', label: '画布与工具', icon: Brush, description: '让缩放和画笔更顺手。', keywords: '滚轮 缩放 棋盘 透明 画笔 硬度 尺寸' },
  { id: 'files', label: '文件与导出', icon: Download, description: '保存恢复副本，设置常用导出选项。', keywords: '保存 恢复 自动 JPEG PNG 品质 导出' },
  { id: 'performance', label: '性能', icon: Cpu, description: '平衡预览效果和资源占用。', keywords: '撤销 历史 预览 精度 缓存 内存 空闲 抠图 加速 GPU CPU 显卡' },
  { id: 'ai', label: 'AI 服务', icon: Shield, description: '连接本机 Agent 或 API，配置对话与图像能力。', keywords: '模型 服务 API 密钥 Agent Codex Claude Antigravity 隐私 上传 连接' },
  { id: 'agents', label: 'Agent 联动', icon: Server, description: '让外部 Agent 通过 MCP 操作 Lumiseq。', keywords: '外部控制 MCP stdio HTTP 端口 令牌 权限 Claude Cursor' },
  { id: 'diagnostics', label: '诊断与关于', icon: Activity, description: '查看运行状态，或恢复偏好默认值。', keywords: '诊断 版本 关于 GPU 渲染 默认 重置' },
] as const;

function SettingRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <div className="settings-row"><div className="settings-row-copy"><strong>{label}</strong>{description && <p>{description}</p>}</div><div className="settings-row-control">{children}</div></div>;
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-group"><h3>{title}</h3>{children}</section>;
}

function PreferenceNumber({ value, onChange, label, min, max, step, scale }: {
  value: number; onChange: (value: number) => void; label: string; min: number; max: number; step: number; scale: number;
}) {
  const [text, setText] = useState(String(Math.round(value * scale)));
  useEffect(() => setText(String(Math.round(value * scale))), [value, scale]);
  return <input aria-label={label} type="number" min={min} max={max} step={step} value={text}
    onChange={event => { const next = event.target.value; setText(next); const number = Number(next); if (next !== '' && Number.isFinite(number) && number >= min && number <= max && Number.isInteger(number)) onChange(number / scale); }}
    onBlur={() => { const number = Number(text); if (text === '' || !Number.isFinite(number)) { setText(String(Math.round(value * scale))); return; } const next = Math.round(Math.min(max, Math.max(min, number))); setText(String(next)); onChange(next / scale); }} />;
}

export function SettingsCenter({ isOpen, onClose, initialCategory = 'general' }: { isOpen: boolean; onClose: () => void; initialCategory?: SettingsCategory }) {
  const savedPreferences = useStudioPreferences(s => s.preferences);
  const commit = useStudioPreferences(s => s.commitPreferences);
  const [preferences, setPreferences] = useState(savedPreferences);
  const update = (patch: Partial<StudioPreferences>) => setPreferences(current => ({ ...current, ...patch }));
  const reset = (section: PreferenceSection) => setPreferences(current => resetPreferenceSection(current, section));
  const persistenceError = useStudioPreferences(s => s.persistenceError);
  const [category, setCategory] = useState<SettingsCategory>(initialCategory);
  const [query, setQuery] = useState('');
  const [serviceState, setServiceState] = useState({ dirty: false, busy: false });
  const controller = useRef<SettingsSaveController | null>(null);
  const saving = useRef(false);
  const [savingPage, setSavingPage] = useState(false);
  const onSaveController = useCallback((next: SettingsSaveController) => {
    controller.current = next;
    setServiceState(current => current.dirty === next.dirty && current.busy === next.busy ? current : { dirty: next.dirty, busy: next.busy });
  }, []);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [notice, setNotice] = useState('');
  const [resetCategory, setResetCategory] = useState<PreferenceSection>('general');
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (isOpen) { setCategory(initialCategory); setQuery(''); setNotice(''); setPreferences(useStudioPreferences.getState().preferences); setPending(null); } }, [isOpen, initialCategory]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); setNotice(''); }, [category]);
  if (!isOpen) return null;
  const servicePage = category === 'ai' || category === 'agents';
  const patch = category === 'diagnostics'
    ? Object.fromEntries(Object.entries(preferences).filter(([key, value]) => value !== savedPreferences[key as keyof StudioPreferences])) as Partial<StudioPreferences>
    : !servicePage ? preferenceSectionPatch(preferences, category as PreferenceSection) : {};
  const dirty = servicePage ? serviceState.dirty : category === 'diagnostics' ? Object.keys(patch).length > 0 : hasSettingsDraftChanges(preferenceSectionPatch(savedPreferences, category as PreferenceSection), patch);
  const busy = savingPage || (servicePage && serviceState.busy);
  const discardCurrent = () => {
    controller.current?.discard();
    setPreferences(useStudioPreferences.getState().preferences);
  };
  const saveCurrent = async (): Promise<boolean> => {
    if (saving.current || (servicePage && controller.current?.busy)) return false;
    saving.current = true; setSavingPage(true);
    try {
      const success = servicePage ? await controller.current?.save() ?? false : commit(patch);
      if (success) { setPreferences(useStudioPreferences.getState().preferences); setNotice('设置已保存。'); }
      return success;
    } catch (error) { setNotice(`保存失败：${error instanceof Error ? error.message : '请重试'}`); return false; }
    finally { saving.current = false; setSavingPage(false); }
  };
  const requestNavigation = (action: () => void) => {
    if (busy || saving.current) { setNotice('请等待当前操作完成。'); return; }
    if (dirty) setPending(() => action);
    else action();
  };
  const navigate = (id: SettingsCategory) => {
    if (id !== category) requestNavigation(() => { controller.current = null; setServiceState({ dirty: false, busy: false }); setPreferences(useStudioPreferences.getState().preferences); setCategory(id); });
  };
  const current = categories.find(item => item.id === category)!;
  const filtered = categories.filter(item => query.trim().toLowerCase().split(/\s+/).every(word => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(word)));
  const select = <K extends keyof StudioPreferences,>(key: K, label: string, options: readonly (readonly [StudioPreferences[K], string])[]) => <select aria-label={label} value={String(preferences[key])} onChange={event => { const option = options.find(([value]) => String(value) === event.target.value); if (option) update({ [key]: option[0] } as Partial<StudioPreferences>); }}>{options.map(([value, text]) => <option key={String(value)} value={String(value)}>{text}</option>)}</select>;
  const number = (key: 'defaultBrushSize' | 'defaultBrushHardness' | 'jpegQuality' | 'historyLimit', label: string, min: number, max: number, step = 1, scale = 1) => <PreferenceNumber label={label} value={preferences[key]} min={min} max={max} step={step} scale={scale} onChange={value => update({ [key]: value })} />;
  return <OverlayModal open={isOpen} onClose={() => requestNavigation(onClose)} label="设置" className="settings-center" overlayClassName="settings-overlay">
    <header className="settings-center-header"><h2>设置</h2><button type="button" className="settings-close" onClick={() => requestNavigation(onClose)} aria-label="关闭设置" title="关闭设置 · Esc"><X size={17} /></button></header>
    <div className="settings-center-layout"><aside className="settings-sidebar"><label className="settings-search"><Search size={15} /><input aria-label="搜索设置" placeholder="搜索设置…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" onClick={() => setQuery('')} aria-label="清除设置搜索"><X size={13} /></button>}</label><nav aria-label="设置分类">{filtered.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={category === id ? 'page' : undefined} className={category === id ? 'is-active' : ''} onClick={() => navigate(id)}><Icon size={16} /><span>{label}</span></button>)}</nav>{filtered.length === 0 && <p className="settings-search-empty">未找到相关设置。</p>}</aside>
      <div key={category} className="settings-main"><div className="settings-page-heading"><h2>{current.label}</h2><p>{current.description}</p></div><div ref={scrollRef} className="settings-page-scroll">
        {category === 'general' && <><Group title="启动与工作区"><SettingRow label="启动进入" description="下次启动生效；文档仍需自行打开。">{select('startupWorkspace', '启动进入', [['home', '首页'], ['last', '上次工作区']])}</SettingRow><SettingRow label="默认打开 AI 面板"> <input aria-label="默认打开 AI 面板" type="checkbox" role="switch" checked={preferences.openAiPanel} onChange={event => update({ openAiPanel: event.target.checked })} /></SettingRow><SettingRow label="最近项目数量">{select('recentLimit', '最近项目数量', [[5, '5 个'], [10, '10 个'], [20, '20 个'], [30, '30 个']])}</SettingRow></Group><Group title="快捷键"><dl className="settings-shortcuts"><div><dt>搜索文档与操作</dt><dd><kbd>Ctrl K</kbd></dd></div><div><dt>保存项目</dt><dd><kbd>Ctrl S</kbd></dd></div><div><dt>撤销 / 重做</dt><dd><kbd>Ctrl Z / Ctrl Shift Z</kbd></dd></div><div><dt>拖动画布</dt><dd><kbd>空格 + 拖动</kbd></dd></div></dl></Group></>}
        {category === 'appearance' && <Group title="专业工作台"><SettingRow label="界面间距" description="舒适便于阅读；紧凑可在同一屏看到更多工具。">{select('density', '界面间距', [['comfortable', '舒适'], ['compact', '紧凑']])}</SettingRow><SettingRow label="界面材质" description="中性深灰表面与银色选中线保持清晰对比。"><span className="settings-fixed-value">深灰银色</span></SettingRow><SettingRow label="动效节奏" description="正常：短暂悬停与淡入；减少：仅短暂淡入；关闭：完全静态。系统减少动态效果优先。">{select('motion', '动效节奏', [['full', '正常'], ['reduced', '减少'], ['off', '关闭']])}</SettingRow><SettingRow label="画布周围背景" description="只改变照片周围的底色，便于判断画面明暗。"><div className="settings-color"><input type="color" aria-label="画布周围背景颜色" value={preferences.canvasBackground} onChange={event => update({ canvasBackground: event.target.value })} /><code>{preferences.canvasBackground}</code></div></SettingRow><AppearancePreview density={preferences.density} motion={preferences.motion} canvasBackground={preferences.canvasBackground} /></Group>}
        {category === 'canvas' && <><Group title="画布输入"><SettingRow label="滚轮缩放方向">{select('wheelDirection', '滚轮缩放方向', [['normal', '正常'], ['reverse', '反向']])}</SettingRow><SettingRow label="滚轮缩放速度">{select('wheelSpeed', '滚轮缩放速度', [['slow', '慢'], ['normal', '正常'], ['fast', '快']])}</SettingRow></Group><Group title="透明区域"><SettingRow label="棋盘格尺寸">{select('checkerSize', '棋盘格尺寸', [['small', '小'], ['medium', '中'], ['large', '大']])}</SettingRow><SettingRow label="棋盘格明暗">{select('checkerTone', '棋盘格明暗', [['light', '浅色'], ['dark', '深色']])}</SettingRow></Group><Group title="新画笔默认值"><SettingRow label="画笔尺寸" description="1–1000 px，作为下次打开编辑工作区时的初始尺寸。">{number('defaultBrushSize', '默认画笔尺寸', 1, 1000)}</SettingRow><SettingRow label="画笔硬度" description="0–100%。">{number('defaultBrushHardness', '默认画笔硬度百分比', 0, 100, 1, 100)}</SettingRow></Group></>}
        {category === 'files' && <><Group title="自动恢复"><SettingRow label="恢复间隔" description="定期保留新修改，方便意外退出后找回。">{select('recoveryIntervalSeconds', '恢复间隔', [[15, '15 秒'], [30, '30 秒'], [60, '60 秒'], [120, '120 秒']])}</SettingRow><p className="settings-help">完成编辑后仍需保存项目。清理缓存时会保留恢复副本。</p></Group><Group title="导出默认值"><SettingRow label="默认图像格式">{select('exportFormat', '默认图像格式', [['jpeg', 'JPEG'], ['png', 'PNG']])}</SettingRow><SettingRow label="JPEG 品质" description="1–100，可在导出时再次调整。">{number('jpegQuality', 'JPEG 品质', 1, 100)}</SettingRow></Group></>}
        {category === 'performance' && <><Group title="历史与预览"><SettingRow label="历史步数" description="20–200 步。减少步数会移除较早的撤销记录，保留当前作品。">{number('historyLimit', '历史步数', 20, 200)}</SettingRow><SettingRow label="预览精度" description="调整编辑时的预览清晰度，不改变导出尺寸。">{select('previewQuality', '预览精度', [['auto', '自动'], ['economy', '节省'], ['high', '高质量']])}</SettingRow></Group><Group title="图像计算"><SettingRow label="抠图加速" description="优先使用可用显卡，不支持时自动使用 CPU。仅用于抠图。">{select('cutoutAcceleration', '抠图加速', [['auto', '自动适配'], ['cpu', '仅 CPU']])}</SettingRow></Group><Group title="内存与会话"><SettingRow label="抠图闲置释放" description="闲置后释放模型占用的内存，下次抠图时重新加载。">{select('cutoutIdleMinutes', '抠图闲置释放', [[0, '不自动释放'], [1, '1 分钟'], [3, '3 分钟'], [5, '5 分钟']])}</SettingRow><SettingRow label="清理预览缓存" description="释放可重新生成的分割缓存，保留作品和恢复副本。"><button type="button" onClick={() => { defaultSegmentationCache.clear(); setNotice('缓存已清理，作品与恢复副本已保留。'); }}>释放缓存</button></SettingRow></Group></>}
        {category === 'ai' && <><div className="settings-builtin"><strong>离线抠图</strong><p>已随软件提供，无需下载或上传图片。实际加速方式可在诊断页查看。</p></div><div className="settings-service-intro"><strong>应用内聊天</strong><p>选择已安装并登录的 Agent 客户端，或配置 API。外部 Agent 要控制 Lumiseq 时，请使用“Agent 联动”的 MCP 连接。</p></div><ProviderSettingsContent isOpen onClose={() => requestNavigation(onClose)} embedded onSaveController={onSaveController} /></>}
        {category === 'agents' && <ExternalAgentsModal isOpen onClose={() => requestNavigation(onClose)} embedded onSaveController={onSaveController} />}
        {category === 'diagnostics' && <><DiagnosticsModal isOpen onClose={() => requestNavigation(onClose)} embedded /><Group title="恢复偏好默认值"><SettingRow label="要恢复的分类" description="恢复所选分类，保留服务连接、密钥、作品和预设。"><select aria-label="恢复默认的分类" value={resetCategory} onChange={event => setResetCategory(event.target.value as PreferenceSection)}>{categories.slice(0, 5).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></SettingRow><div className="settings-group-actions"><button type="button" onClick={() => { reset(resetCategory); setNotice('默认值已填入，请保存后生效。'); }}>恢复默认值</button></div></Group></>}
        {(['general', 'appearance', 'canvas', 'files', 'performance'] as SettingsCategory[]).includes(category) && <div className="settings-group-actions"><button type="button" onClick={() => { reset(category as PreferenceSection); setNotice('默认值已填入，请保存后生效。'); }}>恢复默认</button></div>}
        {notice && <div className="settings-feedback" role="status">{notice}</div>}
        {persistenceError && <div className="settings-feedback settings-feedback-error" role="alert">{persistenceError}</div>}
      </div><SettingsSaveFooter dirty={dirty} busy={busy} readOnly={category === 'diagnostics' && !dirty} onSave={() => { void saveCurrent(); }} /></div></div>
    <SettingsUnsavedDialog open={!!pending} onCancel={() => setPending(null)} onDiscard={() => { const action = pending; setPending(null); discardCurrent(); action?.(); }} onSave={async () => { if (!(await saveCurrent())) return false; const action = pending; setPending(null); action?.(); return true; }} />
  </OverlayModal>;
}
