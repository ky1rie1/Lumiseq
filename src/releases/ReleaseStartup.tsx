import { useEffect, useSyncExternalStore } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { defaultReleaseCheckService as service } from './defaultReleaseCheckService';
import './releaseSettings.css';
export function ReleaseStartup() {
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  useEffect(() => {
    let disposed = false;
    const check = () => { service.refreshHints(); void service.check(false); };
    const delayed = window.setTimeout(() => { void service.initialize().then(() => { if (!disposed) check(); }); }, 8000);
    const daily = window.setInterval(() => { if (!disposed) check(); }, 60_000);
    return () => { disposed = true; window.clearTimeout(delayed); window.clearInterval(daily); service.cancel(); };
  }, []);
  if (!state.hint) return null;
  return <aside className="release-startup" role="status"><span>{state.hint === 'notes' ? `${state.build?.version} 更新说明` : `正式版本 ${state.latest?.version} 可用`}</span>
    <button type="button" title="查看版本说明" aria-label="查看版本说明" onClick={() => window.dispatchEvent(new Event('lumiseq:open-release-settings'))}><ArrowUpRight size={17} /></button>
    <button type="button" title="关闭版本提示" aria-label="关闭版本提示" onClick={() => service.snooze()}><X size={16} /></button>
  </aside>;
}
