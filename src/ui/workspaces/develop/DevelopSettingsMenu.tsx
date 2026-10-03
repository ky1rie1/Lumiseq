import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { Copy, ClipboardPaste, MoreHorizontal } from 'lucide-react';
import { defaultDevelopOperations } from '../../../develop/DevelopOperationService';
import { DEVELOP_SETTINGS_GROUPS, DevelopSettingsGroup } from '../../../develop/DevelopSettingsClipboard';
import { Modal } from '../../shared/Modal';
import { defaultDocumentManager } from '../../../document/DocumentManager';
import { guardMenuDocument } from '../../shared/contextMenuTargets';

const labels: Record<DevelopSettingsGroup, string> = {
  basic: '基础影调', color: '质感、色彩与 HSL', curves: '色调曲线', detail: '细节与降噪', optics: '晕影',
};

export interface DevelopSettingsMenuHandle { openPaste: () => void }
export const DevelopSettingsMenu = forwardRef<DevelopSettingsMenuHandle, { documentId: string; disabled: boolean; onStatus: (message: string) => void }>(function DevelopSettingsMenu({ documentId, disabled, onStatus }, ref) {
  const operations = defaultDevelopOperations;
  const [snapshot, setSnapshot] = useState(() => operations.clipboard.getSnapshot());
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<DevelopSettingsGroup[]>([...DEVELOP_SETTINGS_GROUPS]);
  const [includeWB, setIncludeWB] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const pasteTarget = useRef<object|null>(null);
  useEffect(() => operations.clipboard.subscribe(() => setSnapshot(operations.clipboard.getSnapshot())), [operations]);
  const closeMenu = () => menu.current?.hidePopover();
  const openPaste = () => {
    if (disabled || busy || !operations.clipboard.getSnapshot()) return;
    pasteTarget.current = defaultDocumentManager.getDocument(documentId);
    closeMenu(); setGroups([...DEVELOP_SETTINGS_GROUPS]); setIncludeWB(false); setError(''); setOpen(true);
  };
  useImperativeHandle(ref, () => ({ openPaste }));
  useEffect(() => defaultDocumentManager.subscribe(event => {
    if (event.type === 'activated' || event.type === 'closed') { closeMenu(); setOpen(false); pasteTarget.current = null; }
  }), []);
  const copy = () => {
    closeMenu();
    try { const copied = operations.copySettings(documentId); onStatus(`已复制 ${copied.sourceName} 的调色参数`); }
    catch (cause) { onStatus(`复制参数失败：${cause instanceof Error ? cause.message : String(cause)}`); }
  };
  const paste = async () => {
    setBusy(true); setError('');
    try { guardMenuDocument(defaultDocumentManager, documentId, pasteTarget.current ?? undefined); await operations.pasteSettings(documentId, groups, includeWB); setOpen(false); onStatus('调色参数已粘贴，可在历史中撤销'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <>
    <div className="develop-settings-menu">
      <button type="button" aria-label="调色操作" title="复制 / 粘贴调色参数" aria-expanded={menuOpen} aria-controls={menuId} onClick={event => {
        const popup = menu.current;
        if (!popup) return;
        if (popup.matches(':popover-open')) { popup.hidePopover(); return; }
        const box = event.currentTarget.getBoundingClientRect();
        popup.style.left = `${Math.max(8, Math.min(box.right - 216, window.innerWidth - 224))}px`;
        popup.style.top = `${box.bottom + 5}px`;
        popup.showPopover();
      }}><MoreHorizontal size={14} /></button>
      <div ref={menu} id={menuId} popover="auto" className="develop-settings-options" onToggle={() => setMenuOpen(menu.current?.matches(':popover-open') ?? false)}>
        <button type="button" disabled={disabled || busy} onClick={copy}><Copy size={13} />复制调色参数</button>
        <button type="button" disabled={disabled || busy || !snapshot} onClick={openPaste}><ClipboardPaste size={13} />粘贴调色参数…</button>
        <p>{snapshot ? `来源：${snapshot.sourceName}` : '先从一张照片复制参数'}</p>
      </div>
    </div>
    <Modal open={open} dismissible={!busy} onClose={() => { if (!busy) setOpen(false); }} title="选择要粘贴的调色参数">
      <div className="develop-settings-dialog">
        <p className="develop-settings-source">来源 <strong>{snapshot?.sourceName}</strong><time>{snapshot ? new Date(snapshot.copiedAt).toLocaleString() : ''}</time></p>
        <fieldset disabled={busy}>
          <legend>选择参数模块</legend>
          {DEVELOP_SETTINGS_GROUPS.map(group => <label key={group}><input type="checkbox" checked={groups.includes(group)} onChange={event => setGroups(current => event.target.checked ? [...current, group] : current.filter(value => value !== group))} />{labels[group]}</label>)}
        </fieldset>
        <label className="develop-settings-wb"><input type="checkbox" checked={includeWB} disabled={busy} onChange={event => setIncludeWB(event.target.checked)} />包含白平衡</label>
        <p className="develop-settings-notice">默认保留目标照片的白平衡。勾选后，手动白平衡只复制色温与色调；原照 / 自动按目标照片处理。相机数据与局部蒙版保留。</p>
        {error && <p role="alert" className="develop-settings-error">{error}</p>}
        {busy && <p role="status">正在解析目标照片并粘贴…</p>}
        <div className="develop-settings-buttons"><button type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button><button type="button" disabled={busy || !groups.length || disabled} onClick={() => void paste()}>粘贴所选模块</button></div>
      </div>
    </Modal>
  </>;
});
