import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('provides a sharp default Windows icon and complete DPI variants', () => {
  const ico = readFileSync('src-tauri/icons/icon.ico');
  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256);
  // Tauri codegen decodes the first ICO entry as its runtime window icon.
  expect(sizes[0]).toBeGreaterThanOrEqual(64);
  expect([...sizes].sort((a, b) => a - b)).toEqual([16, 24, 32, 48, 64, 128, 256]);
  for (let i = 0; i < count; i++) {
    const offset = ico.readUInt32LE(6 + i * 16 + 12);
    expect(ico.subarray(offset + 1, offset + 4).toString()).toBe('PNG');
    expect(ico.readUInt32BE(offset + 16)).toBe(sizes[i]);
    expect(ico.readUInt32BE(offset + 20)).toBe(sizes[i]);
  }
});
