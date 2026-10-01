export type EditTool =
  | 'move' | 'select-rect' | 'select-ellipse' | 'select-lasso' | 'select-polygon' | 'select-object'
  | 'crop' | 'eyedropper' | 'spot-heal' | 'clone-stamp' | 'brush' | 'gradient'
  | 'text' | 'hand' | 'zoom';

export type EditToolGroupId = 'move' | 'selection' | 'crop' | 'retouch' | 'paint' | 'color' | 'text' | 'navigation';

export interface EditToolDefinition {
  id: EditTool;
  label: string;
  shortcut: string;
  group: EditToolGroupId;
}

export const EDIT_TOOLS: readonly EditToolDefinition[] = [
  { id: 'move', label: '移动工具', shortcut: 'V', group: 'move' },
  { id: 'select-rect', label: '矩形选框', shortcut: 'M', group: 'selection' },
  { id: 'select-ellipse', label: '椭圆选框', shortcut: 'M', group: 'selection' },
  { id: 'select-lasso', label: '自由套索', shortcut: 'L', group: 'selection' },
  { id: 'select-polygon', label: '多边形套索', shortcut: 'L', group: 'selection' },
  { id: 'select-object', label: '对象选择', shortcut: 'W', group: 'selection' },
  { id: 'crop', label: '裁剪工具', shortcut: 'C', group: 'crop' },
  { id: 'spot-heal', label: '污点修复', shortcut: 'J', group: 'retouch' },
  { id: 'clone-stamp', label: '仿制图章', shortcut: 'S', group: 'retouch' },
  { id: 'brush', label: '画笔工具', shortcut: 'B', group: 'paint' },
  { id: 'gradient', label: '渐变工具', shortcut: 'G', group: 'paint' },
  { id: 'eyedropper', label: '吸管取色', shortcut: 'I', group: 'color' },
  { id: 'text', label: '文字工具', shortcut: 'T', group: 'text' },
  { id: 'hand', label: '抓手工具', shortcut: 'H', group: 'navigation' },
  { id: 'zoom', label: '缩放工具', shortcut: 'Z', group: 'navigation' },
] as const;

export const EDIT_TOOL_GROUPS: readonly { id: EditToolGroupId; tools: readonly EditTool[] }[] = [
  { id: 'move', tools: ['move'] },
  { id: 'selection', tools: ['select-rect', 'select-ellipse', 'select-lasso', 'select-polygon', 'select-object'] },
  { id: 'crop', tools: ['crop'] },
  { id: 'retouch', tools: ['spot-heal', 'clone-stamp'] },
  { id: 'paint', tools: ['brush', 'gradient'] },
  { id: 'color', tools: ['eyedropper'] },
  { id: 'text', tools: ['text'] },
  { id: 'navigation', tools: ['hand', 'zoom'] },
] as const;

export type LastUsedTools = Partial<Record<EditToolGroupId, EditTool>>;

export function getGroupPrimary(groupId: EditToolGroupId, lastUsed: LastUsedTools): EditTool {
  const group = EDIT_TOOL_GROUPS.find(item => item.id === groupId)!;
  const candidate = lastUsed[groupId];
  return candidate && group.tools.includes(candidate) ? candidate : group.tools[0];
}

export function findToolByShortcut(key: string, current: EditTool, lastUsed: LastUsedTools): EditTool | null {
  const matches = EDIT_TOOLS.filter(tool => tool.shortcut.toLowerCase() === key.toLowerCase());
  if (!matches.length) return null;
  const groupId = matches[0].group;
  const candidate = lastUsed[groupId];
  if (candidate && matches.some(tool => tool.id === candidate)) return candidate;
  if (matches.length > 1 && matches.some(tool => tool.id === current)) return current;
  return matches[0].id;
}

export function toolDefinition(id: EditTool): EditToolDefinition {
  return EDIT_TOOLS.find(tool => tool.id === id)!;
}
