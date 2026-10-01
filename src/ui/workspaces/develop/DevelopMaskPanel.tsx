import React from 'react';
import { Brush, CircleDashed, Eye, EyeOff, Plus, RotateCcw, Trash2, VenetianMask } from 'lucide-react';
import { defaultDevelopOperations, MaskParameterChange } from '../../../develop/DevelopOperationService';
import { DevelopMask } from '../../../types/develop';
import { ScrubbableInput } from '../../shared/ScrubbableInput';
import { PARAM_DEFINITIONS, ParameterDefinition } from '../../shared/parameterDefinitions';

type LocalParameter = MaskParameterChange['parameterId'];
const localParameters: Array<{ id: LocalParameter; definition: ParameterDefinition }> = [
  { id: 'exposure', definition: PARAM_DEFINITIONS.exposure },
  { id: 'contrast', definition: PARAM_DEFINITIONS.contrast },
  { id: 'highlights', definition: PARAM_DEFINITIONS.highlights },
  { id: 'shadows', definition: PARAM_DEFINITIONS.shadows },
  { id: 'temperature', definition: { ...PARAM_DEFINITIONS.temperature, label: '局部色温', min: -100, max: 100, defaultValue: 0, unit: undefined, formatter: (value) => `${value > 0 ? '+' : ''}${Math.round(value)}` } },
  { id: 'saturation', definition: PARAM_DEFINITIONS.saturation },
];

const kindName: Record<DevelopMask['kind'], string> = { linear: '线性渐变', radial: '径向渐变', brush: '调整画笔' };

interface Props {
  documentId: string;
  masks: DevelopMask[];
  selectedMaskId: string | null;
  onSelectMask: (id: string | null) => void;
  onBeginDraw: (kind: DevelopMask['kind'], replace: boolean) => void;
  showOverlay: boolean;
  onToggleOverlay: () => void;
  onError: (message: string) => void;
}

export const DevelopMaskPanel: React.FC<Props> = ({
  documentId, masks, selectedMaskId, onSelectMask, onBeginDraw, showOverlay, onToggleOverlay, onError,
}) => {
  const selected = masks.find((mask) => mask.id === selectedMaskId) ?? null;

  const updateMask = (patch: Parameters<typeof defaultDevelopOperations.updateMask>[2]) => {
    if (!selected) return;
    void defaultDevelopOperations.updateMask(documentId, selected.id, patch, 'manual').catch((error) => onError(String(error)));
  };

  const setParameter = (id: LocalParameter, value: number) => {
    if (!selected) return;
    try {
      defaultDevelopOperations.previewMaskParameterChange({ documentId, maskId: selected.id, parameterId: id, value, source: 'manual' });
    } catch (error) {
      onError(String(error));
    }
  };

  return (
    <div className="space-y-3 pb-2">
      <div className="grid grid-cols-3 gap-1.5">
        <button className="studio-mask-tool" onClick={() => onBeginDraw('linear', false)} title="在照片上拖动绘制线性渐变"><Plus size={13} />线性渐变</button>
        <button className="studio-mask-tool" onClick={() => onBeginDraw('radial', false)} title="在照片上拖动绘制径向渐变"><CircleDashed size={13} />径向渐变</button>
        <button className="studio-mask-tool" onClick={() => onBeginDraw('brush', false)} title="在照片上绘制画笔蒙版"><Brush size={13} />调整画笔</button>
      </div>
      {masks.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-studio-400">选择一种蒙版工具，再在照片上拖动绘制。局部调整只作用于蒙版覆盖区域。</p>
      ) : (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {masks.map((mask) => (
            <button
              key={mask.id}
              className={`w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] border transition-colors ${selected?.id === mask.id ? 'bg-sky-400/15 border-sky-400/50 text-sky-100' : 'bg-studio-850 border-studio-700 text-studio-300 hover:border-studio-500'}`}
              onClick={() => onSelectMask(mask.id)}
            >
              <VenetianMask size={14} className="shrink-0" />
              <span className="truncate flex-1">{mask.name}</span>
              <span className="text-studio-500">{kindName[mask.kind]}</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="space-y-2.5 border-t border-studio-700 pt-2.5">
          <div className="flex items-center gap-1.5">
            <button className="studio-mask-tool flex-1" onClick={onToggleOverlay} title="显示或隐藏红色蒙版覆盖层">{showOverlay ? <Eye size={13} /> : <EyeOff size={13} />}{showOverlay ? '隐藏叠加' : '显示叠加'}</button>
            <button className="studio-mask-tool flex-1" onClick={() => onBeginDraw(selected.kind, true)} title="在图像上重画当前蒙版"><RotateCcw size={13} />重画</button>
            <button className="studio-mask-tool text-red-300" onClick={() => { defaultDevelopOperations.deleteMask(documentId, selected.id, 'manual'); onSelectMask(null); }} title="删除蒙版"><Trash2 size={13} /></button>
          </div>
          <label className="flex items-center justify-between gap-2 text-[11px] text-studio-300">
            <span>反相</span>
            <input type="checkbox" checked={selected.inverted} onChange={(event) => updateMask({ inverted: event.target.checked })} />
          </label>
          <label className="block text-[11px] text-studio-300">
            <span className="flex justify-between"><span>不透明度</span><span>{Math.round(selected.opacity * 100)}%</span></span>
            <input className="w-full mt-1 accent-sky-400" type="range" min="0" max="100" value={Math.round(selected.opacity * 100)} onChange={(event) => updateMask({ opacity: Number(event.target.value) / 100 })} />
          </label>
          <div className="space-y-1">
            {localParameters.map(({ id, definition }) => (
              <ScrubbableInput
                key={id}
                param={definition}
                value={selected[id] ?? 0}
                onStartDrag={() => defaultDevelopOperations.beginMaskParameterChange(documentId, selected.id, id)}
                onPreviewDrag={(value) => setParameter(id, value)}
                onCommitDrag={() => defaultDevelopOperations.commitParameterChange()}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
