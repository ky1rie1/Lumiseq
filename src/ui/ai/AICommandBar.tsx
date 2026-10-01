import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FileImage, Search, X } from 'lucide-react';
import { buildStudioActions, groupStudioSearchResults, StudioActionHandlers } from '../../app/studioActions';
import { useAppStore } from '../../stores/useAppStore';
import { useDocuments } from '../shared/useDocuments';
import { defaultRecentProjectsStore, type RecentProjectEntry } from '../../app/recentProjects';

/** Desktop quick search, anchored to the toolbar rather than a centered modal. */
export function AICommandBar({ actions }: { actions: StudioActionHandlers }) {
  const open = useAppStore(state => state.isCommandBarOpen);
  const setOpen = useAppStore(state => state.setCommandBarOpen);
  const { documents } = useDocuments();
  const [recent, setRecent] = useState<RecentProjectEntry[]>(() => defaultRecentProjectsStore.getAll());
  const [anchor, setAnchor] = useState({ top: 59, right: 66 });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const all = buildStudioActions(documents, recent, actions);
  const groups = groupStudioSearchResults(all, query);
  const results = groups.flatMap(group => group.actions);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!useAppStore.getState().isCommandBarOpen);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [setOpen]);

  useEffect(() => {
    return defaultRecentProjectsStore.subscribe(() => setRecent(defaultRecentProjectsStore.getAll()));
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    const updateAnchor = () => {
      const trigger = document.querySelector<HTMLElement>('.search-action');
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setAnchor({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right - 12) });
    };
    updateAnchor();
    window.addEventListener('resize', updateAnchor);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.removeEventListener('resize', updateAnchor);
  }, [open]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.search-action')?.focus());
  };
  const execute = (index: number) => {
    const action = results[index];
    if (!action) return;
    close();
    void action.run();
  };

  return <div className="quick-search-layer" onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="quick-search glass-surface" style={{ top: anchor.top, right: anchor.right }} role="dialog" aria-label="快速查找文档与命令" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(index => Math.min(index + 1, results.length - 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(0, index - 1)); }
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); execute(selected); }
    }}>
      <div className="quick-search-heading"><strong>快速查找</strong><span>打开文档或执行命令</span></div>
      <div className="quick-search-input"><Search size={18} /><input ref={inputRef} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} aria-label="查找文档或命令" placeholder="输入文档名或命令…" /><button type="button" onClick={close} aria-label="关闭查找"><X size={16} /></button></div>
      <div className="quick-search-results" role="listbox" aria-label="搜索结果">
        {groups.length ? groups.map(group => <div className="quick-search-group" key={group.category}><div className="quick-search-group-label">{group.category}</div>{group.actions.map(action => { const index = results.indexOf(action); return <button key={action.id} role="option" aria-selected={selected === index} className={selected === index ? 'is-selected' : ''} onMouseEnter={() => setSelected(index)} onClick={() => execute(index)}><span className="quick-search-result-icon"><FileImage size={16} /></span><span><strong>{action.label}</strong><small>{action.detail}</small></span><ArrowRight size={14} /></button>; })}</div>) : <p className="quick-search-empty">没有找到文档或命令</p>}
      </div>
      <footer className="quick-search-footer"><span>↑↓ 选择 · Enter 打开 · Esc 关闭</span><span>本地文档与操作</span></footer>
    </section>
  </div>;
}
