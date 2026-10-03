import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseVersions } from './release-version.mjs';
test('package, Cargo, Tauri and release notes agree before packaging', () => {
  const fixture = { packageVersion: '0.9.7', cargo: '[package]\nversion = "0.9.7"\n', tauri: { version: '../package.json' }, notes: '# Lumiseq v0.9.7\n', noteName: 'v0.9.7.md' };
  assert.equal(validateReleaseVersions(fixture), '0.9.7');
  assert.throws(() => validateReleaseVersions({ ...fixture, cargo: '[package]\nversion = "0.9.6"' }));
  assert.throws(() => validateReleaseVersions({ ...fixture, tauri: { version: '0.9.6' } }));
  assert.throws(() => validateReleaseVersions({ ...fixture, notes: '# Lumiseq v0.9.6' }));
  assert.throws(() => validateReleaseVersions({ ...fixture, notes: '# Lumiseq v0.9.70' }));
  assert.throws(() => validateReleaseVersions({ ...fixture, noteName: 'v0.9.6.md' }));
});
