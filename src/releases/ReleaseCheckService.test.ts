import { describe, expect, it } from 'vitest';
import { ReleaseCheckService } from './ReleaseCheckService';
import type { ReleasePlatform, ReleaseQueryResult } from './releaseTypes';

const row = (version = '0.10.0') => ({ tag_name: `v${version}`, html_url: `https://github.com/ky1rie1/Lumiseq/releases/tag/v${version}`, draft: false, prerelease: false, body: 'Notes', assets: [{ name: `Lumiseq-${version}-windows-x64.zip`, browser_download_url: `https://github.com/ky1rie1/Lumiseq/releases/download/v${version}/Lumiseq-${version}-windows-x64.zip` }] });
function fixture(initial = '', channel: 'stable' | 'development' = 'stable') {
  let saved = initial, now = 100_000_000, count = 0, cancelled = '';
  let result: ReleaseQueryResult = { status: 'ok', releases: [row()], etag: 'a' };
  const platform: ReleasePlatform = { checkRelease: async () => { count++; return result; }, cancelReleaseCheck: async id => { cancelled = id; }, openReleasePage: async () => {}, getBuildIdentity: async () => ({ version: '0.9.7', commit: 'abc', dirty: channel === 'development', channel }) };
  const service = new ReleaseCheckService(platform, { read: () => saved, write: value => { saved = value; } }, () => now);
  return { service, platform, saved: () => saved, count: () => count, cancelled: () => cancelled, advance: (ms: number) => { now += ms; }, result: (value: ReleaseQueryResult) => { result = value; } };
}
describe('release check lifecycle', () => {
  it('retains the old verified date and result on failure', async () => {
    const f = fixture(); await f.service.initialize(); await f.service.check(); const date = f.service.getSnapshot().verifiedAt;
    f.advance(1000); f.result({ status: 'offline' }); await f.service.check();
    expect(f.service.getSnapshot()).toMatchObject({ status: 'offline', verifiedAt: date, latest: { version: '0.10.0' } });
  });
  it('never calls a limited range current and rejects 304 without a cache', async () => {
    const f = fixture(); await f.service.initialize(); f.result({ status: 'ok', releases: [row('0.9.7')], hasNextPage: true }); await f.service.check(); expect(f.service.getSnapshot().status).toBe('limited');
    const empty = fixture(); await empty.service.initialize(); empty.result({ status: 'notModified' }); await empty.service.check(); expect(empty.service.getSnapshot().status).toBe('malformed');
  });
  it('honors 24 hour auto cooldown and rate limit retry for manual requests', async () => {
    const f = fixture(); await f.service.initialize(); await f.service.check(false); await f.service.check(false); expect(f.count()).toBe(1);
    f.advance(86_400_000); f.result({ status: 'rateLimited', retryAt: 300_000_000 }); await f.service.check(false); await f.service.check(); expect(f.count()).toBe(2);
  });
  it('deduplicates requests and ignores completion after cancellation', async () => {
    const f = fixture(); await f.service.initialize(); let resolve!: (result: ReleaseQueryResult) => void;
    f.platform.checkRelease = () => new Promise(done => { resolve = done; }); const first = f.service.check(); const second = f.service.check(); expect(first).toBe(second);
    f.service.cancel(); resolve({ status: 'ok', releases: [row()] }); await first; expect(f.service.getSnapshot().latest).toBeNull(); expect(f.cancelled()).not.toBe('');
  });
  it('persists ignore and snooze per version and reveals the next version', async () => {
    const f = fixture(); await f.service.initialize(); await f.service.check(); expect(f.service.getSnapshot().hint).toBe('update');
    f.service.ignore(); expect(f.service.getSnapshot().hint).toBeNull(); f.result({ status: 'ok', releases: [row('0.11.0')] }); await f.service.check(); expect(f.service.getSnapshot().hint).toBe('update');
    f.service.snooze(); expect(f.service.getSnapshot().hint).toBeNull(); f.advance(86_400_001); f.service.refreshHints(); expect(f.service.getSnapshot().hint).toBe('update');
    const restored = fixture(f.saved()); await restored.service.initialize(); expect(restored.service.getSnapshot().latest?.version).toBe('0.11.0');
  });
  it('does not announce upgrade on first install, but tracks stable upgrades and read notes', async () => {
    const f = fixture(); f.result({ status: 'ok', releases: [row('0.9.7')] }); await f.service.initialize(); await f.service.check(); expect(f.service.getSnapshot().hint).toBeNull();
    const upgraded = fixture(JSON.stringify({ previousVersion: '0.9.6' })); upgraded.result({ status: 'ok', releases: [row('0.9.7')] }); await upgraded.service.initialize(); await upgraded.service.check(); expect(upgraded.service.getSnapshot().hint).toBe('notes');
    upgraded.service.markNotesRead(); expect(upgraded.service.getSnapshot().hint).toBeNull();
  });
  it('labels an unverified build as development even when versions match', async () => {
    const f = fixture('', 'development'); f.result({ status: 'ok', releases: [row('0.9.7')] }); await f.service.initialize(); await f.service.check(); expect(f.service.getSnapshot().status).toBe('development');
  });
  it('revalidates cached 304 results without replacing bounded notes', async () => {
    const f = fixture(); await f.service.initialize(); await f.service.check(); const first = f.service.getSnapshot().verifiedAt;
    f.advance(5000); f.result({ status: 'notModified' }); await f.service.check(); expect(f.service.getSnapshot()).toMatchObject({ status: 'update', latest: { version: '0.10.0' }, verifiedAt: first + 5000 });
  });
  it('does not call a version newer than any official package current', async () => {
    const f = fixture(); await f.service.initialize(); f.result({ status: 'ok', releases: [row('0.9.6')] }); await f.service.check(); expect(f.service.getSnapshot().status).toBe('development');
  });
  it('ignores malformed persisted metadata and never persists unrelated data', async () => {
    const f = fixture(JSON.stringify({ verifiedAt: 10, etag: 'a', latest: { version: '0.10.0', notes: 'injected' }, secret: 'unrelated' })); await f.service.initialize(); expect(f.service.getSnapshot().latest).toBeNull(); expect(f.saved()).not.toContain('secret');
  });
  it('promotes cached latest notes to current after upgrade even with a 304 response', async () => {
    const old = fixture(); await old.service.initialize(); await old.service.check();
    const upgraded = fixture(old.saved()); upgraded.platform.getBuildIdentity = async () => ({ version: '0.10.0', commit: 'new', channel: 'stable', dirty: false });
    upgraded.result({ status: 'notModified' }); await upgraded.service.initialize(); await upgraded.service.check();
    expect(upgraded.service.getSnapshot()).toMatchObject({ status: 'current', current: { version: '0.10.0' }, hint: 'notes' });
  });
  it('requests an uncached installed version without an ETag to discover its notes', async () => {
    const old = fixture(); await old.service.initialize(); await old.service.check();
    const upgraded = fixture(old.saved()); upgraded.platform.getBuildIdentity = async () => ({ version: '0.9.8', commit: 'new', channel: 'stable', dirty: false });
    let requestedEtag: string | undefined = 'not-called';
    upgraded.platform.checkRelease = async etag => { requestedEtag = etag; return { status: 'ok', releases: [row('0.10.0'), row('0.9.8')] }; };
    await upgraded.service.initialize();
    expect(upgraded.service.getSnapshot().verifiedAt).toBe(0);
    await upgraded.service.check(false);
    expect(requestedEtag).toBeUndefined();
    expect(upgraded.service.getSnapshot()).toMatchObject({ current: { version: '0.9.8' }, hint: 'notes' });
  });
});
