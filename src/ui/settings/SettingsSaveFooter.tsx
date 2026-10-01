export function SettingsSaveFooter({ dirty, busy, onSave, readOnly = false }: {
  dirty: boolean; busy: boolean; onSave: () => void; readOnly?: boolean;
}) {
  return <footer className="settings-save-footer">
    <span>{busy ? '正在处理…' : dirty ? '有未保存的修改' : ''}</span>
    <button type="button" className="settings-save-button" disabled={busy || !dirty || readOnly} onClick={onSave}>{busy ? '请稍候…' : '保存设置'}</button>
  </footer>;
}
