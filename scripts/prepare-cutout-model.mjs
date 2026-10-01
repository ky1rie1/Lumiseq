import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const modelDir = path.join(root, 'resources', 'cutout');
const manifest = JSON.parse(await readFile(path.join(modelDir, 'model.json'), 'utf8'));

async function verify(file) {
  const metadata = await stat(file);
  if (metadata.size !== manifest.size) throw new Error(`Bundled cutout model has incorrect size: ${file}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== manifest.sha256) throw new Error(`Bundled cutout model SHA-256 mismatch: ${file}`);
}

async function downloadPinnedModel(destination) {
  if (!manifest.url.startsWith('https://')) throw new Error('Model source must use HTTPS.');
  const response = await fetch(manifest.url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);
  await mkdir(modelDir, { recursive: true });
  const temporary = path.join(modelDir, `.${manifest.file}.${process.pid}.tmp`);
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
    await verify(temporary);
    await rename(temporary, destination);
  } finally { await unlink(temporary).catch(() => {}); }
}

if (process.argv.includes('--verify-dist')) {
  const assets = path.join(root, 'dist', 'assets');
  const entries = await readdir(assets);
  const models = entries.filter(name => name.endsWith('.onnx'));
  if (models.length !== 1) throw new Error(`Expected one embedded model, found ${models.length}`);
  await verify(path.join(assets, models[0]));
  const runtimes = entries.filter(name => name.endsWith('.wasm'));
  if (runtimes.length !== 1) throw new Error(`Expected one shared GPU/CPU WASM runtime, found ${runtimes.length}`);
  console.log('[cutout] Production assets verified: one pinned model and one shared GPU/CPU WASM runtime.');
} else {
  const modelPath = path.join(modelDir, manifest.file);
  const existing = await stat(modelPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!existing) {
    if (process.argv.includes('--download')) await downloadPinnedModel(modelPath);
    else {
      const cachedModel = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'AI-Creative-Studio', 'cutout-validation', 'birefnet-lite-512-verified.onnx');
      if (!cachedModel) throw new Error(`Run npm run model:download or place the pinned model at ${modelPath}. Source: ${manifest.url}`);
      try { await verify(cachedModel); }
      catch { throw new Error(`Missing verified bundled weights. Run npm run model:download or place ${manifest.file} at ${modelDir}. Source: ${manifest.url}`); }
      await mkdir(modelDir, { recursive: true });
      await copyFile(cachedModel, modelPath);
    }
  }
  await verify(modelPath);
  console.log('[cutout] Bundled model size and SHA-256 verified.');
}
