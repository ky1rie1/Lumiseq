import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../shared/useFocusTrap';

/** Lives above the scroll area so an unfinished custom service can always be left. */
export function SettingsUnsavedDialog({ open, onCancel, onDiscard, onSave }: {
  open: boolean; onCancel: () => void; onDiscard: () => void; onSave: () => Promise<boolean>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trap = useFocusTrap(panel);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(''); panel.current?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<div className="settings-confirm-overlay" onClick={event => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
    <div ref={panel} role="alertdialog" aria-modal="true" aria-labelledby="settings-unsaved-title" aria-describedby="settings-unsaved-description" tabIndex={-1} className="settings-confirm-panel"
      onKeyDown={event => { trap(event); if (event.key === 'Escape') { event.preventDefault(); if (!busy) onCancel(); } event.stopPropagation(); }}>
      <h3 id="settings-unsaved-title">保存这次修改吗？</h3>
      <p id="settings-unsaved-description">保存后继续切换，或放弃本页尚未保存的修改。</p>
      {error && <p role="alert" className="settings-confirm-error">{error}</p>}
      <div className="settings-confirm-actions">
        <button type="button" disabled={busy} onClick={onCancel}>继续编辑</button>
        <button type="button" disabled={busy} onClick={onDiscard}>放弃修改</button>
        <button type="button" className="settings-save-button" disabled={busy} onClick={async () => {
          if (saving.current) return;
          saving.current = true; setBusy(true); setError('');
          try { if (!(await onSave())) setError('未能保存，请返回页面检查填写内容或稍后重试。'); }
          catch (reason) { setError(`保存失败：${reason instanceof Error ? reason.message : '请重试'}`); }
          finally { saving.current = false; setBusy(false); }
        }}>{busy ? '保存中…' : '保存并继续'}</button>
      </div>
    </div>
  </div>, document.body);
}
