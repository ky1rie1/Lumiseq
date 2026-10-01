import { expect, it } from 'vitest';
import { defaultExportOptions } from './preferenceRuntime';
import { getStudioPreferences } from '../stores/useStudioPreferences';

it('uses committed crop dimensions as the default Edit export size', () => {
  const options = defaultExportOptions({ width: 400, height: 300, cropRect: { x: 20, y: 30, width: 200, height: 100 } }, getStudioPreferences());
  expect(options.width).toBe(200);
  expect(options.height).toBe(100);
});
