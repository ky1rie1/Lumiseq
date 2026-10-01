/** Stored Edit zoom is relative to the fit scale, so large documents need values above five. */
export function clampEditZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.max(0.01, Math.min(128, zoom)) : 1;
}
