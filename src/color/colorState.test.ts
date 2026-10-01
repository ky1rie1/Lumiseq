import { describe, expect, it } from 'vitest';
import { rgbToHsl, hslToRgb, normalizeHexColor } from './colorState';

describe('picker color precision', () => {
  it('accepts standard HEX input and refuses incomplete or invalid values', () => {
    expect(normalizeHexColor(' AbC ')).toBe('#aabbcc');
    expect(normalizeHexColor('#1167E7')).toBe('#1167e7');
    for (const value of ['#12', '#zzzzzz', '#12345678', '']) expect(normalizeHexColor(value)).toBeNull();
  });
  it.each([[17, 103, 231], [121, 72, 37], [254, 1, 128], [51, 52, 53]])('keeps RGB %s/%s/%s unchanged when reading and reapplying HSL', (r, g, b) => {
    const hsl = rgbToHsl(r, g, b);
    expect(hslToRgb(hsl.h, hsl.s, hsl.l)).toEqual({ r, g, b });
  });
});
