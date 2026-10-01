import { useState } from 'react';
import { TextLayer, TextEffects, TextStroke, TextShadow } from '../../../types/edit';
import { defaultCommandBus } from '../../../history/CommandBus';
import { defaultDocumentManager } from '../../../document/DocumentManager';
import { SetTextEffectsCommand } from '../../../commands/edit/SetTextEffectsCommand';

export function TextEffectsPanel({ layer, documentId }: { layer: TextLayer; documentId: string }) {
  const [error, setError] = useState('');
  const stroke: TextStroke = layer.stroke ?? { enabled: false, color: '#000000', width: 2 };
  const shadow: TextShadow = layer.shadow ?? { enabled: false, color: '#000000', opacity: 0.5, blur: 8, offsetX: 4, offsetY: 4 };
  const apply = (patch: TextEffects) => {
    try {
      defaultCommandBus.execute(new SetTextEffectsCommand(documentId, layer.id, { ...(layer.stroke ? { stroke: layer.stroke } : {}), ...(layer.shadow ? { shadow: layer.shadow } : {}), ...patch }, defaultDocumentManager));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '文字效果无法更新'); }
  };
  const number = (label: string, value: number, min: number, max: number, step: number, change: (value: number) => void) => (
    <label className="flex items-center justify-between gap-2 text-[11px] text-white/60"><span>{label}</span>
      <input aria-label={label} type="number" value={value} min={min} max={max} step={step}
        onChange={e => { if (e.target.value !== '') change(e.target.valueAsNumber); }}
        className="w-20 bg-[#27272a] border border-white/10 rounded px-2 py-1 text-white" />
    </label>
  );
  return <div className="space-y-3 pt-3 border-t border-white/10">
    <label className="flex gap-2 items-center"><input type="checkbox" checked={stroke.enabled} onChange={e => apply({ stroke: { ...stroke, enabled: e.target.checked } })} />描边</label>
    <label className="flex justify-between text-white/60">描边颜色<input aria-label="描边颜色" type="color" value={stroke.color} onChange={e => apply({ stroke: { ...stroke, color: e.target.value } })} /></label>
    {number('描边宽度 (px)', stroke.width, 0, 256, 0.5, width => apply({ stroke: { ...stroke, width } }))}
    <label className="flex gap-2 items-center"><input type="checkbox" checked={shadow.enabled} onChange={e => apply({ shadow: { ...shadow, enabled: e.target.checked } })} />投影</label>
    <label className="flex justify-between text-white/60">阴影颜色<input aria-label="阴影颜色" type="color" value={shadow.color} onChange={e => apply({ shadow: { ...shadow, color: e.target.value } })} /></label>
    {number('投影不透明度', shadow.opacity, 0, 1, 0.05, opacity => apply({ shadow: { ...shadow, opacity } }))}
    {number('投影大小 / 模糊 (px)', shadow.blur, 0, 256, 1, blur => apply({ shadow: { ...shadow, blur } }))}
    {number('水平偏移 X (px)', shadow.offsetX, -2048, 2048, 1, offsetX => apply({ shadow: { ...shadow, offsetX } }))}
    {number('垂直偏移 Y (px)', shadow.offsetY, -2048, 2048, 1, offsetY => apply({ shadow: { ...shadow, offsetY } }))}
    {error && <p role="alert" className="text-red-400 text-[11px]">{error}</p>}
  </div>;
}
