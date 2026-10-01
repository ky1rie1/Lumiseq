import { useEffect, useState } from 'react';
import { ArrowUpRight, Clock3, FileImage, FilePlus, FolderOpen, Layers3, X } from 'lucide-react';
import { StudioActionHandlers } from '../../../app/studioActions';
import { defaultRecentProjectsStore, type RecentProjectEntry } from '../../../app/recentProjects';
import { useDocuments } from '../../shared/useDocuments';

type HomePage = 'recent' | 'session';

function useRecentProjects(): RecentProjectEntry[] {
  const [recent, setRecent] = useState(() => defaultRecentProjectsStore.getAll());
  useEffect(() => defaultRecentProjectsStore.subscribe(() => setRecent(defaultRecentProjectsStore.getAll())), []);
  return recent;
}

export function HomeWorkspace({ actions }: { actions: StudioActionHandlers }) {
  const [page, setPage] = useState<HomePage>('recent');
  const { documents } = useDocuments();
  const recent = useRecentProjects();
  const isRecent = page === 'recent';

  return <main className="home-workspace">
    <nav className="home-task-rail" aria-label="启动导航">
      <div className="home-rail-title">工作台</div>
      <div className="home-rail-group-label">文件</div>
      <button type="button" className={isRecent ? 'is-active' : ''} aria-current={isRecent ? 'page' : undefined} onClick={() => setPage('recent')}><Clock3 size={17} /><span>最近项目</span><small>{recent.length}</small></button>
      <button type="button" className={!isRecent ? 'is-active' : ''} aria-current={!isRecent ? 'page' : undefined} onClick={() => setPage('session')}><Layers3 size={17} /><span>当前会话</span><small>{documents.length}</small></button>
      <div className="home-rail-bottom"><span className="home-rail-status" />本地创作空间</div>
    </nav>
    <div className="home-hub">
      <header className="home-hub-header"><div className="home-hub-heading"><span className="home-hub-kicker">文件工作台</span><h1>{isRecent ? '最近项目' : '当前会话'}</h1><p>{isRecent ? '继续编辑已保存的工程，或打开一张照片。' : '返回正在处理的照片与画布。'}</p></div></header>
      <section className="home-file-actions" aria-label="开始编辑">
        <button type="button" className="home-file-action home-file-action-primary" onClick={actions.openFile}><FolderOpen size={20} /><span><strong>打开文件</strong><small>照片、RAW 或工程文件</small></span><ArrowUpRight size={16} /></button>
        <button type="button" className="home-file-action" onClick={actions.createCanvas}><FilePlus size={20} /><span><strong>新建画布</strong><small>设置尺寸与背景，开始图像编辑</small></span><ArrowUpRight size={16} /></button>
      </section>
      <div className="home-toolbar"><span>{isRecent ? `${recent.length} 个本地项目` : `${documents.length} 个已打开文档`}</span><span>{isRecent ? '按最近打开时间排列' : '当前工作会话'}</span></div>
      <section className="home-content-section" aria-live="polite">
        {isRecent ? (recent.length ? <div className="home-document-list">{recent.map(project => <div className="home-document-row" key={project.path}><button className="home-document-open" onClick={() => actions.openRecentProject(project.path)} title={project.path}><span className="home-document-icon"><FileImage size={19} /></span><span className="home-document-copy"><strong>{project.name}</strong><small>{project.path}</small></span><span className="home-document-date">{new Date(project.lastOpenedAt).toLocaleDateString('zh-CN')}</span><ArrowUpRight size={16} /></button><button className="home-document-remove" onClick={() => defaultRecentProjectsStore.remove(project.path)} aria-label={`从最近项目移除 ${project.name}`} title="从最近项目移除"><X size={14} /></button></div>)}</div> : <div className="home-empty-documents"><div className="home-empty-icon"><FileImage size={24} /></div><strong>最近项目为空</strong><p>从上方打开照片或新建画布。保存工程后，可在这里继续编辑。</p></div>)
          : (documents.length ? <div className="home-document-list">{documents.map(doc => <div className="home-document-row" key={doc.id}><button className="home-document-open" onClick={() => actions.openDocument(doc.id)}><span className="home-document-icon"><FileImage size={19} /></span><span className="home-document-copy"><strong>{doc.kind === 'edit' ? doc.name : doc.fileName}</strong><small>{doc.width} × {doc.height} px · {doc.kind === 'edit' ? '图像编辑' : '照片调色'}</small></span><span className="home-document-date">{doc.isDirty ? '已修改' : '已打开'}</span><ArrowUpRight size={16} /></button></div>)}</div> : <div className="home-empty-documents"><div className="home-empty-icon"><Layers3 size={24} /></div><strong>当前没有打开的文档</strong><p>从上方打开一个文件或新建画布，文档会保留在当前会话中。</p></div>)}
      </section>
      <footer className="home-workbench-footer"><span>支持拖入照片与工程文件</span><span>在线 AI 操作会按所选模型发送所需内容</span></footer>
    </div>
  </main>;
}
