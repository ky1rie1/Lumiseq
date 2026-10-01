import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppearancePreview } from './AppearancePreview';

describe('appearance workbench preview', () => {
  it('shows the current editor regions and live appearance values', () => {
    const html = renderToStaticMarkup(<AppearancePreview density="compact" motion="reduced" canvasBackground="#123456" />);
    expect(html).toContain('aria-label="专业工作台预览"');
    expect(html).toContain('data-density="compact"');
    expect(html).toContain('data-motion="reduced"');
    expect(html).toContain('settings-preview-toolrail');
    expect(html).toContain('settings-preview-layers');
    expect(html).toContain('background-color:#123456');
    expect(html).not.toContain('data-surface');
  });
});
