import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyWindowsRelease } from './windows-release.mjs';
import { verifyReleaseVersionFiles } from './release-version.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const output = path.join(root, 'artifacts', 'windows');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await verifyReleaseVersionFiles(root);
const executable = path.join(output, 'lumiseq.exe');
verifyWindowsRelease(output);
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
await append('RAW codecs / GoPro, Adobe DNG, XMP, Expat and Foveon', path.join(root, 'licenses', 'raw-codec-notices.txt'));
await append('Expat / GoPro SDK XML parser', path.join(root, 'licenses', 'Expat-COPYING.txt'));
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
await writeFile(path.join(output, 'LICENSE'), await readFile(path.join(root, 'LICENSE')));
await writeFile(path.join(output, 'README.txt'), `Lumiseq ${pkg.version} — Windows x64\n\nRecommended: use Lumiseq-${pkg.version}-windows-x64-setup.exe from the release page.\nThe installer checks for WebView2 Runtime and runs Microsoft's embedded\nbootstrapper when it is absent. Installing a missing Runtime requires internet.\n\nPortable ZIP: extract the entire package, then run lumiseq.exe.\nKeep WebView2Loader.dll in the same folder as lumiseq.exe.\nThe portable package requires an already installed WebView2 Runtime:\nhttps://developer.microsoft.com/en-us/microsoft-edge/webview2/\n\nIf Windows reports WebView2Loader.dll missing, restore it from this package.\nReinstalling the Runtime does not supply the application's loader DLL.\nDo not download DLLs from unrelated websites or put them in System32.\n\nThe application and installer are unsigned. Model weights are embedded for local cutout.\nConfigure AI connections in Settings; no credentials are included.\n\nSupport: https://github.com/ky1rie1/Lumiseq/issues\n`, 'utf8');
const lines = [];
async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `${hash.digest('hex')}  ${path.basename(file)}`;
}
for (const name of ['lumiseq.exe', 'WebView2Loader.dll', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'README.txt']) lines.push(await checksum(path.join(output, name)));
const checksumPath = path.join(output, 'SHA256SUMS.txt');
await writeFile(checksumPath, `${lines.join('\n')}\n`, 'utf8');
const { stdout: packageOutput } = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'package-portable.ps1'), '-Directory', output, '-Version', pkg.version]);
console.log(packageOutput.trim());
lines.push(await checksum(path.join(output, `Lumiseq-${pkg.version}-windows-x64.zip`)));
const installerName = `Lumiseq-${pkg.version}-windows-x64-setup.exe`;
const installers = (await readdir(output)).filter(name => /^Lumiseq-.*-windows-x64-setup\.exe$/.test(name));
if (installers.includes(installerName)) {
  const { stdout: installerVersion } = await run('powershell', ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:LUMISEQ_RELEASE_EXE).VersionInfo.FileVersion'], {
    env: { ...process.env, LUMISEQ_RELEASE_EXE: path.join(output, installerName) },
  });
  if (![pkg.version, `${pkg.version}.0`].includes(installerVersion.trim())) throw new Error('Installer version does not match this release.');
  lines.push(await checksum(path.join(output, installerName)));
}
await writeFile(checksumPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Prepared Lumiseq ${pkg.version}: complete x64 portable ZIP, loader, dependency notices and SHA-256 checksums verified.`);
