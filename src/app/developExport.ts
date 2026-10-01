// src/app/developExport.ts
//! 调色工作区导出时选择正确的图像资源。
//!
//! 这里存在两个互不相通的资源 id 空间：
//!  - 前端 `AssetManager` 的 id（形如 `asset_<时间戳>_<随机>`），供 WebGL 预览引擎按 id 取图；
//!  - 原生 LibRaw 解码后登记在 Rust 侧 registry 的 id（`decode_raw_image` 返回的 `asset_id`），
//!    只有它才能被原生全分辨率导出 `export_raw_develop` 解析。
//! 之前 RAW 流水线丢弃了原生 id、把前端 id 写进文档，于是用户在选好保存位置后必然收到
//! “Asset ID ... not found in registry”。这个函数把选择规则收敛到一处，并在数据未就绪时
//! 明确报告不可用，而不是静默回退到注定失败的 id。

export type DevelopExportTarget =
  | { kind: 'native'; assetId: string }
  | { kind: 'preview'; assetId: string }
  | { kind: 'unavailable'; reason: string };

export interface DevelopExportSource {
  isRaw: boolean;
  /** 原生 LibRaw 解码资源的 id，仅当前会话有效。 */
  nativeAssetId?: string | null;
  /** 前端 AssetManager 中作为底图/预览的资源 id。 */
  sourceAssetId?: string;
  previewAssetId?: string;
}

/** 决定导出应当使用哪一个资源（纯桌面端原生处理）。 */
export function resolveDevelopExportTarget(
  source: DevelopExportSource
): DevelopExportTarget {
  const frontendAssetId = source.sourceAssetId || source.previewAssetId;

  if (source.isRaw) {
    if (source.nativeAssetId) return { kind: 'native', assetId: source.nativeAssetId };
    return {
      kind: 'unavailable',
      reason: 'RAW 解码数据尚未就绪，请等待状态显示「已就绪」后再导出。',
    };
  }

  if (frontendAssetId) return { kind: 'preview', assetId: frontendAssetId };

  return { kind: 'unavailable', reason: '当前文档还没有可用于导出的图像数据。' };
}
