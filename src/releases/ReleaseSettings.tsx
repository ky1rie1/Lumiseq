import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { defaultReleaseCheckService as service } from './defaultReleaseCheckService';
import { boundedNotes, trustedReleasePage } from './releases';
import type { ReleaseSnapshot } from './ReleaseCheckService';
import './releaseSettings.css';

const messages: Record<ReleaseSnapshot['status'], string> = {
  idle: '尚未检查正式版本', checking: '正在查询正式版本…', update: '发现可用的新版本', current: '已核实当前正式版本', limited: '已检查 100 项，查询范围受限', noPackage: '查询范围内没有适用的 Windows x64 完整包', development: '当前是开发构建，版本号相同也不代表与正式包一致',
  ok: '查询完成', notModified: '缓存已重新核实', offline: '无法连接版本服务', timeout: '版本查询超时', rateLimited: '版本服务限流，请稍后检查', notFound: '正式版本仓库不可用', error: '版本服务暂时不可用', malformed: '版本服务返回格式无效', tooLarge: '版本服务响应超出大小限制', cancelled: '版本查询已取消', unsupported: '浏览器预览无法查询桌面版本服务',
};
function inlineText(text: string, onOpen: (url: string) => void): ReactNode[] {
  const nodes: ReactNode[] = []; const links = /(?<!!)\[([^\]\n]{1,256})\]\(([^\s)]+)\)/g; let offset = 0, match: RegExpExecArray | null;
  while ((match = links.exec(text))) { const url = match[2]; nodes.push(text.slice(offset, match.index)); nodes.push(trustedReleasePage(url) ? <button type="button" className="release-text-link" key={match.index} onClick={() => onOpen(url)}>{match[1]}<ExternalLink size={12} /></button> : match[0]); offset = links.lastIndex; }
  nodes.push(text.slice(offset)); return nodes;
}
export function ReleaseNotes({ notes, onOpen }: { notes: string; onOpen: (url: string) => void }) {
  return <div className="release-notes">{boundedNotes(notes).split(/\r?\n/).map((line, index) => {
    const heading = /^#{1,3}\s+(.+)$/.exec(line); const list = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (heading) return <h4 key={index}>{inlineText(heading[1], onOpen)}</h4>;
    if (list) return <ul key={index}><li>{inlineText(list[1], onOpen)}</li></ul>;
    return line ? <p key={index}>{inlineText(line, onOpen)}</p> : null;
  })}</div>;
}
export function ReleaseSettings() {
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const [notice, setNotice] = useState('');
  useEffect(() => { void service.initialize(); }, []);
  const open = (url: string) => { void service.openOfficialPage(url).catch(() => setNotice('无法打开官方下载页，请检查桌面宿主。')); };
  const date = (value: number) => new Date(value).toLocaleString();
  const releases = [state.current, state.latest?.version !== state.current?.version ? state.latest : null].filter(item => item !== null);
  return <section className="settings-group release-settings" aria-label="正式版本与更新说明"><h3>正式版本与更新说明</h3>
    {state.build && <p className="settings-help">{state.build.version} · {state.build.channel === 'stable' ? '正式构建' : '开发构建'} · {state.build.commit.slice(0, 12)}{state.build.dirty ? ' · 含本地修改' : ''}</p>}
    <label className="release-auto-check"><input type="checkbox" checked={state.autoCheck} onChange={event => service.setAutoCheck(event.target.checked)} />自动检查正式版本</label>
    <div className="settings-group-actions"><button type="button" disabled={state.status === 'checking' || state.retryAt > Date.now()} onClick={() => void service.check()}><RefreshCw size={14} />检查更新</button></div>
    <p role="status" className="settings-help">{messages[state.status]}</p>
    {state.verifiedAt > 0 && <p className="settings-help">上次成功核实：{date(state.verifiedAt)}{!['update', 'current', 'limited', 'noPackage', 'development'].includes(state.status) ? ' · 显示缓存结果' : ''}</p>}
    {state.retryAt > Date.now() && <p className="settings-help">可再次检查：{date(state.retryAt)}</p>}
    {releases.map(release => <div className="release-entry" key={release.version}><h4>{release.version === state.build?.version ? '当前版本说明' : '可下载正式版本'} · {release.version}</h4>
      {release.publishedAt && <p className="settings-help">发布时间：{new Date(release.publishedAt).toLocaleString()}</p>}
      <ReleaseNotes notes={release.notes} onOpen={open} />
      <div className="settings-group-actions"><button type="button" onClick={() => open(release.url)}><ExternalLink size={14} />官方下载页</button>
        {release.version === state.latest?.version && state.hint === 'update' && <><button type="button" onClick={() => service.snooze()}>稍后提醒</button><button type="button" onClick={() => service.ignore()}>忽略此版本</button></>}
        {release.version === state.current?.version && state.hint === 'notes' && <button type="button" onClick={() => service.markNotesRead()}>已阅读</button>}
      </div><p className="settings-help">{release.installer?.name ?? release.portable?.name}{release.installer && release.portable ? ` · ${release.portable.name}` : ''}</p>
    </div>)}
    {notice && <p className="settings-feedback" role="alert">{notice}</p>}
  </section>;
}
