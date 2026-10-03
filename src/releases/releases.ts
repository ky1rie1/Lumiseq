import type { ApplicableRelease, ReleaseAsset } from './releaseTypes';

const stable = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function parseVersion(tag: string): string | null {
  const match = stable.exec(tag);
  return match && match.slice(1).every(part => Number.isSafeInteger(Number(part))) ? match.slice(1).join('.') : null;
}
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) throw new Error('Invalid stable version');
  const l = left.split('.').map(Number), r = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (l[i] !== r[i]) return l[i] > r[i] ? 1 : -1;
  return 0;
}
function repositoryUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    // Require canonical spelling too: URL normalization must not hide dot paths,
    // credentials, explicit ports, escapes, controls or a misleading query.
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.href === value ? url : null;
  } catch { return null; }
}
export function trustedReleasePage(value: string): boolean {
  const url = repositoryUrl(value);
  if (!url) return false;
  const prefix = '/ky1rie1/Lumiseq/releases/tag/';
  return url.pathname.startsWith(prefix) && parseVersion(url.pathname.slice(prefix.length)) !== null;
}
export function trustedAssetUrl(value: string, tag: string, name: string): boolean {
  const url = repositoryUrl(value);
  return !!url && parseVersion(tag) !== null && url.pathname === `/ky1rie1/Lumiseq/releases/download/${tag}/${name}`;
}
export function boundedNotes(value: string): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(new TextEncoder().encode(value).slice(0, 32768)).replace(/\uFFFD$/, '');
}
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
export function parseApplicableRelease(value: unknown): ApplicableRelease | null {
  const row = object(value);
  if (!row || row.draft !== false || row.prerelease !== false || typeof row.tag_name !== 'string' || typeof row.html_url !== 'string' || !trustedReleasePage(row.html_url)) return null;
  const version = parseVersion(row.tag_name);
  if (!version || row.html_url !== `https://github.com/ky1rie1/Lumiseq/releases/tag/${row.tag_name}` || !Array.isArray(row.assets)) return null;
  let installer: ReleaseAsset | undefined, portable: ReleaseAsset | undefined;
  for (const entry of row.assets) {
    const asset = object(entry);
    if (!asset || typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string' || !trustedAssetUrl(asset.browser_download_url, row.tag_name, asset.name)) continue;
    if (asset.name === `Lumiseq-${version}-windows-x64-setup.exe`) installer = { name: asset.name, url: asset.browser_download_url };
    if (asset.name === `Lumiseq-${version}-windows-x64.zip`) portable = { name: asset.name, url: asset.browser_download_url };
  }
  if (!installer && !portable) return null;
  return { version, tag: row.tag_name, url: row.html_url, publishedAt: typeof row.published_at === 'string' && Number.isFinite(Date.parse(row.published_at)) ? row.published_at : '', notes: boundedNotes(typeof row.body === 'string' ? row.body : ''), installer, portable };
}
export function selectApplicableReleases(releases: unknown[], currentVersion: string): {latest: ApplicableRelease | null; current: ApplicableRelease | null} {
  let latest: ApplicableRelease | null = null, current: ApplicableRelease | null = null;
  for (const value of releases.slice(0, 100)) {
    const candidate = parseApplicableRelease(value);
    if (!candidate) continue;
    if (!latest || compareVersions(candidate.version, latest.version) > 0) latest = candidate;
    if (candidate.version === currentVersion) current = candidate;
  }
  return { latest, current };
}
