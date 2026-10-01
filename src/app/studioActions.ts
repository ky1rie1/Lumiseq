import { StudioDocument } from '../types/document';

export interface SearchableRecentProject { path: string; name: string; lastOpenedAt: number }

export interface StudioAction {
  id: string;
  label: string;
  detail: string;
  category: '操作' | '当前文档' | '最近项目';
  keywords: string;
  run: () => void | Promise<void>;
}

export interface StudioActionHandlers {
  openFile: () => void | Promise<void>;
  createCanvas: () => void;
  openDocument: (id: string) => void;
  openRecentProject: (path: string) => void | Promise<void>;
  saveProject: () => void | Promise<void>;
  saveProjectAs: () => void | Promise<void>;
  exportImage: () => void | Promise<void>;
  closeActiveDocument: () => void | Promise<void>;
  closeDocument: (id: string) => void | Promise<void>;
}

export function buildStudioActions(documents: StudioDocument[], recentProjects: SearchableRecentProject[], handlers: StudioActionHandlers): StudioAction[] {
  return [
    { id: 'open-file', label: '打开文件', detail: '照片、RAW 或项目', category: '操作', keywords: 'open file import 打开 导入', run: handlers.openFile },
    { id: 'create-canvas', label: '新建', detail: '选择画布尺寸、分辨率或打开照片', category: '操作', keywords: 'new create 新建 画布', run: handlers.createCanvas },
    ...(documents.length ? [
      { id: 'save-project', label: '保存', detail: '保存当前可编辑项目', category: '操作' as const, keywords: 'save project 保存 工程', run: handlers.saveProject },
      { id: 'save-project-as', label: '另存为', detail: '选择 PSD 或影序项目格式', category: '操作' as const, keywords: 'save as psd 另存 格式', run: handlers.saveProjectAs },
      { id: 'export-image', label: '导出成品', detail: 'JPEG 或 PNG · 品质与尺寸', category: '操作' as const, keywords: 'export jpeg png 导出 渲染 交付', run: handlers.exportImage },
    ] : []),
    ...recentProjects.map(project => ({
      id: `recent:${project.path}`,
      label: project.name,
      detail: project.path,
      category: '最近项目' as const,
      keywords: 'recent project 最近 项目 工程',
      run: () => handlers.openRecentProject(project.path),
    })),
    ...documents.map(doc => ({
      id: `document:${doc.id}`,
      label: doc.kind === 'edit' ? doc.name : doc.fileName,
      detail: `${doc.width} × ${doc.height} · ${doc.kind === 'edit' ? '图像编辑' : '照片调色'}`,
      category: '当前文档' as const,
      keywords: `${doc.kind} current 当前 文档`,
      run: () => handlers.openDocument(doc.id),
    })),
  ];
}

export function groupStudioSearchResults(actions: StudioAction[], query: string): { category: StudioAction['category']; actions: StudioAction[] }[] {
  const matching = searchStudioActions(actions, query);
  const empty = !query.trim();
  return (['操作', '当前文档', '最近项目'] as const)
    .map(category => ({ category, actions: matching.filter(action => action.category === category).slice(0, empty ? category === '操作' ? 5 : 4 : undefined) }))
    .filter(group => group.actions.length > 0);
}

export function searchStudioActions(actions: StudioAction[], query: string): StudioAction[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return actions;
  return actions.filter(action => {
    const haystack = `${action.label} ${action.detail} ${action.category} ${action.keywords}`.toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}
