import { describe, expect, it, vi } from 'vitest';
import { buildStudioActions, groupStudioSearchResults, searchStudioActions } from './studioActions';
import { createEditDocument } from '../document/EditDocument';

describe('studio actions', () => {
  it('searches real commands and documents and executes the same handler', () => {
    const doc = createEditDocument({ name: '海报草稿', width: 800, height: 600 });
    const openDocument = vi.fn();
    const openRecentProject = vi.fn();
    const saveProject = vi.fn();
    const actions = buildStudioActions([doc], [{ path: 'C:\\Work\\品牌.aistudio', name: '品牌', lastOpenedAt: 100 }], {
      openFile: vi.fn(), createCanvas: vi.fn(), openDocument, openRecentProject, saveProject,
      saveProjectAs: vi.fn(), exportImage: vi.fn(), closeActiveDocument: vi.fn(), closeDocument: vi.fn(),
    });
    const result = searchStudioActions(actions, '海报');
    expect(result.map(action => action.id)).toEqual([`document:${doc.id}`]);
    result[0].run();
    expect(openDocument).toHaveBeenCalledWith(doc.id);
    expect(searchStudioActions(actions, 'raw').map(action => action.id)).toEqual(['open-file']);
    expect(searchStudioActions(actions, '品牌').map(action => action.id)).toEqual(['recent:C:\\Work\\品牌.aistudio']);
    searchStudioActions(actions, '品牌')[0].run();
    expect(openRecentProject).toHaveBeenCalledWith('C:\\Work\\品牌.aistudio');
    expect(searchStudioActions(actions, '保存').map(action => action.id)).toEqual(['save-project']);
    searchStudioActions(actions, '保存')[0].run();
    expect(saveProject).toHaveBeenCalledOnce();
    expect(actions.map(action => action.id)).not.toContain('sample-raw');
  });
});

it('shows only useful entry commands without an open document and groups an empty search', () => {
  const handlers = {openFile:vi.fn(),createCanvas:vi.fn(),openDocument:vi.fn(),openRecentProject:vi.fn(),saveProject:vi.fn(),saveProjectAs:vi.fn(),exportImage:vi.fn(),closeActiveDocument:vi.fn(),closeDocument:vi.fn()};
  const empty = buildStudioActions([], [], handlers);
  expect(empty.map(action=>action.id)).toEqual(['open-file','create-canvas']);
  expect(groupStudioSearchResults(empty, '').map(group=>group.category)).toEqual(['操作']);
  const doc=createEditDocument({name:'海报',width:800,height:600});
  const grouped=groupStudioSearchResults(buildStudioActions([doc],[{path:'C:\\Work\\海报.aistudio',name:'海报',lastOpenedAt:1}],handlers),'');
  expect(grouped.map(group=>group.category)).toEqual(['操作','当前文档','最近项目']);
  expect(grouped.find(group=>group.category==='当前文档')?.actions[0].id).toBe(`document:${doc.id}`);
});
