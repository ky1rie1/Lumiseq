import { useState } from 'react';
import { defaultTastePreferences, type TastePreferences } from '../../ai/harness/TastePreferences';
import { CREATIVE_EXEMPLARS } from '../../ai/harness/CreativeBrief';

export function TasteSettings({ preferences = defaultTastePreferences }: { preferences?: TastePreferences }) {
  const [domain, setDomain] = useState<'photo' | 'layout'>('photo');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string>();
  const [notice, setNotice] = useState('');
  const [, refresh] = useState(0);
  function change(action: () => void) {
    try { action(); refresh(value => value + 1); setNotice('已保存。'); }
    catch (error) { setNotice(error instanceof Error ? error.message : '保存失败。'); }
  }
  return <section className="ai-taste-settings" aria-label="风格偏好设置">
    <h3>风格偏好</h3><p>只保存你明确填写的偏好，用于后续创作。</p>
    {(['photo', 'layout'] as const).map(kind => <div key={kind}>
      <h4>{kind === 'photo' ? '摄影' : '排版'}</h4>
      {preferences.get(kind).length === 0 && <p className="text-studio-400">暂无偏好</p>}
      {preferences.get(kind).map(item => <div className="ai-taste-entry" key={item.id}><span>{item.text}</span>
        <button type="button" aria-label={`编辑 ${item.text}`} onClick={() => { setDomain(kind); setText(item.text); setEditing(item.id); }}>编辑</button>
        <button type="button" aria-label={`删除 ${item.text}`} onClick={() => change(() => preferences.remove(kind, item.id, preferences.beginUserFeedback()))}>删除</button>
      </div>)}
      <button type="button" onClick={() => change(() => preferences.clear(kind, preferences.beginUserFeedback()))}>清空{kind === 'photo' ? '摄影' : '排版'}偏好</button>
    </div>)}
    <form onSubmit={event => { event.preventDefault(); change(() => {
      if (editing) preferences.edit(domain, editing, text, preferences.beginUserFeedback());
      else preferences.save(domain, text, preferences.beginUserFeedback());
      setText(''); setEditing(undefined);
    }); }}>
      <label>偏好领域<select aria-label="偏好领域" value={domain} onChange={event => { setDomain(event.target.value as typeof domain); setEditing(undefined); }}>
        <option value="photo">摄影</option><option value="layout">排版</option>
      </select></label>
      <label>偏好内容<input aria-label="偏好内容" value={text} maxLength={160} onChange={event => setText(event.target.value)} placeholder="描述你喜欢的风格" /></label>
      <button type="submit" disabled={!text.trim()}>{editing ? '保存修改' : '添加偏好'}</button>
      {editing && <button type="button" onClick={() => { setEditing(undefined); setText(''); }}>取消编辑</button>}
    </form>
    <details><summary>描述示例</summary>{CREATIVE_EXEMPLARS.map(example => <p key={example.domain}>{example.prompt}</p>)}</details>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
