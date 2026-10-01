import { Children, isValidElement, useRef, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { DEVELOP_GROUPS, nextDevelopGroup, visibleDevelopSections, type DevelopGroup } from './developTools';

/** View-only organization: existing section components and operation handlers remain mounted. */
export function DevelopToolBrowser({ children, group, setGroup, query, setQuery }: {
  children: ReactNode; group: DevelopGroup; setGroup: (group: DevelopGroup) => void;
  query: string; setQuery: (query: string) => void;
}) {
  const tabRefs = useRef(new Map<DevelopGroup, HTMLButtonElement>());
  const visible = visibleDevelopSections(group, query);
  return <div className="develop-tool-browser">
    <div className="develop-tool-navigation">
      <div className="develop-tool-groups" role="tablist" aria-label="调色工具分组">
        {DEVELOP_GROUPS.map(item => <button key={item.id} type="button" role="tab"
          id={`develop-tab-${item.id}`} aria-controls="develop-tool-results" aria-selected={item.id === group}
          tabIndex={item.id === group ? 0 : -1}
          ref={element => { if (element) tabRefs.current.set(item.id, element); else tabRefs.current.delete(item.id); }}
          onClick={() => { setGroup(item.id); setQuery(''); }} onKeyDown={event => {
            const next = nextDevelopGroup(group, event.key);
            if (next) { event.preventDefault(); event.stopPropagation(); setGroup(next); setQuery(''); tabRefs.current.get(next)?.focus(); }
          }}>{item.label}</button>)}
      </div>
      <div className="develop-tool-search"><Search size={13} aria-hidden="true" />
        <input aria-label="搜索调色工具" placeholder="查找工具或参数…" value={query} onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" aria-label="清除工具搜索" onClick={() => setQuery('')}><X size={13}/></button>}
      </div>
    </div>
    <div id="develop-tool-results" role="tabpanel" aria-labelledby={`develop-tab-${group}`} className="develop-tool-results">
      {query && <p className="develop-search-summary" role="status">全部工具 · {visible.length} 个匹配模块</p>}
      {!visible.length && <p className="develop-search-empty">未找到对应工具。试试“曝光”“去雾”或“降噪”。</p>}
      {Children.toArray(children).map(child => {
        if (!isValidElement<{id?:string}>(child)) return child;
        const id = child.props.id;
        return <div key={child.key ?? id} className="develop-tool-section" hidden={!!id && !visible.includes(id)}>{child}</div>;
      })}
    </div>
  </div>;
}
