import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe.skipIf(process.platform !== 'win32')('Runtime-free acceptance safety', () => {
  it('rejects local execution before touching Runtime or downloading files', () => {
    const env = { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'local' };
    const result = spawnSync('pwsh', ['-NoProfile', '-File', resolve('scripts/windows-clean-acceptance.ps1'), '-Mode', 'Run'], { env, encoding: 'utf8', timeout: 15000 });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Only a disposable GitHub-hosted Windows runner');
  });
  it('rejects a self-hosted runner even when GitHub Actions is set', () => {
    const env = { ...process.env, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' };
    const result = spawnSync('pwsh', ['-NoProfile', '-File', resolve('scripts/windows-clean-acceptance.ps1'), '-Mode', 'Run'], { env, encoding: 'utf8', timeout: 15000 });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Only a disposable GitHub-hosted Windows runner');
  });
});
