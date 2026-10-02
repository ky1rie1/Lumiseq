import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const output = path.join(root, 'artifacts', 'windows');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const executable = path.join(output, 'lumiseq.exe');
const { stdout: binaryVersion } = await run('powershell', ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:LUMISEQ_RELEASE_EXE).VersionInfo.FileVersion'], {
  env: { ...process.env, LUMISEQ_RELEASE_EXE: executable },
});
const binaryParts = binaryVersion.trim().split('.');
if (binaryParts.length === 4 && binaryParts[3] === '0') binaryParts.pop();
if (binaryParts.join('.') !== pkg.version) {
  throw new Error(`EXE version ${binaryVersion.trim()} does not match ${pkg.version}. Rebuild the release first.`);
}

const sections = [];
const missingLicenses = [];
async function append(label, file) { sections.push(`\n\n=== ${label} ===\n\n${await readFile(file, 'utf8')}`); }
await append('Lumiseq MIT License', path.join(root, 'LICENSE'));
await append('Component inventory', path.join(root, 'THIRD_PARTY_NOTICES.md'));
await append('ONNX Runtime and BiRefNet upstream notices', path.join(root, 'licenses', 'model-runtime-notices.txt'));
await append('Noto Sans SC', path.join(root, 'public', 'fonts', 'OFL-NotoSansSC.txt'));
await append('README lettering / Manrope', path.join(root, 'licenses', 'OFL-Manrope.txt'));
await append('README lettering / Caveat', path.join(root, 'licenses', 'OFL-Caveat.txt'));
for (const file of ['COPYRIGHT', 'LICENSE.CDDL', 'LICENSE.LGPL']) {
  await append(`LibRaw ${file}`, path.join(root, 'src-tauri', 'native', 'libraw', file));
}

async function dependencyNotices(label, directory, license) {
  sections.push(`\n\n=== ${label} ===\nDeclared license: ${license || 'See upstream license text'}\n`);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(item => item.isFile() && /^(licen[sc]e|copying|notice)([.\-_]|$)/i.test(item.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!files.length) {
    if (label === 'npm onnxruntime-common@1.30.0' || label === 'npm onnxruntime-web@1.30.0') {
      sections.push('License text is included in the ONNX Runtime upstream notices above.\n');
      return;
    }
    const supplemental = path.join(root, 'licenses', 'dependency-texts', `${label.replace(/[^\w.-]/g, '_')}.txt`);
    try { await append(`${label} / upstream license omitted from package archive`, supplemental); }
    catch (error) { if (error.code !== 'ENOENT') throw error; missingLicenses.push(label); }
  }
  for (const file of files) await append(`${label} / ${file.name}`, path.join(directory, file.name));
}
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const [relative, entry] of Object.entries(lock.packages)) {
  if (!relative || entry.dev || !relative.startsWith('node_modules/')) continue;
  const directory = path.join(root, relative);
  let installed;
  try { installed = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); }
  catch (error) { if (entry.optional && error.code === 'ENOENT') continue; throw error; }
  await dependencyNotices(`npm ${installed.name}@${installed.version}`, directory, installed.license);
}
const { stdout } = await run('cargo', ['metadata', '--locked', '--offline', '--filter-platform', 'x86_64-pc-windows-gnu', '--format-version', '1', '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml')], { maxBuffer: 16 * 1024 * 1024 });
const metadata = JSON.parse(stdout);
for (const item of metadata.packages.sort((a, b) => a.name.localeCompare(b.name))) {
  if (!item.source) continue;
  await dependencyNotices(`Rust ${item.name}@${item.version}`, path.dirname(item.manifest_path), item.license);
}
if (missingLicenses.length) throw new Error(`Missing dependency license texts:\n${missingLicenses.join('\n')}`);
await mkdir(output, { recursive: true });
const noticePath = path.join(output, 'THIRD_PARTY_NOTICES.txt');
await writeFile(noticePath, `Lumiseq ${pkg.version} — release license notices\nGenerated from locked dependencies for the Windows GNU target, including build tools.\n${sections.join('')}`, 'utf8');
const lines = [];
for (const file of [executable, noticePath]) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${path.basename(file)}`);
}
await writeFile(path.join(output, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
console.log(`Prepared Lumiseq ${pkg.version}: EXE version matched, dependency license texts and SHA-256 checksums generated.`);
