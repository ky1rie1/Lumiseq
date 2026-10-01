import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Move, Square, Circle, LassoSelect, PenLine, ScanSearch, Crop, Pipette, Bandage, Stamp, Brush, Blend, Type, Hand, ZoomIn, ArrowRightLeft } from 'lucide-react';
import { defaultColorState, ColorState } from '../../../color/colorState';
import { ColorPickerModal } from './ColorPickerModal';
import { EDIT_TOOL_GROUPS, EditTool, EditToolGroupId, LastUsedTools, getGroupPrimary, toolDefinition } from './editTools';

const icons: Record<EditTool, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  move: Move, 'select-rect': Square, 'select-ellipse': Circle, 'select-lasso': LassoSelect,
  'select-polygon': PenLine, 'select-object': ScanSearch, crop: Crop, eyedropper: Pipette,
  'spot-heal': Bandage, 'clone-stamp': Stamp, brush: Brush, gradient: Blend,
  text: Type, hand: Hand, zoom: ZoomIn,
};

interface ToolbarProps {
  activeTool: EditTool;
  lastUsedTools: LastUsedTools;
  onSelectTool: (tool: EditTool) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ activeTool, lastUsedTools, onSelectTool }) => {
  const [colors, setColors] = useState<ColorState>(defaultColorState.getState());
  const [pickerTarget, setPickerTarget] = useState<'foreground' | 'background' | null>(null);
  const [flyout, setFlyout] = useState<{ group: EditToolGroupId; x: number; y: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTriggered = useRef(false);

  useEffect(() => defaultColorState.subscribe(setColors), []);
  useEffect(() => {
    if (!flyout) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('[data-tool-flyout]')) setFlyout(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [flyout]);
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  const openFlyout = (group: EditToolGroupId, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setFlyout({ group, x: rect.right + 6, y: Math.min(rect.top, window.innerHeight - 215) });
  };

  return (
    <div className="editor-tools flex flex-col items-center py-2 select-none z-20" role="toolbar" aria-label="编辑工具">
      <div className="flex-1 w-full">
        {EDIT_TOOL_GROUPS.map((group) => {
          const primary = getGroupPrimary(group.id, lastUsedTools);
          const active = group.tools.includes(activeTool);
          const displayTool = active ? activeTool : primary;
          const definition = toolDefinition(displayTool);
          const Icon = icons[displayTool];
          const hasFlyout = group.tools.length > 1;
          return (
            <button
              key={group.id} type="button" onClick={() => { if (holdTriggered.current) { holdTriggered.current = false; return; } onSelectTool(primary); }}
              onContextMenu={(event) => { if (hasFlyout) { event.preventDefault(); openFlyout(group.id, event.currentTarget); } }}
              onPointerDown={(event) => {
                if (!hasFlyout || event.button !== 0) return;
                const element = event.currentTarget;
                holdTriggered.current = false;
                holdTimer.current = setTimeout(() => { holdTriggered.current = true; openFlyout(group.id, element); }, 460);
              }}
              onPointerUp={() => { if (holdTimer.current) clearTimeout(holdTimer.current); }}
              onPointerLeave={() => { if (holdTimer.current) clearTimeout(holdTimer.current); }}
              aria-pressed={active}
              aria-label={`${definition.label} (${definition.shortcut})${hasFlyout ? '；右键或长按展开工具组' : ''}`}
              title={`${definition.label} (${definition.shortcut})${hasFlyout ? ' · 右键/长按展开' : ''}`}
              className={`relative w-9 h-9 mx-auto flex items-center justify-center rounded-lg border border-transparent transition-colors ${active ? 'text-white' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              {hasFlyout && <span aria-hidden="true" className="absolute right-[3px] bottom-[3px] w-0 h-0 border-l-[4px] border-l-transparent border-b-[4px] border-b-current" />}
            </button>
          );
        })}
      </div>

      <div className="pt-2 border-t border-white/10 w-full flex flex-col items-center gap-1.5 pb-2">
        <div className="flex items-center justify-between w-8 px-0.5">
          <button onClick={() => defaultColorState.resetColors()} aria-label="默认前景色与背景色" title="默认前景色与背景色 (D)" className="text-white/40 hover:text-white transition-colors">
            <div className="w-2.5 h-2.5 bg-black border border-white/40 relative"><div className="w-1.5 h-1.5 bg-white absolute -bottom-0.5 -right-0.5 border border-black/40" /></div>
          </button>
          <button onClick={() => defaultColorState.swapColors()} aria-label="交换前景色与背景色" title="交换前景色与背景色 (X)" className="text-white/40 hover:text-white transition-colors"><ArrowRightLeft size={12} strokeWidth={1.8} /></button>
        </div>
        <div className="relative w-8 h-8">
          <button type="button" onClick={() => setPickerTarget('background')} aria-label={`背景色，当前 ${colors.background}，打开取色器`} title={`背景色：${colors.background}`} className="absolute right-0 bottom-0 w-5 h-5 rounded border border-white/20" style={{ backgroundColor: colors.background }} />
          <button type="button" onClick={() => setPickerTarget('foreground')} aria-label={`前景色，当前 ${colors.foreground}，打开取色器`} title={`前景色：${colors.foreground}`} className="absolute left-0 top-0 w-5 h-5 rounded border border-white/40 z-10" style={{ backgroundColor: colors.foreground }} />
        </div>
      </div>

      {flyout && createPortal(
        <div data-tool-flyout role="menu" aria-label="工具组" className="fixed z-[100] min-w-44 rounded-lg border border-white/20 bg-[#252c35] p-1 shadow-xl" style={{ left: flyout.x, top: Math.max(8, flyout.y) }}>
          {EDIT_TOOL_GROUPS.find(group => group.id === flyout.group)!.tools.map((tool) => {
            const Icon = icons[tool];
            const definition = toolDefinition(tool);
            return <button key={tool} type="button" role="menuitemradio" aria-checked={activeTool === tool} onClick={() => { onSelectTool(tool); setFlyout(null); }} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-white/10 ${activeTool === tool ? 'bg-[#9dbfe52e] text-[#d3e4ff]' : 'text-white/75'}`}>
              <Icon size={16} strokeWidth={1.8} /><span className="flex-1">{definition.label}</span><kbd className="text-white/40">{definition.shortcut}</kbd>
            </button>;
          })}
        </div>, document.body)}
      {pickerTarget && <ColorPickerModal isOpen target={pickerTarget} onClose={() => setPickerTarget(null)} />}
    </div>
  );
};
