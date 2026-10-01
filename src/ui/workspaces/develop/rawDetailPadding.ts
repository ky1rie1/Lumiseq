import type { RawDetailRegion } from './rawDetailRegion';

/** Read a halo, but display only pixels whose neighborhoods are fully available. */
export function paddedRawDetailRegion(
  wanted: RawDetailRegion, sourceWidth: number, sourceHeight: number, halo: number,
): { display: RawDetailRegion; read: RawDetailRegion } {
  halo = Math.max(0, Math.ceil(halo));
  const width = Math.min(wanted.width, Math.max(1, 4096 - 2 * halo));
  const height = Math.min(wanted.height, Math.max(1, 4096 - 2 * halo),
    Math.max(1, Math.floor(6_000_000 / (width + 2 * halo)) - 2 * halo));
  const x = Math.max(0, Math.min(sourceWidth - width, wanted.x + Math.floor((wanted.width - width) / 2)));
  const y = Math.max(0, Math.min(sourceHeight - height, wanted.y + Math.floor((wanted.height - height) / 2)));
  const left = Math.max(0, x - halo);
  const top = Math.max(0, y - halo);
  return {
    display: { x, y, width, height },
    read: { x: left, y: top, width: Math.min(sourceWidth, x + width + halo) - left,
      height: Math.min(sourceHeight, y + height + halo) - top },
  };
}
