import { LayerMask, LayerTransform } from '../types/edit';
export type Affine = [number, number, number, number, number, number];
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
export function multiplyMatrix(p: Affine, q: Affine): Affine {
  return [p[0]*q[0]+p[2]*q[1], p[1]*q[0]+p[3]*q[1], p[0]*q[2]+p[2]*q[3], p[1]*q[2]+p[3]*q[3], p[0]*q[4]+p[2]*q[5]+p[4], p[1]*q[4]+p[3]*q[5]+p[5]];
}
export function layerMatrix(t: LayerTransform): Affine {
  if (![t.x,t.y,t.width,t.height,t.rotation,t.scaleX,t.scaleY].every(Number.isFinite)) throw new Error('Invalid layer transform.');
  const r = t.rotation * Math.PI / 180;
  return [Math.cos(r)*t.scaleX, Math.sin(r)*t.scaleX, -Math.sin(r)*t.scaleY, Math.cos(r)*t.scaleY, t.x, t.y];
}
export function inverseMatrix(m: Affine): Affine {
  const det = m[0]*m[3]-m[1]*m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('Layer transform cannot be inverted.');
  return [m[3]/det, -m[1]/det, -m[2]/det, m[0]/det, (m[2]*m[5]-m[3]*m[4])/det, (m[1]*m[4]-m[0]*m[5])/det];
}

export function validateMaskReference(mask: LayerMask): void {
  if (mask.referenceTransform === undefined && mask.referenceWidth === undefined && mask.referenceHeight === undefined) return;
  if (!Array.isArray(mask.referenceTransform) || mask.referenceTransform.length !== 6 || !mask.referenceTransform.every(Number.isFinite)
    || !Number.isFinite(mask.referenceWidth) || mask.referenceWidth! <= 0 || !Number.isFinite(mask.referenceHeight) || mask.referenceHeight! <= 0) throw new Error('Invalid linked mask reference transform or dimensions.');
  inverseMatrix(mask.referenceTransform);
}

/** Map a mask captured in original document coordinates into its layer's current document coordinates. */
export function linkedMaskTransform(world: Affine, mask: LayerMask, transform: LayerTransform): Affine {
  validateMaskReference(mask);
  if (!mask.linked || !mask.referenceTransform) return [...IDENTITY];
  if (!Number.isFinite(transform.width) || transform.width <= 0 || !Number.isFinite(transform.height) || transform.height <= 0) throw new Error('Invalid linked mask current dimensions.');
  const resize: Affine = [transform.width / mask.referenceWidth!, 0, 0, transform.height / mask.referenceHeight!, 0, 0];
  const result = multiplyMatrix(multiplyMatrix(world, resize), inverseMatrix(mask.referenceTransform));
  if (!result.every(Number.isFinite)) throw new Error('Linked mask mapping is outside supported numeric coordinates.');
  return result;
}
