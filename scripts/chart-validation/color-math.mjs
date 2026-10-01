// Original implementation under the repository MIT license. Formula: Sharma,
// Wu & Dalal (2005), doi:10.1002/col.20070. No research-only source copied.
const rad = d => d * Math.PI / 180;
const cos = d => Math.cos(rad(d));
const sin = d => Math.sin(rad(d));
const hue = (a, b) => a === 0 && b === 0 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
const triple = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

export function deltaE00(lab1, lab2) {
  if (!triple(lab1) || !triple(lab2)) throw new Error('Lab must contain three finite numbers');
  const [l1, a1, b1] = lab1, [l2, a2, b2] = lab2;
  const cMean = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + g), ap2 = a2 * (1 + g);
  const c1 = Math.hypot(ap1, b1), c2 = Math.hypot(ap2, b2);
  const h1 = hue(ap1, b1), h2 = hue(ap2, b2);
  const dl = l2 - l1, dc = c2 - c1;
  let dh = h2 - h1;
  if (c1 * c2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(c1 * c2) * sin(dh / 2);
  const lm = (l1 + l2) / 2, cm = (c1 + c2) / 2;
  let hm = (h1 + h2) / 2;
  if (c1 * c2 === 0) hm = h1 + h2;
  else if (Math.abs(h1 - h2) > 180) hm += h1 + h2 < 360 ? 180 : -180;
  const t = 1 - 0.17 * cos(hm - 30) + 0.24 * cos(2 * hm)
    + 0.32 * cos(3 * hm + 6) - 0.20 * cos(4 * hm - 63);
  const sl = 1 + 0.015 * (lm - 50) ** 2 / Math.sqrt(20 + (lm - 50) ** 2);
  const sc = 1 + 0.045 * cm, sh = 1 + 0.015 * cm * t;
  const rt = -2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7))
    * sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)));
  const x = dl / sl, y = dc / sc, z = dH / sh;
  const result = Math.sqrt(Math.max(0, x * x + y * y + z * z + rt * y * z));
  if (!Number.isFinite(result)) throw new Error('Lab difference exceeds supported numeric range');
  return result;
}

const multiply = (matrix, v) => matrix.map(row => row.reduce((sum, m, i) => sum + m * v[i], 0));
// sRGB primaries with D65 xy=(0.3127,0.3290), normalized Y=1.
const SRGB_XYZ_D65 = [
  [0.4123907992659595, 0.3575843393838780, 0.1804807884018343],
  [0.2126390058715104, 0.7151686787677560, 0.0721923153607337],
  [0.0193308187155918, 0.1191947797946260, 0.9505321522496607],
];
// Linear Bradford adaptation D65 -> D50 xy=(0.3457,0.3585).
const D65_D50 = [
  [1.0479298208405488, 0.0229467933410191, -0.0501922295431356],
  [0.0296278156881593, 0.9904344845732490, -0.0170738250293851],
  [-0.0092430581525912, 0.0150551448965779, 0.7518742814281371],
];
export const D50_WHITE_XYZ = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

export function srgbToLabD50(rgb) {
  if (!triple(rgb) || rgb.some(v => v < 0 || v > 1)) throw new Error('sRGB must contain three finite values in [0,1]');
  const linear = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const xyz = multiply(D65_D50, multiply(SRGB_XYZ_D65, linear));
  const f = xyz.map((v, i) => {
    const t = v / D50_WHITE_XYZ[i];
    return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
