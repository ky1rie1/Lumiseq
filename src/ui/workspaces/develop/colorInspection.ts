/** Output warnings describe the displayed sRGB8 preview, never sensor clipping. */
export function clippingOverlay(source: Uint8ClampedArray, shadows: boolean, highlights: boolean) {
  const rgba = new Uint8ClampedArray(source.length);
  let low = 0, high = 0, sampled = 0;
  for (let i = 0; i + 3 < source.length; i += 4) {
    if (source[i+3] === 0) continue;
    sampled++;
    if (Math.max(source[i],source[i+1],source[i+2]) >= 254) {
      high++;
      if (highlights) rgba.set([245,82,74,Math.round(source[i+3]*.8)], i);
    } else if (Math.max(source[i],source[i+1],source[i+2]) <= 1) {
      low++;
      if (shadows) rgba.set([77,142,255,Math.round(source[i+3]*.8)], i);
    }
  }
  return { rgba, shadows:low, highlights:high, sampled };
}
export type ClippingCounts = Omit<ReturnType<typeof clippingOverlay>, 'rgba'>;

export function previewPixelAt(clientX:number,clientY:number,bounds:{left:number;top:number;width:number;height:number},width:number,height:number) {
  if (![clientX,clientY,bounds.left,bounds.top,bounds.width,bounds.height,width,height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || width < 1 || height < 1) return null;
  const x = (clientX-bounds.left)/bounds.width, y=(clientY-bounds.top)/bounds.height;
  if (x < 0 || y < 0 || x >= 1 || y >= 1) return null;
  return { x:Math.floor(x*width), y:Math.floor(y*height) };
}

/** sRGB / D65 -> Bradford D50 -> CIELAB, CIE 1931 2 degree observer. */
export function srgb8ToLabD50(rgb: readonly number[]): [number,number,number] {
  const [r,g,b]=rgb.map(value => {
    const encoded=Math.max(0,Math.min(255,value))/255;
    return encoded <= .04045 ? encoded/12.92 : ((encoded+.055)/1.055)**2.4;
  });
  // Bradford-adapted sRGB primaries, D50 PCS (ICC rounding precision).
  const x=(.4360747*r+.3850649*g+.1430804*b)/.96422;
  const y=.2225045*r+.7168786*g+.0606169*b;
  const z=(.0139322*r+.0971045*g+.7141733*b)/.82521;
  const f=(value:number)=>value>216/24389?Math.cbrt(value):(24389/27*value+16)/116;
  return [116*f(y)-16,500*(f(x)-f(y)),200*(f(y)-f(z))];
}
