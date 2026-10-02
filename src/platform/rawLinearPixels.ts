/** Bounded extended-linear sRGB working data. LF32 retains signed RGB and headroom. */
export interface RawLinearPixels { width: number; height: number; data: Uint16Array | Float32Array }

export function decodeRawLinearPixels(input: ArrayBuffer | Uint8Array | number[]): RawLinearPixels {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  const signature=String.fromCharCode(...bytes.subarray(0,4));
  if (bytes.length < 12 || !['LR16','LF32'].includes(signature)) throw new Error('Invalid native RAW linear buffer');
  const floating=signature==='LF32', stride=floating?16:8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(4, true), height = view.getUint32(8, true);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 6_000_000 || bytes.length !== 12 + width * height * stride) throw new Error('Invalid native RAW linear dimensions');
  const data = floating ? new Float32Array(width * height * 4) : new Uint16Array(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = floating ? view.getFloat32(12 + i * 4,true) : view.getUint16(12 + i * 2, true);
    if (!Number.isFinite(data[i]) || (floating && i%4===3 && (data[i]<0||data[i]>1))) throw new Error('Invalid nonfinite RAW sample or alpha');
  }
  return { width, height, data };
}

/** Bilinear sampling in linear space; pixel centers and edge clamping match WebGL. */
export function sampleRawLinearPixel(source: RawLinearPixels, x: number, y: number, width: number, height: number): [number,number,number,number] {
  const sx = Math.max(0, Math.min(source.width - 1, (x + .5) * source.width / width - .5));
  const sy = Math.max(0, Math.min(source.height - 1, (y + .5) * source.height / height - .5));
  const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(source.width - 1, x0 + 1), y1 = Math.min(source.height - 1, y0 + 1);
  const fx = sx - x0, fy = sy - y0;
  return [0,1,2,3].map(c => {
    const top = source.data[(y0 * source.width + x0)*4+c]*(1-fx) + source.data[(y0 * source.width + x1)*4+c]*fx;
    const bottom = source.data[(y1 * source.width + x0)*4+c]*(1-fx) + source.data[(y1 * source.width + x1)*4+c]*fx;
    return (top*(1-fy)+bottom*fy)/(source.data instanceof Float32Array?1:65535);
  }) as [number,number,number,number];
}
