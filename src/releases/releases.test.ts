import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion, selectApplicableReleases, trustedReleasePage, trustedAssetUrl } from './releases';

const release = (version: string, extra = {}) => ({ tag_name: `v${version}`, html_url: `https://github.com/ky1rie1/Lumiseq/releases/tag/v${version}`, published_at: '2026-10-02T12:00:00Z', body: 'Notes', draft: false, prerelease: false, assets: [{ name: `Lumiseq-${version}-windows-x64-setup.exe`, browser_download_url: `https://github.com/ky1rie1/Lumiseq/releases/download/v${version}/Lumiseq-${version}-windows-x64-setup.exe` }], ...extra });

describe('official release selection', () => {
  it('compares numeric stable SemVer independently of publishing order', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(selectApplicableReleases([release('0.10.0'), release('0.9.9')], '0.9.9').latest?.version).toBe('0.10.0');
  });
  it.each(['release-0.9.7', 'V0.9.7', 'v01.9.7', '0.9', '1.0.0-beta', '1.0.0+dirty', '1.0.0/evil', '9007199254740992.0.0'])('rejects nonstable or ambiguous tag %s', tag => {
    expect(parseVersion(tag)).toBeNull();
  });
  it('excludes drafts, prereleases, source archives, unrelated assets and wrong release links', () => {
    const candidates = [release('1.0.0', { prerelease: true }), release('2.0.0', { draft: true }), release('3.0.0', { assets: [{ name: 'source.zip' }] }), release('4.0.0', { html_url: 'https://github.com/evil/Lumiseq/releases/tag/v4.0.0' }), release('5.0.0', { assets: [{ name: 'Lumiseq-5.0.0-windows-x64.zip', browser_download_url: 'https://evil.test/download.zip' }] })];
    expect(selectApplicableReleases(candidates, '0.9.7').latest).toBeNull();
  });
  it('requires asset version and tag to agree, prefers full installer, bounds Unicode notes by bytes', () => {
    const candidate = release('1.0.0', { body: '影'.repeat(20000), assets: [
      { name: 'Lumiseq-1.0.0-windows-x64.zip', browser_download_url: 'https://github.com/ky1rie1/Lumiseq/releases/download/v1.0.0/Lumiseq-1.0.0-windows-x64.zip' },
      ...release('1.0.0').assets, ...release('9.0.0').assets,
    ] });
    const result = selectApplicableReleases([candidate], '1.0.0');
    expect(result.latest?.installer?.name).toBe('Lumiseq-1.0.0-windows-x64-setup.exe');
    expect(result.current?.version).toBe('1.0.0');
    expect(new TextEncoder().encode(result.latest!.notes).length).toBeLessThanOrEqual(32768);
  });
  it.each(['http://github.com/ky1rie1/Lumiseq/releases/tag/v1.0.0', 'https://user@github.com/ky1rie1/Lumiseq/releases/tag/v1.0.0', 'https://github.com:444/ky1rie1/Lumiseq/releases/tag/v1.0.0', 'https://github.com/ky1rie1/Lumiseq/releases/tag/v1.0.0?next=evil', 'https://github.com/ky1rie1/Lumiseq/releases/tag/../evil', 'https://github.com/ky1rie1/Lumiseq/releases/download/v1.0.0/file.exe'])('rejects untrusted page %s', url => expect(trustedReleasePage(url)).toBe(false));
  it('accepts only repository download assets and tag pages', () => {
    expect(trustedReleasePage(release('1.0.0').html_url)).toBe(true);
    expect(trustedAssetUrl(release('1.0.0').assets[0].browser_download_url, 'v1.0.0', 'Lumiseq-1.0.0-windows-x64-setup.exe')).toBe(true);
    expect(trustedAssetUrl(release('1.0.0').assets[0].browser_download_url, 'v2.0.0', 'Lumiseq-1.0.0-windows-x64-setup.exe')).toBe(false);
  });
});
