import { describe, it, expect } from 'vitest';
import { resolveDevelopExportTarget } from './developExport';

const rawDoc = {
  isRaw: true,
  nativeAssetId: 'native_raw_asset_1',
  sourceAssetId: 'asset_1790070152846_3g3g9u6',
  previewAssetId: 'asset_1790070152846_3g3g9u6',
};

describe('resolveDevelopExportTarget', () => {
  it('桌面端 RAW 导出必须使用原生解码资源 id，而不是前端预览资源 id', () => {
    const target = resolveDevelopExportTarget(rawDoc);
    expect(target).toEqual({ kind: 'native', assetId: 'native_raw_asset_1' });
  });

  it('RAW 解码数据缺失时明确报不可用，不得回退到前端 id', () => {
    const target = resolveDevelopExportTarget({ ...rawDoc, nativeAssetId: undefined });
    expect(target.kind).toBe('unavailable');
    expect(target).toHaveProperty('reason');
    if (target.kind === 'unavailable') expect(target.reason).toContain('已就绪');
  });

  it('非 RAW 文档走前端渲染资源', () => {
    const target = resolveDevelopExportTarget({ isRaw: false, sourceAssetId: 'asset_abc' });
    expect(target).toEqual({ kind: 'preview', assetId: 'asset_abc' });
  });

  it('没有可用的图像资源时明确报不可用', () => {
    const target = resolveDevelopExportTarget({ isRaw: false });
    expect(target.kind).toBe('unavailable');
  });

  it('只有 previewAssetId 时也能作为前端渲染资源', () => {
    const target = resolveDevelopExportTarget({ isRaw: false, previewAssetId: 'asset_preview' });
    expect(target).toEqual({ kind: 'preview', assetId: 'asset_preview' });
  });
});
