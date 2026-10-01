import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { icon } from './brand/icon.mjs';
import { readmeBanner, readmeArchitecture } from './brand/readme.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = resolve(import.meta.dirname, '..');
const brandDir = resolve(root, 'src/assets/brand');
const tauriDir = resolve(root, 'src-tauri/icons');
const docsAssetDir = resolve(root, 'docs/assets');
await Promise.all([mkdir(brandDir, { recursive: true }), mkdir(tauriDir, { recursive: true }), mkdir(docsAssetDir, { recursive: true })]);

const appSvg = icon(false);
const markSvg = icon(true);
await Promise.all([
  writeFile(resolve(brandDir, 'lumiseq-app-icon.svg'), appSvg),
  writeFile(resolve(brandDir, 'lumiseq-mark.svg'), markSvg),
  writeFile(resolve(docsAssetDir, 'readme-banner.svg'), readmeBanner(markSvg)),
  writeFile(resolve(docsAssetDir, 'readme-architecture-light.svg'), readmeArchitecture()),
  writeFile(resolve(docsAssetDir, 'readme-architecture-dark.svg'), readmeArchitecture(true)),
]);

async function png(size) {
  return sharp(Buffer.from(icon(false, size))).png().toBuffer();
}

const rasterSizes = new Map(await Promise.all([16, 24, 32, 48, 64, 128, 256, 512].map(async size => [size, await png(size)])));
await Promise.all([
  writeFile(resolve(tauriDir, '32x32.png'), rasterSizes.get(32)),
  writeFile(resolve(tauriDir, '128x128.png'), rasterSizes.get(128)),
  writeFile(resolve(tauriDir, '128x128@2x.png'), rasterSizes.get(256)),
  writeFile(resolve(tauriDir, 'icon.png'), rasterSizes.get(512)),
]);

function createIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = headerSize;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

// Tauri decodes entry zero for the runtime window icon. Never put a tiny icon first.
const icoSizes = [64, 16, 24, 32, 48, 128, 256];
await writeFile(resolve(tauriDir, 'icon.ico'), createIco(icoSizes.map(size => ({ size, data: rasterSizes.get(size) }))));
console.log('Generated Lumiseq SVG, PNG, ICO, README cover, and architecture assets.');
