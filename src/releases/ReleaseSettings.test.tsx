import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReleaseNotes } from './ReleaseSettings';
describe('bounded release notes rendering', () => {
  it('renders untrusted markup and remote images as inert text', () => {
    const html = renderToStaticMarkup(<ReleaseNotes notes={'# 更新\n<script>alert(1)</script>\n<img src="https://evil.test/a">\n![image](https://evil.test/x)\n[bad](javascript:alert)\n[official](https://github.com/ky1rie1/Lumiseq/releases/tag/v0.9.7)'} onOpen={() => {}} />);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('official'); expect(html).toContain('<button');
  });
});
