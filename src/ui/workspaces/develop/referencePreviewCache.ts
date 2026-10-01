interface ReferencePreviewIdentity {
  documentId: string;
  assetId: string;
  nativeAssetId?: string | null;
  referenceId: string;
  width: number;
  height: number;
  cpuFallback: boolean;
  referenceSettings: unknown;
}

/** The live photo settings are intentionally absent: they do not change a fixed reference. */
export function referencePreviewKey(identity: ReferencePreviewIdentity): string {
  return JSON.stringify([
    identity.documentId, identity.assetId, identity.nativeAssetId, identity.referenceId,
    identity.width, identity.height, identity.cpuFallback, identity.referenceSettings,
  ]);
}

/** Records only a completed, current paint on the same canvas. */
export class ReferencePreviewCache<T extends object> {
  private last: { key: string; target: T } | null = null;

  async paintIfNeeded(key: string, target: T, paint: () => Promise<void>, isCurrent: () => boolean,
    resolvedKey: () => string = () => key): Promise<boolean> {
    if (!isCurrent() || (this.last?.key === key && this.last.target === target)) return false;
    try { await paint(); }
    catch (error) { this.invalidate(); throw error; }
    if (!isCurrent()) { this.invalidate(); return false; }
    this.last = { key: resolvedKey(), target };
    return true;
  }

  invalidate(): void { this.last = null; }
}
