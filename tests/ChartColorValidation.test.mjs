import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { decodePng } from '../scripts/chart-validation/png.mjs';
import { measureChart } from '../scripts/chart-validation/measure.mjs';
import { deltaE00, srgbToLabD50 } from '../scripts/chart-validation/color-math.mjs';

// Numeric facts from Sharma/Wu/Dalal supplementary data, not their MATLAB code.
const pairs = readFileSync(new URL('./fixtures/ciede2000-sharma.txt', import.meta.url), 'utf8')
  .trim().split(/\r?\n/).map(row => row.trim().split(/\s+/).map(Number));

describe('published CIEDE2000 numerical regression', () => {
  it.each(pairs.map((v, i) => [i + 1, v]))('matches supplementary pair %i', (_, v) => {
    expect(Math.abs(deltaE00(v.slice(0, 3), v.slice(3, 6)) - v[6])).toBeLessThan(0.00005);
    expect(Math.abs(deltaE00(v.slice(3, 6), v.slice(0, 3)) - v[6])).toBeLessThan(0.00005);
  });
  it('returns zero for identical colors and rejects nonfinite inputs', () => {
    expect(deltaE00([30, -2, 10], [30, -2, 10])).toBe(0);
    expect(() => deltaE00([NaN, 0, 0], [0, 0, 0])).toThrow();
    expect(() => deltaE00([2, 3], [0, 0, 0])).toThrow();
  });
  it('rejects numeric overflow instead of emitting a null JSON color score', () => {
    expect(() => deltaE00([50,1e100,1e100],[50,0,0])).toThrow(/numeric range/);
  });
});

// Test-only PNG writer: fixtures keep explicit decoded pixel expectations.
function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const body = Buffer.concat([Buffer.from(name), data]);
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(body));
  return Buffer.concat([size, body, checksum]);
}
function png(raw, { width = 1, height = 1, bitDepth = 16, colorType = 2, interlace = 0, extra = [] } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = bitDepth; header[9] = colorType; header[12] = interlace;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    ...extra, chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
}
describe('PNG sample precision and filter decoding', () => {
  it('retains 16 bit sample values without conversion through eight bits', () => {
    const image = decodePng(png([0,0x12,0x34,0x45,0x67,0x89,0xab]));
    expect(image).toMatchObject({ width: 1, height: 1, bitDepth: 16, channels: 3, maxSample: 65535 });
    expect(Array.from(image.samples)).toEqual([4660,17767,35243]);
  });
  it('allows 45 megapixel PNG16 dimensions before validating the scanline payload', () => {
    // The available chart camera RAW is 8256x5504; no giant test allocation needed.
    expect(() => decodePng(png([0,0,0,0,0,0,0],{width:8256,height:5504}))).toThrow(/decompressed size mismatch/);
  });
  it.each([
    [0, [10,20,30,40,50,60], [70,80,90,100,110,120]],
    [1, [10,20,30,30,30,30], [70,80,90,30,30,30]],
    [2, [10,20,30,40,50,60], [60,60,60,60,60,60]],
    [3, [10,20,30,35,40,45], [65,70,75,45,45,45]],
    [4, [10,20,30,30,30,30], [60,60,60,30,30,30]],
  ])('reconstructs row filter %i', (filter, row1, row2) => {
    const image = decodePng(png([filter,...row1,filter,...row2], {width:2,height:2,bitDepth:8}));
    expect(Array.from(image.samples)).toEqual([10,20,30,40,50,60,70,80,90,100,110,120]);
  });
  it('rejects corrupted CRC, truncated data, invalid filter and unsupported profile/encodings', () => {
    const valid = png([0,0,0,0,0,0,0]);
    const broken = Buffer.from(valid); broken[29] ^= 1;
    expect(() => decodePng(broken)).toThrow(/CRC/);
    expect(() => decodePng(valid.subarray(0, valid.length - 3))).toThrow();
    expect(() => decodePng(png([5,0,0,0,0,0,0]))).toThrow(/filter/);
    expect(() => decodePng(png([0,0,0], {colorType:0}))).toThrow();
    expect(() => decodePng(png([0,0,0,0,0,0,0], {interlace:1}))).toThrow();
    expect(() => decodePng(png([0,0,0,0,0,0,0], {extra:[chunk('iCCP', Buffer.from('x'))]}))).toThrow(/profile/);
    expect(() => decodePng(png([0,0,0,0,0,0,0], {extra:[chunk('tRNS', Buffer.alloc(6))]}))).toThrow(/transparency/);
  });
});

const manifest = () => ({
  schemaVersion: 1, inputColorSpace: 'sRGB', capture: 'unit test fixture; no physical camera validation',
  exportSettings: 'test PNG16', reference: { chart: 'synthetic numeric checks', source: 'test literals',
    illuminant: 'D50', white: 'D50', observer: '2deg' },
  patches: [{ id: 'gray', roi: [0,0,3,1], lab: [53.389,0,0] }],
});
const image = () => ({width:3,height:1,channels:3,bitDepth:16,maxSample:65535,
  samples: new Uint16Array([32767,32767,32767,32768,32768,32768,65535,0,65535])});
describe('chart measurement provenance and robustness', () => {
  it('measures channel medians and retains endpoint clipping evidence', () => {
    const report = measureChart(image(), manifest());
    expect(report.patches[0].medianRgb).toEqual([32768/65535,32767/65535,32768/65535]);
    // Channel medians differ by one 16-bit code; allow quantization and rounded Lab.
    expect(report.patches[0].deltaE00).toBeLessThan(0.005);
    expect(report.patches[0].clipping).toEqual({lowChannels:[0,1,0],highChannels:[1,0,1],pixels:1,fraction:1/3});
    expect(report.summary.count).toBe(1);
    expect(report.summary.mean).toBe(report.patches[0].deltaE00);
    expect(report.summary.p95).toBe(report.patches[0].deltaE00);
    expect(report.summary.max).toBe(report.patches[0].deltaE00);
    expect(report.reference).toEqual(manifest().reference);
  });
  it('uses interpolated p95 and includes clipped patches in the aggregate', () => {
    const spec = manifest();
    spec.patches = [{id:'black',roi:[0,0,1,1],lab:[0,0,0]}, {id:'error',roi:[0,0,1,1],lab:[100,0,0]}];
    const report = measureChart({width:1,height:1,channels:3,bitDepth:8,maxSample:255,samples:new Uint8Array([0,0,0])},spec);
    expect(report.summary).toEqual({count:2,mean:50,p95:95,max:100,clippedPatches:2});
  });
  it('rejects absent source, mismatched reference white, bad ROI and duplicate IDs', () => {
    for (const change of [m=>m.reference.source='',m=>m.reference.white='D65',m=>m.reference.observer='10deg',
      m=>m.inputColorSpace='AdobeRGB',m=>m.patches[0].roi=[-1,0,3,1],m=>m.patches[0].roi=[0,0,0,1],
      m=>m.patches[0].lab=[Infinity,0,0],m=>m.patches.push(m.patches[0])]) {
      const spec = manifest(); change(spec);
      expect(() => measureChart(image(),spec)).toThrow();
    }
  });
  it('rejects transparent pixels so compositing cannot silently bias measurement', () => {
    const spec = manifest(); spec.patches[0].roi=[0,0,1,1];
    expect(() => measureChart({width:1,height:1,channels:4,bitDepth:8,maxSample:255,samples:new Uint8Array([128,128,128,254])},spec)).toThrow(/opaque/);
  });
});

describe('offline chart CLI', () => {
  it('writes an auditable PNG16 report and fails closed for bad reference metadata', () => {
    const directory = mkdtempSync(join(tmpdir(),'lumiseq-chart-test-'));
    try {
      const input=join(directory,'export.png'),specPath=join(directory,'reference.json'),output=join(directory,'report.json');
      writeFileSync(input,png([0,0x80,0,0x80,0,0x80,0]));
      const spec=manifest();spec.patches[0].roi=[0,0,1,1];
      writeFileSync(specPath,JSON.stringify(spec));
      const cli=fileURLToPath(new URL('../scripts/validate-chart-color.mjs',import.meta.url));
      const result=spawnSync(process.execPath,[cli,input,specPath,output],{encoding:'utf8'});
      expect(result.status,result.stderr).toBe(0);
      const report=JSON.parse(readFileSync(output,'utf8'));
      expect(report.image.bitDepth).toBe(16);
      expect(report.patches[0].medianRgb).toEqual([32768/65535,32768/65535,32768/65535]);
      expect(report.input.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(report.input.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(report.input.imagePath).toBe(input);
      expect(report.validationScope).toMatch(/does not establish/);
      spec.reference.white='D65';writeFileSync(specPath,JSON.stringify(spec));
      const invalidOutput=join(directory,'invalid.json');
      const bad=spawnSync(process.execPath,[cli,input,specPath,invalidOutput],{encoding:'utf8'});
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/D50/);
      expect(()=>readFileSync(invalidOutput)).toThrow();
      const overwrite=spawnSync(process.execPath,[cli,input,specPath,input],{encoding:'utf8'});
      expect(overwrite.status).toBe(1);
      expect(overwrite.stderr).toMatch(/overwrite/);
    } finally { rmSync(directory,{recursive:true,force:true}); }
  });
});

describe('sRGB D65 through Bradford to Lab D50', () => {
  it.each([
    [[1, 1, 1], [100, 0, 0]],
    [[0, 0, 0], [0, 0, 0]],
    // Independent reference values: CSS Color 4 sample conversion, rounded.
    [[1, 0, 0], [54.29, 80.81, 69.89]],
    [[0, 1, 0], [87.82, -79.29, 80.99]],
    [[0, 0, 1], [29.57, 68.30, -112.03]],
    [[0.5, 0.5, 0.5], [53.389, 0, 0]],
  ])('converts %j with the correct white and transfer function', (rgb, expected) => {
    srgbToLabD50(rgb).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 1));
  });
  it('rejects out of gamut and nonfinite samples instead of clipping', () => {
    expect(() => srgbToLabD50([-0.1, 0, 0])).toThrow();
    expect(() => srgbToLabD50([1.1, 0, 0])).toThrow();
    expect(() => srgbToLabD50([0, Infinity, 0])).toThrow();
  });
});
