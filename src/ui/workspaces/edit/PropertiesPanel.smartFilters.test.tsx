import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createSmartObjectLayer } from '../../../document/EditDocument';
import { createSmartFilter } from '../../../filters/smartFilters';
import { PropertiesPanel } from './PropertiesPanel';

describe('Smart Object properties inspector', () => {
  it('keeps common Smart Filter actions and parameters visible', () => {
    const layer = createSmartObjectLayer({ sourceAssetId: 'asset', originalWidth: 640, originalHeight: 480 });
    layer.smartFilters = [
      createSmartFilter('unsharp_mask', { id: 'sharpen', settings: { radius: 2, amount: 1.2, threshold: 5 } }),
      createSmartFilter('noise_reduction', { id: 'denoise', enabled: false }),
    ];
    const html = renderToStaticMarkup(
      <PropertiesPanel
        selectedLayer={layer}
        onUpdateAdjustment={() => {}}
        onUpdateTransform={() => {}}
        onUpdateOpacity={() => {}}
        onUpdateBlendMode={() => {}}
        onAddSmartFilter={() => {}}
        onUpdateSmartFilter={() => {}}
        onSetSmartFilterEnabled={() => {}}
        onRemoveSmartFilter={() => {}}
        onReorderSmartFilter={() => {}}
      />,
    );

    expect(html).toContain('智能滤镜');
    expect(html).toContain('添加智能滤镜');
    expect(html).toContain('智能锐化');
    expect(html).toContain('降噪');
    expect(html).toContain('关闭智能锐化');
    expect(html).toContain('启用降噪');
    expect(html).toContain('智能锐化阈值');
    expect(html).toContain('删除降噪');
  });
});
