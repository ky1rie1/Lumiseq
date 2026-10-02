import { inflateSync } from 'node:zlib';
import { assertSrgbProfile } from './icc.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33
    || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG signature');
  let offset = 8, header, ended = false, dataStarted = false, dataEnded = false;
  const blocks = [], metadata = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error('Truncated PNG chunk');
    const length = buffer.readUInt32BE(offset), end = offset + 12 + length;
    if (end > buffer.length) throw new Error('Truncated PNG data');
    const name = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, end - 4);
    if (crc32(buffer.subarray(offset + 4, end - 4)) !== buffer.readUInt32BE(end - 4)) throw new Error(`PNG CRC mismatch: ${name}`);
    if (!header && name !== 'IHDR') throw new Error('PNG must begin with IHDR');
    if (dataStarted && name !== 'IDAT') dataEnded = true;
    if (name === 'IHDR') {
      if (header || length !== 13) throw new Error('Invalid PNG IHDR');
      header = {width:body.readUInt32BE(0),height:body.readUInt32BE(4),bitDepth:body[8],channels:body[9] === 2 ? 3 : 4};
      if (!header.width || !header.height || ![8,16].includes(body[8]) || ![2,6].includes(body[9])
        || body[10] !== 0 || body[11] !== 0 || body[12] !== 0) throw new Error('Only noninterlaced RGB/RGBA PNG8/PNG16 is supported');
      const bytes = (header.width * header.channels * (header.bitDepth / 8) + 1) * header.height;
      if (!Number.isSafeInteger(bytes) || bytes > 512 * 1024 * 1024) throw new Error('PNG decoded data exceeds 512 MiB limit');
    } else if (name === 'IDAT') {
      if (dataEnded) throw new Error('PNG IDAT chunks must be consecutive');
      dataStarted = true; blocks.push(body);
    } else if (name === 'IEND') {
      if (length || !dataStarted || end !== buffer.length) throw new Error('Invalid PNG IEND');
      ended = true; break;
    } else if (name === 'iCCP') {
      const separator=body.indexOf(0);
      if(metadata.includes('iCCP') || dataStarted || separator<1 || separator>79 || body[separator+1]!==0) throw new Error('Invalid embedded color profile');
      assertSrgbProfile(inflateSync(body.subarray(separator+2),{maxOutputLength:1024*1024}));
      metadata.push(name);
    } else if (name === 'cICP') {
      throw new Error('Embedded color profile unsupported: cICP requires explicit conversion');
    } else if (name === 'tRNS') {
      throw new Error('PNG transparency key unsupported; export opaque RGB/RGBA');
    } else if (name === 'acTL') {
      throw new Error('Animated PNG unsupported');
    } else if (name === 'sRGB') {
      if (length !== 1 || body[0] > 3) throw new Error('Invalid PNG sRGB metadata');
      metadata.push(name);
    } else if (name === 'gAMA') {
      if (length !== 4 || body.readUInt32BE() !== 45455) throw new Error('PNG gamma conflicts with sRGB');
      metadata.push(name);
    } else if (name === 'cHRM') {
      const values = [31270,32900,64000,33000,30000,60000,15000,6000];
      if (length !== 32 || values.some((v,i) => body.readUInt32BE(i*4) !== v)) throw new Error('PNG chromaticities conflict with sRGB');
      metadata.push(name);
    } else if (/^[A-Z]/.test(name) && name !== 'PLTE') {
      throw new Error(`Unsupported critical PNG chunk: ${name}`);
    }
    offset = end;
  }
  if (!ended) throw new Error('Missing PNG IEND');
  const {width,height,channels,bitDepth} = header;
  const bpp = channels * bitDepth / 8, rowBytes = width * bpp;
  const expected = (rowBytes + 1) * height;
  const compressed = Buffer.concat(blocks);
  const raw = inflateSync(compressed, {maxOutputLength: expected});
  if (raw.length !== expected) throw new Error('PNG decompressed size mismatch');
  const decoded = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    if (filter > 4) throw new Error('Invalid PNG row filter');
    for (let x = 0; x < rowBytes; x++) {
      const i = y * rowBytes + x;
      const a = x >= bpp ? decoded[i - bpp] : 0;
      const b = y ? decoded[i - rowBytes] : 0;
      const c = y && x >= bpp ? decoded[i - rowBytes - bpp] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a,b,c);
      decoded[i] = (raw[y * (rowBytes + 1) + x + 1] + predictor) & 255;
    }
  }
  const samples = bitDepth === 16 ? new Uint16Array(width * height * channels) : new Uint8Array(decoded);
  if (bitDepth === 16) for (let i = 0; i < samples.length; i++) samples[i] = decoded.readUInt16BE(i * 2);
  return {...header,maxSample:bitDepth === 16 ? 65535 : 255,samples,metadata};
}
