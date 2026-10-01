// src/ui/ai/AIPanel.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  X,
  Settings,
  ShieldCheck,
  ShieldAlert,
  StopCircle,
  SlidersHorizontal,
  Layers,
  RotateCcw,
  Bot,
  Plug,
  ChevronRight,
  FileImage,
  LoaderCircle,
  RefreshCw,
  FolderOpen,
  Plus
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { useAppearanceStore } from '../../stores/useAppearanceStore';
import { defaultAgentRuntime } from '../../ai/runtime/AgentRuntime';
import { defaultProviderRegistry } from '../../ai/providers/ProviderRegistry';
import { defaultPermissionGuard } from '../../ai/permissions/PermissionGuard';
import { defaultCommandBus } from '../../history/CommandBus';
import { defaultDocumentManager } from '../../document/DocumentManager';
import { AgentRun, PermissionLevel } from '../../ai/types';
import { ActionLogView } from './ActionLogView';
import { ProviderSettingsModal } from './ProviderSettingsModal';
import { CanonicalTool } from '../../ai/tools/CanonicalTool';
import { useDocuments } from '../shared/useDocuments';
import { StudioActionHandlers } from '../../app/studioActions';
import { CreativeReview } from './CreativeReview';
import { useProviderConnection } from './useProviderConnection';
import './aiPanel.css';

/** Matches the `dock-exit` animation duration defined in studio.css. */
const DOCK_EXIT_DURATION_MS = 180;

interface AIPanelProps {
  actions: StudioActionHandlers;
}

export const AIPanel: React.FC<AIPanelProps> = ({ actions }) => {
  const isAiPanelOpen = useAppStore((s) => s.isAiPanelOpen);
  const toggleAiPanel = useAppStore((s) => s.toggleAiPanel);
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const { activeDocument } = useDocuments();

  const [promptInput, setPromptInput] = useState('');
  const [explore, setExplore] = useState(false);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [streamingText, setStreamingText] = useState<string>('');
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>('auto');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { connection, refreshConnection } = useProviderConnection(isAiPanelOpen);
  const [submitting, setSubmitting] = useState(false);
  const [composerMessage, setComposerMessage] = useState('');
  const submissionPending = useRef(false);
  const followTail = useRef(true);

  useEffect(() => {
    setRuns([...(activeDocument?.aiHistory?.runs ?? [])].reverse());
    followTail.current = true;
  }, [activeDocument?.id]);

  // Interactive tool execution confirmation state
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    tool: CanonicalTool;
    args: Record<string, any>;
    resolve: (allowed: boolean) => void;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const prefersReducedMotion = useAppearanceStore((s) => s.reduceMotion);
  // Dock lifecycle: 'open' renders the shell, 'closing' keeps it mounted while
  // the exit animation plays, 'closed' unmounts it so no focusable control or
  // stale content survives in the accessibility tree.
  const [dockPhase, setDockPhase] = useState<'open' | 'closing' | 'closed'>(
    isAiPanelOpen ? 'open' : 'closed'
  );

  const motionIsSuppressed =
    prefersReducedMotion ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Adjust the phase during render so a toggle lands in a single commit:
  // opening never paints an empty frame, and closing with reduced motion
  // unmounts immediately instead of waiting out an invisible animation.
  if (isAiPanelOpen && dockPhase !== 'open') {
    setDockPhase('open');
  } else if (!isAiPanelOpen && dockPhase === 'open') {
    setDockPhase(motionIsSuppressed ? 'closed' : 'closing');
  }

  // Unmount once the exit animation has run. The cleanup also cancels the timer
  // when the panel is reopened mid-animation, so rapid toggling cannot strand
  // the dock in an invisible state.
  useEffect(() => {
    if (dockPhase !== 'closing') return;
    const exitTimer = window.setTimeout(() => setDockPhase('closed'), DOCK_EXIT_DURATION_MS);
    return () => window.clearTimeout(exitTimer);
  }, [dockPhase]);

  // Set up PermissionGuard handler
  useEffect(() => {
    defaultPermissionGuard.setLevel(permissionLevel);
    defaultPermissionGuard.setConfirmationHandler(async (tool, args) => {
      return new Promise<boolean>((resolve) => {
        setPendingConfirmation({ tool, args, resolve });
      });
    });
  }, [permissionLevel]);

  // Subscribe to AgentRuntime events
  useEffect(() => {
    const unsubscribe = defaultAgentRuntime.subscribe((event) => {
      if (event.type === 'run_started' && event.run) {
        followTail.current = true;
        setActiveRun({ ...event.run });
        setStreamingText('');
      } else if (event.type === 'delta' && event.delta) {
        setStreamingText((prev) => prev + event.delta);
      } else if (event.type === 'action_completed' && event.run) {
        setActiveRun({ ...event.run });
      } else if (event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled') {
        if (event.run) {
          setRuns((prev) => [event.run!, ...prev.filter(run => run.runId !== event.run!.runId)]);
        }
        setActiveRun(null);
        setStreamingText('');
      }
    });

    return () => unsubscribe();
  }, []);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    if (scrollRef.current && followTail.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [runs, activeRun, streamingText, isAiPanelOpen]);

  if (dockPhase === 'closed') return null;

  const handleSendPrompt = async (textToSend?: string) => {
    const prompt = (textToSend || promptInput).trim();
    if (!prompt || submissionPending.current || defaultAgentRuntime.getActiveRun()) return;

    const activeDoc = defaultDocumentManager.getActiveDocument();
    if (!activeDoc) {
      setComposerMessage('请先打开文件或新建画布。');
      return;
    }

    const provider = defaultProviderRegistry.getActiveConfig();
    submissionPending.current = true;
    setSubmitting(true);
    try {
      const readiness = await defaultProviderRegistry.getReadiness(provider.id);
      if (defaultProviderRegistry.getActiveConfig() !== provider || defaultDocumentManager.getActiveDocument() !== activeDoc) {
        setComposerMessage('文档或 AI 服务已切换，请重新发送。');
        return;
      }
      if (!readiness.canSend) {
        setPromptInput(previous => previous || prompt);
        setComposerMessage('');
        setIsSettingsOpen(true);
        refreshConnection();
        return;
      }
      if (defaultAgentRuntime.getActiveRun()) return;
      setComposerMessage('');
      setPromptInput('');
      await defaultAgentRuntime.run(prompt, {
        workspace: currentWorkspace === 'develop' ? 'develop' : 'edit',
        explore,
      });
    } catch (error) {
      setPromptInput(previous => previous || prompt);
      setComposerMessage(error instanceof Error ? error.message : '无法启动 AI 任务，请重试。');
    } finally {
      submissionPending.current = false;
      setSubmitting(false);
    }
  };

  const handleCancelRun = () => {
    defaultAgentRuntime.cancelActiveRun();
  };

  const handleUndoRun = (runId: string) => {
    if (!defaultAgentRuntime.undoRun(runId)) {
      setComposerMessage(defaultAgentRuntime.getRunUndoBlockReason(runId) ?? '当前任务无法安全撤销，修改已保留。');
      return;
    }
    setComposerMessage('已撤销本次运行的编辑操作。');
    setRuns((prev) =>
      prev.map((r) =>
        r.runId === runId
          ? {
              ...r,
              actions: r.actions.map((a) => ({ ...a, status: 'rejected' })),
            }
          : r
      )
    );
  };

  const handleUndoLastRun = () => {
    const entry = defaultCommandBus.getHistory().slice().reverse().find(item => item.agentRunId);
    if (entry?.agentRunId) handleUndoRun(entry.agentRunId);
    else setComposerMessage('没有可撤销的 AI 编辑记录。');
  };

  const lastUndoableRun = defaultCommandBus.getHistory().slice().reverse().find(item => item.agentRunId);

  const cyclePermissionLevel = () => {
    const next: Record<PermissionLevel, PermissionLevel> = {
      auto: 'ask',
      ask: 'full',
      full: 'readonly',
      readonly: 'auto',
    };
    const newLevel = next[permissionLevel];
    setPermissionLevel(newLevel);
    defaultPermissionGuard.setLevel(newLevel);
  };

  const getPermissionBadge = () => {
    switch (permissionLevel) {
      case 'auto':
        return (
          <button
            onClick={cyclePermissionLevel}
            title="自动模式：常规工具自动执行，危险工具会先请求确认。点击切换权限级别"
            className="ai-permission-badge flex items-center space-x-1 px-2 py-0.5 rounded text-2xs border transition-colors"
          >
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>自动模式</span>
          </button>
        );
      case 'ask':
        return (
          <button
            onClick={cyclePermissionLevel}
            title="逐项确认：所有工具在执行前都需要你确认。点击切换权限级别"
            className="ai-permission-badge flex items-center space-x-1 px-2 py-0.5 rounded text-2xs border transition-colors"
          >
            <ShieldAlert className="w-3 h-3 text-amber-400" />
            <span>逐项确认</span>
          </button>
        );
      case 'full':
        return (
          <button
            onClick={cyclePermissionLevel}
            title="完全授权：所有常规操作直接执行，不再询问。点击切换权限级别"
            className="ai-permission-badge flex items-center space-x-1 px-2 py-0.5 rounded text-2xs border transition-colors"
          >
            <ShieldAlert className="w-3 h-3 text-blue-400" />
            <span>完全授权</span>
          </button>
        );
      case 'readonly':
        return (
          <button
            onClick={cyclePermissionLevel}
            title="只读模式：仅允许查看类工具，禁止修改操作。点击切换权限级别"
            className="ai-permission-badge flex items-center space-x-1 px-2 py-0.5 rounded text-2xs border transition-colors"
          >
            <ShieldCheck className="w-3 h-3 text-zinc-400" />
            <span>只读模式</span>
          </button>
        );
    }
  };

  return (
    <div
      className="ai-dock h-full flex flex-col select-none z-30"
      aria-label="影序 AI 助手"
      data-closing={dockPhase === 'closing' ? 'true' : 'false'}
      inert={dockPhase === 'closing'}
    >
      {/* Panel Header */}
      <div className="ai-dock-header">
        <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="ai-brand-icon">
            <Sparkles className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-studio-100">影序助手</h2>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setIsSettingsOpen(true)}
            title="AI 连接设置"
            aria-label="AI 连接设置"
            className="ai-icon-button"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={toggleAiPanel}
            title="关闭面板"
            aria-label="关闭 AI 助手"
            className="ai-icon-button"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        </div>
        <div className="ai-dock-context"><FileImage size={14} aria-hidden="true" /><strong title={activeDocument ? activeDocument.kind === 'edit' ? activeDocument.name : activeDocument.fileName : '尚未打开文档'}>{activeDocument ? activeDocument.kind === 'edit' ? activeDocument.name : activeDocument.fileName : '尚未打开文档'}</strong></div>
        <div className="ai-dock-meta">
          <button type="button" className="ai-connection-selector" data-status={connection.status}
            onClick={() => setIsSettingsOpen(true)} title={connection.detail} aria-label={`AI 连接：${connection.label}`}>
            <Plug size={13} aria-hidden="true" /><span>{connection.label}</span><ChevronRight size={12} aria-hidden="true" />
          </button>
          {getPermissionBadge()}
        </div>
      </div>

      {/* Confirmation Modal / Banner if tool requires permission */}
      {pendingConfirmation && (
        <div className="ai-confirmation p-3 border-b text-xs space-y-2">
          <div className="flex items-center space-x-2 text-amber-300 font-semibold">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>确认工具执行</span>
          </div>
          <div className="ai-confirmation-details text-2xs font-mono p-2 rounded">
            <div>工具：{pendingConfirmation.tool.schema.name}</div>
            <div className="mt-1">
              参数：{JSON.stringify(pendingConfirmation.args)}
            </div>
          </div>
          <div className="flex items-center justify-end space-x-2 pt-1">
            <button
              onClick={() => {
                pendingConfirmation.resolve(false);
                setPendingConfirmation(null);
              }}
              className="px-2.5 py-1 text-2xs font-medium bg-studio-800 hover:bg-studio-700 text-studio-200 rounded"
            >
              拒绝
            </button>
            <button
              onClick={() => {
                pendingConfirmation.resolve(true);
                setPendingConfirmation(null);
              }}
              className="ai-confirm-button px-3 py-1 text-2xs font-medium rounded font-semibold"
            >
              允许执行
            </button>
          </div>
        </div>
      )}

      {/* Message and Action Log Feed */}
      <div ref={scrollRef} className="ai-feed flex-1 overflow-y-auto" onScroll={event => {
        const feed = event.currentTarget;
        followTail.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
      }}>
        {!activeDocument && (
          <div className="ai-no-document">
            <FileImage size={24} aria-hidden="true" />
            <strong>尚未打开文档</strong>
            <div><button onClick={actions.openFile}><FolderOpen size={14} />打开文件</button><button onClick={actions.createCanvas}><Plus size={14} />新建画布</button></div>
          </div>
        )}
        {activeDocument && runs.length === 0 && !activeRun && !connection.canSend && (
          <div className="ai-empty-state ai-connect-state">
            <div className="ai-empty-symbol"><Plug size={22} aria-hidden="true" /></div>
            <div><h3>{connection.status === 'checking' ? '检查 AI 配置' : '未连接 AI'}</h3>
              <p role="status">{connection.detail}</p></div>
            <div className="ai-connect-actions">
              <button type="button" className="ai-connect-button" onClick={() => setIsSettingsOpen(true)}><Plug size={14} />连接 AI</button>
              <button type="button" className="ai-icon-button" aria-label="重新检查 AI 配置" title="重新检查 AI 配置" onClick={refreshConnection} disabled={connection.status === 'checking'}><RefreshCw size={14} /></button>
            </div>
          </div>
        )}
        {activeDocument && runs.length === 0 && !activeRun && connection.canSend && (
          <div className="ai-empty-state">
            <div className="ai-empty-symbol">
              <Bot className="w-5 h-5 text-blue-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-studio-200">你想怎样调整这张图？</p>
            </div>

            {/* Quick Suggestions */}
            <div className="ai-suggestions">
              <div className="ai-feed-heading">常用操作</div>
              {currentWorkspace === 'develop' ? (
                <>
                  <button
                    onClick={() => handleSendPrompt('Increase exposure by +0.5 EV')}
                    title="点击直接发送此指令"
                    className="ai-suggestion"
                  >
                    <span>曝光提高 +0.5 EV</span>
                    <SlidersHorizontal className="w-3 h-3 text-amber-400" />
                  </button>
                  <button
                    onClick={() => handleSendPrompt('Warm up white balance to 6200K')}
                    title="点击直接发送此指令"
                    className="ai-suggestion"
                  >
                    <span>白平衡调暖至 6200K</span>
                    <SlidersHorizontal className="w-3 h-3 text-amber-400" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleSendPrompt('Create text layer "Tokyo Studio" in cyan')}
                    title="点击直接发送此指令"
                    className="ai-suggestion"
                  >
                    <span>新建文字图层「Tokyo Studio」</span>
                    <Layers className="w-3 h-3 text-blue-400" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Completed Runs History */}
        {runs.length > 0 && <div className="ai-feed-heading">操作记录</div>}
        {[...runs].reverse().map((run) => <React.Fragment key={run.runId}>
          <ActionLogView
            run={run}
            onUndoRun={run.commandIds.length && defaultAgentRuntime.getRun(run.runId) ? handleUndoRun : undefined}
          />
          {run.status === 'awaiting_selection' && run.documentId === activeDocument?.id && defaultAgentRuntime.getCandidateSet(run.runId) &&
            <CreativeReview run={run} candidates={defaultAgentRuntime.getCandidateSet(run.runId)!}
              onChoose={id => defaultAgentRuntime.chooseCandidate(id)} onDiscard={() => defaultAgentRuntime.discardCandidateRun(run.runId)}
              preferences={defaultAgentRuntime.getTastePreferences()} />}
        </React.Fragment>)}

        {/* Active In-Progress Run */}
        {activeRun && (
          <section className="ai-active-run" aria-label="当前 AI 任务">
            <div className="flex items-center justify-between text-2xs">
              <div className="flex items-center space-x-2 text-blue-300 font-semibold">
                <LoaderCircle size={14} className="ai-running-icon" aria-hidden="true" />
                <span>正在执行</span>
              </div>
              <button
                onClick={handleCancelRun}
                title="停止当前运行"
                aria-label="停止当前运行"
                className="ai-icon-button ai-stop-button"
              >
                <StopCircle className="w-3 h-3" />
              </button>
            </div>

            {streamingText && (
              <div className="ai-streaming-text" aria-label="AI 回复">
                {streamingText}
              </div>
            )}

            <ActionLogView run={activeRun} />
          </section>
        )}

      </div>

      {/* Input Area */}
      <div className="ai-compose-area">
        <label className="ai-explore-toggle"><input type="checkbox" checked={explore} disabled={!!activeRun} onChange={event => setExplore(event.target.checked)} />比较两个创意方向</label>
        <div className="ai-compose-box">
          <textarea
            rows={3}
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !activeRun && activeDocument) {
                e.preventDefault();
                return handleSendPrompt();
              }
            }}
            disabled={!!activeRun || submitting || !activeDocument}
            aria-label="向 AI 助手描述你想做的修改"
            placeholder={activeDocument ? `描述你想在${currentWorkspace === 'develop' ? '照片调色' : '图像编辑'}工作区做的修改…` : '请先打开文件或新建画布'}
            className="ai-composer text-sm text-studio-100 outline-none placeholder:text-studio-400 disabled:opacity-50"
          />
          <div className="ai-compose-bottom"><span role="status">{activeRun ? '正在执行' : submitting ? '检查配置' : !activeDocument ? '等待文档' : connection.status === 'configured' ? '已配置' : connection.status === 'available' ? '本机 Agent 可用' : connection.label}</span>
            {activeRun ? (
              <button onClick={handleCancelRun} className="ai-send-button is-stop" title="停止当前运行" aria-label="停止当前运行"><StopCircle className="w-4 h-4" /></button>
            ) : (
              <button onClick={() => handleSendPrompt()} disabled={!promptInput.trim() || !activeDocument || submitting || !connection.canSend} className="ai-send-button" title={connection.canSend ? '发送指令' : '请先连接 AI'} aria-label="发送指令"><Send className="w-4 h-4" /></button>
            )}
          </div>
        </div>
        <div className="ai-compose-footnote text-2xs text-studio-500">
          <span role="status">{composerMessage}</span>
          <button
            onClick={handleUndoLastRun}
            title="撤销最近一次运行的改动"
            aria-label="撤销上一次 AI 运行"
            disabled={!!activeRun || submitting || !lastUndoableRun}
            className="ai-icon-button"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      <ProviderSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};
