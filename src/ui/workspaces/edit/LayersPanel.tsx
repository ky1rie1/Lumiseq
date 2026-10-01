import React, { useRef, useState } from 'react';
import { Type, Layers as LayersIcon, Eye, EyeOff, Plus, ArrowUp, ArrowDown, Trash2, Image as ImageIcon, Check, Sparkles, Brush, Sliders, ChevronRight, ChevronDown, Copy, Lock, Unlock, X } from 'lucide-react';
import { useEditStore } from '../../../stores/useEditStore';
import { AdjustmentType, BlendMode, EditDocument, Layer } from '../../../types/edit';
import { ADJUSTMENT_TYPE_LABELS, ALL_ADJUSTMENT_TYPES } from '../../../types/adjustmentLabels';
import { BLEND_MODE_LABELS, ALL_BLEND_MODES } from '../../../types/blendModeLabels';
import { flattenLayerTree } from '../../../document/EditDocument';
import { isLayerLocked, locateLayer } from '../../../edit/LayerTree';
import { defaultLayerOperationService } from '../../../edit/LayerOperationService';

interface LayersPanelProps {
  document: EditDocument;
  selectedLayer: Layer | null;
  selectedLayerId: string | null;
  newTextPrompt: string;
  onChangeNewTextPrompt: (value: string) => void;
  onAddImageLayer: () => void;
  onShowProperties: () => void;
}
const typeLabel = (layer: Layer) => layer.type === 'adjustment' ? ADJUSTMENT_TYPE_LABELS[layer.adjustmentType] : ({ group: '图层组', image: '图片', paint: '绘画', retouch: '修饰', text: '文字', 'smart-object': '智能对象', 'develop-smart-object': '调色智能对象', 'generated-patch': 'AI 修补', shape: '形状' }[layer.type]);
const typeIcon = (layer: Layer) => {
  const Icon = layer.type === 'group' ? LayersIcon : layer.type === 'text' ? Type : layer.type === 'paint' || layer.type === 'retouch' ? Brush : layer.type === 'adjustment' ? Sliders : layer.type.includes('smart') || layer.type === 'generated-patch' ? Sparkles : ImageIcon;
  return <Icon className="w-3.5 h-3.5 text-studio-300" />;
};
const EMPTY_IDS: string[] = [];

export const LayersPanel: React.FC<LayersPanelProps> = ({ document: doc, selectedLayer, selectedLayerId, newTextPrompt, onChangeNewTextPrompt, onAddImageLayer, onShowProperties }) => {
  const actions = useEditStore();
  const collapsed = actions.collapsedLayerIds[doc.id] ?? EMPTY_IDS;
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [showText, setShowText] = useState(false);
  const [error, setError] = useState('');
  const locked = selectedLayer ? isLayerLocked(doc, selectedLayer.id) : false;
  const run = (operation: () => unknown) => {
    setError('');
    try { void Promise.resolve(operation()).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const visible: Layer[] = [];
  const collect = (layers: Layer[]) => [...layers].reverse().forEach(layer => {
    visible.push(layer); if (layer.type === 'group' && !collapsed.includes(layer.id)) collect(layer.children);
  });
  collect(doc.layers);
  const select = (id: string) => { actions.selectLayer(id); refs.current.get(id)?.focus(); };
  const rename = (layer: Layer) => { if (!isLayerLocked(doc, layer.id)) { setEditingId(layer.id); setName(layer.name); } };
  const finishRename = (layer: Layer) => run(() => { actions.renameLayer(doc.id, layer.id, name.trim() || layer.name); setEditingId(null); });
  const toggle = (id: string) => {
    if (!collapsed.includes(id) && selectedLayerId && locateLayer(doc.layers, selectedLayerId)?.ancestors.some(parent => parent.id === id)) select(id);
    actions.toggleLayerExpanded(doc.id, id);
  };
  const onTreeKey = (event: React.KeyboardEvent<HTMLDivElement>, layer: Layer) => {
    if (event.target !== event.currentTarget || editingId) return;
    const index = visible.findIndex(item => item.id === layer.id);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'F2', 'Enter', ' '].includes(event.key)) event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowDown' && visible[index + 1]) select(visible[index + 1].id);
    if (event.key === 'ArrowUp' && visible[index - 1]) select(visible[index - 1].id);
    if (event.key === 'Home' && visible[0]) select(visible[0].id);
    if (event.key === 'End' && visible.length) select(visible[visible.length - 1].id);
    if (event.key === 'ArrowRight' && layer.type === 'group') {
      if (collapsed.includes(layer.id)) toggle(layer.id);
      else if (visible[index + 1] && layer.children.length) select(visible[index + 1].id);
    }
    if (event.key === 'ArrowLeft') {
      if (layer.type === 'group' && !collapsed.includes(layer.id)) toggle(layer.id);
      else { const parent = locateLayer(doc.layers, layer.id)?.parent; if (parent) select(parent.id); }
    }
    if (event.key === 'F2') rename(layer);
    if (event.key === 'Enter' || event.key === ' ') select(layer.id);
  };
  const rows = (layers: Layer[], level = 1): React.ReactNode => [...layers].reverse().map(layer => {
    const selected = layer.id === selectedLayerId;
    const location = locateLayer(doc.layers, layer.id)!;
    const inherited = location.ancestors.some(parent => parent.locked);
    const contentLocked = isLayerLocked(doc, layer.id);
    const expanded = layer.type === 'group' && !collapsed.includes(layer.id);
    const label = `图层 ${layer.name}（${typeLabel(layer)}）`;
    return <div key={layer.id} role="treeitem" aria-label={label} aria-selected={selected} aria-level={level} aria-expanded={layer.type === 'group' ? expanded : undefined}
      tabIndex={selected || (!selectedLayerId && visible[0]?.id === layer.id) ? 0 : -1}
      ref={element => { if (element) refs.current.set(layer.id, element); else refs.current.delete(layer.id); }}
      onKeyDown={event => onTreeKey(event, layer)}>
      <div className={`layer-row ${selected ? 'is-selected' : ''}`} style={{ paddingLeft: 4 + (level - 1) * 14 }}>
        {layer.type === 'group' ? <button type="button" className="icon-button" title={expanded ? '收起图层组' : '展开图层组'} aria-label={`${expanded ? '收起' : '展开'} ${layer.name}`} onClick={() => toggle(layer.id)}>{expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</button> : <span className="w-5 shrink-0" />}
        <button type="button" className={`icon-button ${layer.visible ? '' : 'opacity-50'}`} aria-label={`${layer.visible ? '隐藏' : '显示'} ${layer.name}`} title={layer.visible ? '隐藏图层' : '显示图层'} onClick={() => run(() => actions.toggleLayerVisibility(doc.id, layer.id))}>{layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}</button>
        <span className="layer-thumbnail">{typeIcon(layer)}</span>
        {editingId === layer.id ? <div className="layer-row-title flex items-center gap-1">
          <input autoFocus value={name} aria-label="图层名称" className="min-w-0 w-full bg-studio-950 border border-studio-500 rounded px-1 text-2xs" onChange={event => setName(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') finishRename(layer); if (event.key === 'Escape') setEditingId(null); }} />
          <button type="button" className="icon-button" aria-label="确认重命名" title="确认重命名" onClick={() => finishRename(layer)}><Check className="w-3 h-3" /></button>
        </div> : <button type="button" className="layer-row-title text-left min-w-0" onClick={() => select(layer.id)} onDoubleClick={() => rename(layer)} title="选中图层 · F2 或双击重命名"><span>{layer.name}</span><small>{typeLabel(layer)}</small></button>}
        {layer.mask && <button type="button" disabled={contentLocked} className="icon-button text-2xs" aria-label={`${layer.mask.enabled ? '停用' : '启用'} ${layer.name} 蒙版`} title="切换图层蒙版" onClick={() => run(() => actions.toggleLayerMask(doc.id, layer.id))}>M</button>}
        <button type="button" disabled={inherited} className="icon-button" aria-label={`${layer.locked ? '解锁' : '锁定'} ${layer.name}`} title={inherited ? '父图层组已锁定' : layer.locked ? '解锁图层' : '锁定图层'} onClick={() => run(() => defaultLayerOperationService.setLocked(doc.id, layer.id, !layer.locked))}>{layer.locked || inherited ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3 opacity-40" />}</button>
      </div>
      {layer.type === 'group' && expanded && <div role="group">{rows(layer.children, level + 1)}</div>}
    </div>;
  });
  const create = (value: string) => run(() => {
    if (value === 'paint') return actions.addPaintLayer(doc.id);
    if (value === 'image') return onAddImageLayer();
    if (value === 'text') { setShowText(true); return; }
    if (value === 'group') return actions.createGroup(doc.id, '图层组', selectedLayerId ? [selectedLayerId] : []);
    if (value.startsWith('adjustment:')) { actions.addAdjustmentLayer(doc.id, value.slice(11) as AdjustmentType); onShowProperties(); }
  });
  const selectedLocation = selectedLayer ? locateLayer(doc.layers, selectedLayer.id) : null;
  return <div className="flex-1 min-h-0 flex flex-col">
    <div className="p-3 border-b border-studio-800 space-y-3">
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-1.5 font-semibold text-studio-200"><LayersIcon className="w-4 h-4 text-studio-300" /><span>图层 ({flattenLayerTree(doc.layers).length})</span></div>
        <select aria-label="新建图层" title="新建图层" value="" className="bg-studio-800 border border-studio-700 rounded px-2 py-1 text-2xs" onChange={event => create(event.target.value)}>
          <option value="" disabled>＋ 新建图层</option><option value="paint">绘画图层</option><option value="image">置入图片</option><option value="text">文字图层</option><option value="group" disabled={locked}>图层组</option>
          <optgroup label="调整图层">{ALL_ADJUSTMENT_TYPES.map(type => <option key={type} value={`adjustment:${type}`}>{ADJUSTMENT_TYPE_LABELS[type]}</option>)}</optgroup>
        </select>
      </div>
      {showText && <div className="flex gap-1"><input autoFocus aria-label="新建文字图层的文字内容" placeholder="文字内容…" value={newTextPrompt} onChange={event => onChangeNewTextPrompt(event.target.value)} className="min-w-0 flex-1 bg-studio-950 border border-studio-700 rounded px-2 text-2xs" /><button type="button" className="icon-button" aria-label="创建文字图层" title="创建文字图层" onClick={() => run(() => { actions.addTextLayer(doc.id, newTextPrompt); setShowText(false); })}><Plus className="w-4 h-4" /></button><button type="button" className="icon-button" aria-label="取消新建文字" onClick={() => setShowText(false)}><X className="w-3 h-3" /></button></div>}
      {selectedLayer && <fieldset disabled={locked} className="space-y-2"><div className="grid grid-cols-2 gap-2"><label className="text-2xs text-studio-400">混合模式<select aria-label="图层混合模式" value={selectedLayer.blendMode} onChange={event => run(() => actions.setLayerBlendMode(doc.id, selectedLayer.id, event.target.value as BlendMode))} className="w-full bg-studio-950 border border-studio-700 rounded px-1 py-1">{ALL_BLEND_MODES.map(mode => <option key={mode} value={mode}>{BLEND_MODE_LABELS[mode]}</option>)}</select></label><label className="text-2xs text-studio-400">不透明度 {Math.round(selectedLayer.opacity * 100)}%<input type="range" aria-label="图层不透明度" min="0" max="1" step="0.01" value={selectedLayer.opacity} onPointerDown={() => run(() => actions.startOpacityDrag(doc.id))} onChange={event => run(() => actions.previewOpacityDrag(doc.id, selectedLayer.id, Number(event.target.value)))} onPointerUp={() => actions.commitOpacityDrag()} onPointerCancel={() => actions.commitOpacityDrag()} className="w-full" /></label></div></fieldset>}
      {locked && <p className="text-2xs text-studio-400">图层或父组已锁定，请先解锁以修改。</p>}
      {error && <p role="alert" className="text-2xs text-red-300">{error}</p>}
    </div>
    <div className="layer-list" role="tree" aria-label="图层树">{doc.layers.length ? rows(doc.layers) : <div className="layer-empty">用「新建图层」添加绘画、文字或图片。</div>}</div>
    <div className="flex items-center gap-1 p-2 border-t border-studio-800">
      <button type="button" disabled={!selectedLayer || !!selectedLocation?.ancestors.some(layer => layer.locked)} className="icon-button" aria-label="复制所选图层" title="复制所选图层" onClick={() => selectedLayer && run(() => defaultLayerOperationService.duplicate(doc.id, selectedLayer.id))}><Copy className="w-4 h-4" /></button>
      <button type="button" disabled={!selectedLayer || locked || selectedLocation?.index === (selectedLocation?.siblings.length ?? 0) - 1} className="icon-button" aria-label="上移所选图层" title="上移所选图层" onClick={() => selectedLocation && run(() => actions.moveLayerOrder(doc.id, selectedLayer!.id, selectedLocation.index + 1))}><ArrowUp className="w-4 h-4" /></button>
      <button type="button" disabled={!selectedLayer || locked || selectedLocation?.index === 0} className="icon-button" aria-label="下移所选图层" title="下移所选图层" onClick={() => selectedLocation && run(() => actions.moveLayerOrder(doc.id, selectedLayer!.id, selectedLocation.index - 1))}><ArrowDown className="w-4 h-4" /></button>
      <button type="button" disabled={!selectedLayer || locked} className="icon-button" aria-label="从选区创建蒙版" title="从选区创建蒙版" onClick={() => selectedLayer && run(() => actions.createMaskFromSelection(doc.id, selectedLayer.id))}><Sliders className="w-4 h-4" /></button>
      {selectedLayer?.mask && <><button type="button" disabled={locked} className="icon-button text-2xs" aria-label="反转图层蒙版" title="反转图层蒙版" onClick={() => run(() => actions.invertLayerMask(doc.id, selectedLayer.id))}>±M</button><button type="button" disabled={locked} className="icon-button text-2xs" aria-label="删除图层蒙版" title="删除图层蒙版" onClick={() => run(() => actions.removeLayerMask(doc.id, selectedLayer.id))}>×M</button></>}
      <button type="button" disabled={!selectedLayer || locked} className="icon-button ml-auto" aria-label="删除所选图层" title="删除所选图层" onClick={() => selectedLayer && run(() => actions.deleteLayer(doc.id, selectedLayer.id))}><Trash2 className="w-4 h-4" /></button>
    </div>
  </div>;
};
