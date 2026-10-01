// src/app/exportImage.ts
//! 导出落盘：桌面端原生写入真实文件。

import type { IPlatformBridge } from '../platform/IPlatformBridge';

/** Persists an exported image: writes directly to the native disk path via platform bridge. */
export async function saveExportedImage(
  bridge: IPlatformBridge,
  blob: Blob,
  targetPath: string,
): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await bridge.writeBinaryFile(targetPath, bytes);
}
