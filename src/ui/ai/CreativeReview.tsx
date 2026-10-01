import { useState } from 'react';
import type { AgentRun } from '../../ai/types';
import type { CandidateSet } from '../../ai/harness/CandidateService';
import { defaultTastePreferences, type TastePreferences } from '../../ai/harness/TastePreferences';

export interface CreativeReviewProps {
  run: AgentRun;
  candidates: CandidateSet;
  onChoose: (candidateId: string) => Promise<unknown>;
  onDiscard: () => void;
  preferences?: TastePreferences;
}

export function CreativeReview({ run, candidates, onChoose, onDiscard, preferences = defaultTastePreferences }: CreativeReviewProps) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [domain, setDomain] = useState<'photo' | 'layout'>(run.taskKind === 'photo' || run.taskKind === 'local-detail' ? 'photo' : 'layout');
  const [notice, setNotice] = useState('');
  async function choose(id: string) {
    setBusy(true); setNotice('');
    try { await onChoose(id); }
    catch (error) { setNotice(error instanceof Error ? error.message : '无法应用候选，请重新生成。'); }
    finally { setBusy(false); }
  }
  function saveFeedback() {
    try {
      preferences.save(domain, feedback, preferences.beginUserFeedback());
      setFeedback(''); setNotice('已保存风格偏好。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存失败。'); }
  }
  return <section className="ai-creative-review" aria-label="创意候选评审">
    <h3>比较创意方向</h3>
    <p className="text-2xs text-studio-400">选择后应用此方向，可撤销本次任务。</p>
    <div className="ai-creative-previews">
      <figure><img src={candidates.baseline.preview} alt="原图预览" /><figcaption>原图</figcaption></figure>
      {candidates.candidates.map(candidate => <figure key={candidate.id}>
        <img src={candidate.preview} alt={`候选 ${candidate.label} 预览`} />
        <figcaption><strong>{candidate.label}</strong><p>{candidate.reason}</p>
          <button type="button" className="ai-confirm-button" disabled={busy} onClick={() => choose(candidate.id)}>选择 {candidate.label}</button>
        </figcaption>
      </figure>)}
    </div>
    <button type="button" disabled={busy} onClick={onDiscard}>放弃候选</button>
    {!!run.verification?.observations.length && <details className="ai-creative-evidence"><summary>查看检查范围</summary>
      {run.verification.observations.map(evidence => <p key={evidence.observationId}>
        {evidence.region.width === evidence.sourceWidth && evidence.region.height === evidence.sourceHeight ? '全图' : '局部'} · {`${evidence.region.x}, ${evidence.region.y} · ${evidence.region.width} × ${evidence.region.height}`}
        {evidence.approximate ? ' · 近似预览' : ''}
      </p>)}
    </details>}
    <div className="ai-creative-feedback">
      <label>风格反馈<select aria-label="反馈领域" value={domain} disabled={busy} onChange={event => setDomain(event.target.value as typeof domain)}>
        <option value="photo">摄影</option><option value="layout">排版</option>
      </select></label>
      <textarea aria-label="风格反馈" maxLength={160} value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="例如：保留自然肤色，标题留白宽松" />
      <button type="button" disabled={!feedback.trim() || busy} onClick={saveFeedback}>保存为风格偏好</button>
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
