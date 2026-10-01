import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
async function fixture(task: (root: string, preload: string) => Promise<void>, response = 'verified bytes') {
  const root = await mkdtemp(path.join(tmpdir(), 'lumiseq-model-test-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'resources', 'cutout'), { recursive: true });
    await copyFile(path.resolve('scripts/prepare-cutout-model.mjs'), path.join(root, 'scripts', 'prepare-cutout-model.mjs'));
    const content = Buffer.from('verified bytes');
    await writeFile(path.join(root, 'resources', 'cutout', 'model.json'), JSON.stringify({ file: 'model.onnx', size: content.length, sha256: createHash('sha256').update(content).digest('hex'), url: 'https://example.com/pinned-model.onnx' }));
    const preload = path.join(root, 'mock-fetch.mjs');
    await writeFile(preload, `globalThis.fetch = async () => new Response(${JSON.stringify(response)});`);
    await task(root, pathToFileURL(preload).href);
  } finally { await rm(root, { recursive: true, force: true }); }
}
describe('explicit pinned model download', () => {
  it('promotes only verified downloaded bytes', async () => fixture(async (root, preload) => {
    await run(process.execPath, ['--import', preload, 'scripts/prepare-cutout-model.mjs', '--download'], { cwd: root });
    expect(await readFile(path.join(root, 'resources', 'cutout', 'model.onnx'), 'utf8')).toBe('verified bytes');
    expect((await readdir(path.join(root, 'resources', 'cutout'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  }));
  it('rejects corrupt downloads without leaving a model or temporary file', async () => fixture(async (root, preload) => {
    await expect(run(process.execPath, ['--import', preload, 'scripts/prepare-cutout-model.mjs', '--download'], { cwd: root })).rejects.toThrow('SHA-256 mismatch');
    expect(await readdir(path.join(root, 'resources', 'cutout'))).toEqual(['model.json']);
  }, 'corrupted data'));
  it('does not replace a pre-existing corrupt model by downloading over it', async () => fixture(async (root, preload) => {
    const file = path.join(root, 'resources', 'cutout', 'model.onnx');
    await writeFile(file, 'corrupt');
    await expect(run(process.execPath, ['--import', preload, 'scripts/prepare-cutout-model.mjs', '--download'], { cwd: root })).rejects.toThrow('incorrect size');
    expect(await readFile(file, 'utf8')).toBe('corrupt');
  }));
});
