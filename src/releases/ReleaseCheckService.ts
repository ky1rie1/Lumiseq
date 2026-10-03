import { compareVersions, parseApplicableRelease, parseVersion, selectApplicableReleases, trustedReleasePage } from './releases';
import type { ApplicableRelease, BuildIdentity, ReleasePlatform, ReleaseQueryResult } from './releaseTypes';

const DAY = 86_400_000;
type Status = ReleaseQueryResult['status'] | 'idle' | 'checking' | 'update' | 'current' | 'limited' | 'noPackage' | 'development';
export interface ReleaseSnapshot {
  status: Status; build: BuildIdentity | null; latest: ApplicableRelease | null; current: ApplicableRelease | null;
  verifiedAt: number; attemptedAt: number; retryAt: number; autoCheck: boolean; hint: 'update' | 'notes' | null;
}
export interface ReleaseStorage { read(): string; write(value: string): void }
interface Saved {
  latest?: ApplicableRelease | null; current?: ApplicableRelease | null; etag?: string; verifiedAt?: number;
  attemptedAt?: number; retryAt?: number; autoCheck?: boolean; limited?: boolean; previousVersion?: string;
  ignoredVersion?: string; snoozedVersion?: string; snoozeUntil?: number; unreadVersion?: string;
  cacheVerified?: boolean;
}
function cachedRelease(value: ApplicableRelease | null | undefined): ApplicableRelease | null {
  if (!value || typeof value !== 'object') return null;
  return parseApplicableRelease({ tag_name: value.tag, html_url: value.url, published_at: value.publishedAt, body: value.notes, draft: false, prerelease: false, assets: [value.installer, value.portable].filter(Boolean).map(asset => ({ name: asset!.name, browser_download_url: asset!.url })) });
}
export class ReleaseCheckService {
  private saved: Saved = {};
  private snapshot: ReleaseSnapshot = { status: 'idle', build: null, latest: null, current: null, verifiedAt: 0, attemptedAt: 0, retryAt: 0, autoCheck: true, hint: null };
  private listeners = new Set<() => void>();
  private initializing?: Promise<void>;
  private pending?: Promise<void>;
  private requestId = '';
  private generation = 0;
  constructor(private platform: ReleasePlatform, private storage: ReleaseStorage, private now = Date.now) {
    try { const text = storage.read(); if (text.length <= 150_000) { const parsed: unknown = JSON.parse(text || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.saved = parsed as Saved; } } catch { /* Corrupt or unavailable preferences use defaults. */ }
    const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
    this.snapshot = { ...this.snapshot, latest: cachedRelease(this.saved.latest), current: cachedRelease(this.saved.current), verifiedAt: timestamp(this.saved.verifiedAt), attemptedAt: timestamp(this.saved.attemptedAt), retryAt: timestamp(this.saved.retryAt), autoCheck: this.saved.autoCheck !== false };
    const version = (value: unknown) => typeof value === 'string' ? parseVersion(value) ?? undefined : undefined;
    const cacheVerified = this.saved.cacheVerified === true && (!this.saved.latest || !!this.snapshot.latest) && (!this.saved.current || !!this.snapshot.current);
    this.saved = { latest: this.snapshot.latest, current: this.snapshot.current, cacheVerified, etag: typeof this.saved.etag === 'string' && this.saved.etag.length <= 512 && !/[\x00-\x1f\x7f]/.test(this.saved.etag) ? this.saved.etag : undefined, limited: this.saved.limited === true, previousVersion: version(this.saved.previousVersion), ignoredVersion: version(this.saved.ignoredVersion), snoozedVersion: version(this.saved.snoozedVersion), snoozeUntil: timestamp(this.saved.snoozeUntil), unreadVersion: version(this.saved.unreadVersion) };
    if (!cacheVerified) this.snapshot.verifiedAt = 0;
  }
  getSnapshot = (): ReleaseSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(update: Partial<ReleaseSnapshot> = {}) { this.snapshot = { ...this.snapshot, ...update }; this.listeners.forEach(listener => listener()); }
  private persist() {
    const { latest, current, verifiedAt, attemptedAt, retryAt, autoCheck } = this.snapshot;
    // Only these two bounded release notes are stored, never the full API response.
    try { this.storage.write(JSON.stringify({ ...this.saved, latest, current, verifiedAt, attemptedAt, retryAt, autoCheck })); } catch { /* Session state remains usable when storage is unavailable. */ }
  }
  initialize(): Promise<void> {
    return this.initializing ??= this.platform.getBuildIdentity().then(build => {
      if (!parseVersion(build.version)) throw new Error('Invalid build version');
      const previous = this.saved.previousVersion;
      if (build.channel === 'stable' && previous && parseVersion(previous) && compareVersions(build.version, previous) > 0) this.saved.unreadVersion = build.version;
      this.saved.previousVersion = build.version;
      const current = this.snapshot.latest?.version === build.version ? this.snapshot.latest : this.snapshot.current?.version === build.version ? this.snapshot.current : null;
      if (!current) { this.saved.etag = undefined; this.saved.cacheVerified = false; }
      this.emit({ build, current, ...(!current ? { verifiedAt: 0 } : {}),
        ...(!current && previous !== build.version ? { attemptedAt: 0 } : {}) }); this.refreshHints(); this.persist();
    }).catch(() => { this.emit({ status: 'unsupported' }); });
  }
  check(manual = true): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.snapshot.build) return this.initialize().then(() => this.snapshot.build ? this.check(manual) : undefined);
    const now = this.now();
    if (now < this.snapshot.retryAt || (!manual && (!this.snapshot.autoCheck || (this.snapshot.attemptedAt > 0 && now - this.snapshot.attemptedAt < DAY)))) return Promise.resolve();
    const generation = ++this.generation;
    this.requestId = `release-${generation}-${now}`;
    this.emit({ status: 'checking', attemptedAt: now }); this.persist();
    this.pending = this.platform.checkRelease(this.saved.etag, this.requestId).catch((): ReleaseQueryResult => ({ status: 'error' })).then(result => {
      if (generation !== this.generation) return;
      if (result.status === 'ok') {
        if (!Array.isArray(result.releases) || result.releases.length > 100) { this.emit({ status: 'malformed' }); return; }
        const selected = selectApplicableReleases(result.releases, this.snapshot.build!.version);
        this.saved.etag = result.etag; this.saved.limited = result.hasNextPage === true; this.saved.cacheVerified = true;
        this.emit({ ...selected, verifiedAt: this.now(), retryAt: 0 }); this.emit({ status: this.successStatus() });
      } else if (result.status === 'notModified') {
        if (!this.saved.cacheVerified || !this.snapshot.verifiedAt || !this.saved.etag) this.emit({ status: 'malformed' });
        else { this.emit({ verifiedAt: this.now(), retryAt: 0, status: this.successStatus() }); }
      } else this.emit({ status: result.status, retryAt: result.status === 'rateLimited' ? result.retryAt ?? this.now() + DAY : 0 });
      this.refreshHints(); this.persist();
    }).finally(() => { if (generation === this.generation) { this.pending = undefined; this.requestId = ''; } });
    return this.pending;
  }
  private successStatus(): Status {
    const { latest, build } = this.snapshot;
    if (latest && compareVersions(latest.version, build!.version) > 0) return 'update';
    if (this.saved.limited) return 'limited';
    if (!latest) return 'noPackage';
    return build!.channel === 'development' || this.snapshot.current?.version !== build!.version ? 'development' : 'current';
  }
  cancel() { const id = this.requestId; this.generation++; this.pending = undefined; this.requestId = ''; if (id) void this.platform.cancelReleaseCheck?.(id).catch(() => {}); this.emit({ status: 'cancelled' }); }
  setAutoCheck(value: boolean) { this.emit({ autoCheck: value }); this.persist(); }
  ignore() { if (this.snapshot.latest) this.saved.ignoredVersion = this.snapshot.latest.version; this.refreshHints(); this.persist(); }
  snooze() { if (this.snapshot.hint === 'notes') this.markNotesRead(); else { this.saved.snoozedVersion = this.snapshot.latest?.version; this.saved.snoozeUntil = this.now() + DAY; this.refreshHints(); this.persist(); } }
  markNotesRead() { this.saved.unreadVersion = undefined; this.refreshHints(); this.persist(); }
  refreshHints() {
    const { latest, current, build } = this.snapshot;
    let hint: ReleaseSnapshot['hint'] = null;
    if (build?.channel === 'stable' && current && current.version === this.saved.unreadVersion) hint = 'notes';
    else if (latest && build && compareVersions(latest.version, build.version) > 0 && latest.version !== this.saved.ignoredVersion && !(latest.version === this.saved.snoozedVersion && this.now() < (this.saved.snoozeUntil ?? 0))) hint = 'update';
    this.emit({ hint });
  }
  async openOfficialPage(url: string) { if (!trustedReleasePage(url)) throw new Error('Untrusted release page'); await this.platform.openReleasePage(url); }
}
