import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function validateReleaseVersions({ packageVersion, cargo, tauri, notes, noteName }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageVersion)) throw new Error('Package version must be stable SemVer');
  const packageSection = cargo.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const cargoVersion = /^version\s*=\s*"([^"]+)"\s*$/m.exec(packageSection ?? '')?.[1];
  if (cargoVersion !== packageVersion) throw new Error(`Cargo version ${cargoVersion} does not match ${packageVersion}`);
  if (![packageVersion, '../package.json'].includes(tauri.version)) throw new Error('Tauri version does not match package version');
  const notesVersion = /^#\s+Lumiseq\s+v?(\d+\.\d+\.\d+)\s*$/m.exec(notes)?.[1];
  if (noteName !== `v${packageVersion}.md` || notesVersion !== packageVersion) throw new Error('Release notes version does not match package version');
  return packageVersion;
}
export async function verifyReleaseVersionFiles(root) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  return validateReleaseVersions({ packageVersion: pkg.version, cargo: await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8'), tauri: JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')), notes: await readFile(path.join(root, `docs/releases/v${pkg.version}.md`), 'utf8'), noteName: `v${pkg.version}.md` });
}
