import { describe, expect, it } from 'vitest';
import { EDIT_TOOL_GROUPS, findToolByShortcut, getGroupPrimary } from './editTools';
import { constrainDragRect, resolveSelectionMode, canClosePolygon } from './toolGestures';

describe('Edit tool registry', () => {
  it('offers only actual selectable canvas tools and resolves the last used group tool', () => {
    expect(EDIT_TOOL_GROUPS.flatMap(group => group.tools)).toContain('select-polygon');
    expect(EDIT_TOOL_GROUPS.flatMap(group => group.tools)).not.toContain('magic-wand');
    expect(getGroupPrimary('selection', { selection: 'select-ellipse' })).toBe('select-ellipse');
    expect(getGroupPrimary('selection', {})).toBe('select-rect');
  });

  it('uses the same shortcut lookup for variants as the toolbar', () => {
    expect(findToolByShortcut('m', 'move', { selection: 'select-ellipse' })).toBe('select-ellipse');
    expect(findToolByShortcut('l', 'move', { selection: 'select-polygon' })).toBe('select-polygon');
    expect(findToolByShortcut('w', 'move', {})).toBe('select-object');
    expect(findToolByShortcut('v', 'crop', {})).toBe('move');
  });
});

describe('selection and crop gestures', () => {
  it('applies temporary selection modifiers without replacing the configured mode', () => {
    expect(resolveSelectionMode('replace', true, false)).toBe('add');
    expect(resolveSelectionMode('replace', false, true)).toBe('subtract');
    expect(resolveSelectionMode('replace', true, true)).toBe('intersect');
    expect(resolveSelectionMode('subtract', false, false)).toBe('subtract');
  });

  it('constrains crop to ratio and document bounds in all drag directions', () => {
    expect(constrainDragRect({ x: 10, y: 10 }, { x: 50, y: 35 }, 1, 100, 100))
      .toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(constrainDragRect({ x: 90, y: 90 }, { x: 40, y: 70 }, 2, 100, 100))
      .toEqual({ x: 40, y: 65, width: 50, height: 25 });
  });

  it('rejects polygon completion with fewer than three distinct nodes', () => {
    expect(canClosePolygon([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 1 }])).toBe(false);
    expect(canClosePolygon([{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }])).toBe(true);
  });
});
