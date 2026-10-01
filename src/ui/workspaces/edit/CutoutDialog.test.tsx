import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEditDocument, createImageLayer } from '../../../document/EditDocument';
import { CutoutDialog } from './CutoutDialog';

describe('cutout workbench', () => {
  const layer = createImageLayer({ name: '原始照片', sourceAssetId: 'photo', naturalWidth: 400, naturalHeight: 200 });
  const doc = createEditDocument({ width: 400, height: 200, layers: [layer] });
  const markup = () => renderToStaticMarkup(<CutoutDialog doc={doc} layer={layer} onClose={() => {}} />);
  it('keeps recognition, repair and application as clearly named separate operations', () => {
    const html = markup();
    expect(html).toContain('aria-label="自动抠图"');
    expect(html).toContain('局部修补');
    expect(html).toContain('边缘调整');
    expect(html).toContain('aria-label="查看抠图结果"');
    expect(html).toContain('aria-label="查看原图"');
    expect(html).toContain('class="cutout-footer"');
    expect(html).not.toContain('离线可用 · MIT');
  });
  it('starts in view mode and explains how to enable brush repairs', () => {
    expect(markup()).toContain('aria-label="查看与拖动" aria-pressed="true"');
    expect(markup()).toContain('切换到补回或擦除后，在图像上涂抹。');
  });
});
