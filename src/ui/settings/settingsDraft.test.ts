import { describe, expect, it } from 'vitest';
import { SettingsRequestScope, hasSettingsDraftChanges } from './settingsDraft';

describe('settings request lifetime', () => {
  it('rejects previous service results after selection changes', () => {
    const scope = new SettingsRequestScope();
    const first = scope.begin();
    const second = scope.begin();
    expect(scope.isCurrent(first)).toBe(false);
    expect(scope.isCurrent(second)).toBe(true);
  });
  it('rejects results after the settings page unmounts', () => {
    const scope = new SettingsRequestScope();
    const request = scope.begin();
    scope.invalidate();
    expect(scope.isCurrent(request)).toBe(false);
  });
});

describe('settings draft detection', () => {
  it('tracks connection edits and an unsaved key without serializing secrets', () => {
    expect(hasSettingsDraftChanges({ name: 'A' }, { name: 'A' }, '')).toBe(false);
    expect(hasSettingsDraftChanges({ name: 'A' }, { name: 'B' }, '')).toBe(true);
    expect(hasSettingsDraftChanges({ name: 'A' }, { name: 'A' }, 'key')).toBe(true);
  });
});

it('captures concurrent operations without invalidating the same page lifetime', () => {
  const scope = new SettingsRequestScope();
  scope.begin();
  const first = scope.capture();
  const second = scope.capture();
  expect(scope.isCurrent(first)).toBe(true);
  expect(scope.isCurrent(second)).toBe(true);
  scope.invalidate();
  expect(scope.isCurrent(first)).toBe(false);
});
