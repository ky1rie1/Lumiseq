// src/ui/shared/DesktopErrorBoundary.tsx
//! Windows Desktop Crash Guard & Exception Boundary (Stage 7.3)
//! Catches unhandled React render errors, logs crash stacks to native storage,
//! and renders a desktop-grade recovery screen with options to reload, copy diagnostics, or open logs.

import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { getPlatformBridge } from '../../platform';
import { APP_NAME, APP_VERSION } from '../../core/brand';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copiedNotice: boolean;
  showStack: boolean;
}

export class DesktopErrorBoundary extends Component<Props, State> {
  private unhandledListener: ((e: PromiseRejectionEvent) => void) | null = null;
  private errorListener: ((e: ErrorEvent) => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copiedNotice: false,
      showStack: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidMount() {
    // Record background async unhandled promise rejections
    this.unhandledListener = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason);
      const log = `[UnhandledRejection] ${reason}`;
      void getPlatformBridge().writeDiagnosticLog('unhandled', log);
    };

    // Record background global errors
    this.errorListener = (e: ErrorEvent) => {
      const log = `[GlobalError] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}\nStack: ${e.error?.stack || 'N/A'}`;
      void getPlatformBridge().writeDiagnosticLog('unhandled', log);
    };

    window.addEventListener('unhandledrejection', this.unhandledListener);
    window.addEventListener('error', this.errorListener);
  }

  componentWillUnmount() {
    if (this.unhandledListener) {
      window.removeEventListener('unhandledrejection', this.unhandledListener);
    }
    if (this.errorListener) {
      window.removeEventListener('error', this.errorListener);
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });

    const report = [
      `=================== ${APP_NAME} CRASH REPORT ===================`,
      `Version: ${APP_VERSION}`,
      `Time: ${new Date().toISOString()}`,
      `Platform: ${getPlatformBridge().getPlatformInfo().platform}`,
      `Error: ${error.name}: ${error.message}`,
      `Stack:\n${error.stack || 'No stack trace available'}`,
      `Component Stack:\n${errorInfo.componentStack || 'No component stack'}`,
      `================================================================`,
    ].join('\n');

    void getPlatformBridge().writeDiagnosticLog('crash', report);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopyDiagnostics = async () => {
    const { error, errorInfo } = this.state;
    const text = [
      `# ${APP_NAME} 崩溃诊断报告`,
      `- 版本: ${APP_VERSION}`,
      `- 时间: ${new Date().toLocaleString()}`,
      `- 错误: ${error?.message || '未知错误'}`,
      `- 堆栈:`,
      '```',
      error?.stack || '无堆栈',
      '```',
      `- 组件层级:`,
      '```',
      errorInfo?.componentStack || '无层级',
      '```',
    ].join('\n');

    try {
      await getPlatformBridge().writeClipboardText(text);
      this.setState({ copiedNotice: true });
      setTimeout(() => this.setState({ copiedNotice: false }), 3000);
    } catch {
      // Ignore
    }
  };

  private handleOpenLogs = async () => {
    try {
      const paths = await getPlatformBridge().getAppPaths();
      await getPlatformBridge().revealPathInExplorer(paths.logsDir);
    } catch {
      // Ignore
    }
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, copiedNotice, showStack } = this.state;

      return (
        <div className="fixed inset-0 z-9999 flex flex-col items-center justify-center bg-studio-950 text-studio-100 p-8 select-none font-sans">
          <div className="max-w-xl w-full bg-studio-900 border border-studio-800 rounded-xl shadow-2xl p-6 flex flex-col space-y-5">
            {/* Header */}
            <div className="flex items-center space-x-3 text-amber-400">
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-studio-100">
                  {APP_NAME} 遇到意外异常
                </h1>
                <p className="text-xs text-studio-400 mt-0.5">
                  界面已处于保护状态以防止工程数据受损。自动恢复机制已保存近期状态。
                </p>
              </div>
            </div>

            {/* Error Message Box */}
            <div className="bg-studio-950/80 border border-studio-800/80 rounded-lg p-3.5 text-xs font-mono text-red-400 overflow-x-auto max-h-32">
              <div className="font-semibold text-studio-200">
                {error?.name || 'Error'}: {error?.message || '未知运行时错误'}
              </div>
            </div>

            {/* Expandable Stack Trace */}
            <div className="text-xs">
              <button
                type="button"
                onClick={() => this.setState(s => ({ showStack: !s.showStack }))}
                className="flex items-center space-x-1.5 text-studio-400 hover:text-studio-200 text-2xs cursor-pointer"
              >
                {showStack ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span>{showStack ? '隐藏详细调用栈' : '查看详细调用栈'}</span>
              </button>

              {showStack && (
                <div className="mt-2 p-3 bg-studio-950 border border-studio-800 rounded text-3xs font-mono text-studio-400 overflow-auto max-h-48 whitespace-pre leading-relaxed select-text">
                  {error?.stack}
                  {errorInfo?.componentStack}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-studio-800">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>重新载入界面</span>
                </button>

                <button
                  type="button"
                  onClick={this.handleCopyDiagnostics}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 text-studio-200 border border-studio-700 text-xs transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedNotice ? '已复制诊断' : '复制诊断信息'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={this.handleOpenLogs}
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-studio-400 hover:text-studio-200 hover:bg-studio-800 text-xs transition-colors cursor-pointer"
                title="在资源管理器中打开日志目录"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>日志目录</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
