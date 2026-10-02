import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readPeMetadata(data) {
  const requireBytes = (offset, count) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + count > data.length) throw new Error('Invalid or truncated PE binary.');
  };
  requireBytes(0, 64);
  if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid PE DOS signature.');
  const pe = data.readUInt32LE(0x3c);
  requireBytes(pe, 24);
  if (data.readUInt32LE(pe) !== 0x4550) throw new Error('Invalid PE signature.');
  const machine = data.readUInt16LE(pe + 4);
  const sectionCount = data.readUInt16LE(pe + 6);
  const optionalSize = data.readUInt16LE(pe + 20);
  const optional = pe + 24;
  requireBytes(optional, optionalSize);
  if (optionalSize < 96) throw new Error('Invalid PE optional header.');
  const magic = data.readUInt16LE(optional);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error('Unsupported PE optional header.');
  const directory = optional + (magic === 0x20b ? 112 : 96);
  const sectionTable = optional + optionalSize;
  requireBytes(sectionTable, sectionCount * 40);
  const rvaOffset = rva => {
    for (let index = 0; index < sectionCount; index++) {
      const section = sectionTable + index * 40;
      const virtualAddress = data.readUInt32LE(section + 12);
      const rawSize = data.readUInt32LE(section + 16);
      if (rva >= virtualAddress && rva - virtualAddress < rawSize) {
        const offset = data.readUInt32LE(section + 20) + rva - virtualAddress;
        requireBytes(offset, 1);
        return offset;
      }
    }
    throw new Error('Invalid PE import address.');
  };
  const imports = [];
  if (directory + 16 <= optional + optionalSize && data.readUInt32LE(directory + 8)) {
    const start = rvaOffset(data.readUInt32LE(directory + 8));
    let terminated = false;
    for (let index = 0; index < 1024; index++) {
      const descriptor = start + index * 20;
      requireBytes(descriptor, 20);
      if (data.subarray(descriptor, descriptor + 20).every(byte => byte === 0)) { terminated = true; break; }
      const nameStart = rvaOffset(data.readUInt32LE(descriptor + 12));
      const end = data.indexOf(0, nameStart);
      if (end < 0 || end - nameStart > 260) throw new Error('Invalid PE import name.');
      const name = data.toString('ascii', nameStart, end);
      if (!/^[\w.-]+\.dll$/i.test(name)) throw new Error('Invalid PE DLL import name.');
      imports.push(name);
    }
    if (!terminated) throw new Error('Unterminated PE import table.');
  }
  return { machine, subsystem: data.readUInt16LE(optional + 68), isDll: Boolean(data.readUInt16LE(pe + 22) & 0x2000), imports };
}

// These are Windows platform components, not files copied from a developer's PATH.
const systemDlls = new Set(['advapi32', 'bcrypt', 'bcryptprimitives', 'comctl32', 'comdlg32', 'crypt32',
  'd3d11', 'dcomp', 'dwmapi', 'dxgi', 'gdi32', 'imm32', 'kernel32', 'msvcrt', 'ntdll',
  'ole32', 'oleaut32', 'propsys', 'rpcrt4', 'secur32', 'shell32', 'shlwapi', 'ucrtbase',
  'user32', 'userenv', 'uxtheme', 'version', 'winhttp', 'winmm', 'winspool', 'ws2_32']);
const isSystemDll = name => /^(api-ms-win-|ext-ms-win-)[\w.-]+\.dll$/i.test(name) || systemDlls.has(name.toLowerCase().replace(/\.dll$/, ''));

function readBinary(file) {
  try { return readPeMetadata(readFileSync(file)); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${basename(file)} is missing; distribute the complete Windows package.`);
    throw error;
  }
}

export function verifyWindowsRelease(directory, executableName = 'lumiseq.exe') {
  if (basename(executableName) !== executableName || !executableName.endsWith('.exe')) throw new Error('Invalid executable filename.');
  const executable = readBinary(join(directory, executableName));
  if (executable.machine !== 0x8664 || executable.isDll || executable.subsystem !== 2) throw new Error('Release must be an x64 Windows GUI executable.');
  const loader = readBinary(join(directory, 'WebView2Loader.dll'));
  if (loader.machine !== executable.machine || !loader.isDll) throw new Error('WebView2Loader.dll architecture or DLL type does not match the x64 application.');
  for (const [file, metadata] of [[executableName, executable], ['WebView2Loader.dll', loader]]) {
    for (const dependency of metadata.imports) {
      if (dependency.toLowerCase() !== 'webview2loader.dll' && !isSystemDll(dependency)) {
        throw new Error(`${file} has an unbundled native dependency: ${dependency}.`);
      }
    }
  }
  return { files: [executableName, 'WebView2Loader.dll'], architecture: 'x64', subsystem: executable.subsystem };
}

export function stageWindowsRelease(source, destination, executableName = 'lumiseq.exe') {
  verifyWindowsRelease(source);
  if (basename(executableName) !== executableName || !executableName.endsWith('.exe')) throw new Error('Invalid executable filename.');
  mkdirSync(destination, { recursive: true });
  for (const [sourceName, destinationName] of [['lumiseq.exe', executableName], ['WebView2Loader.dll', 'WebView2Loader.dll']]) {
    const from = resolve(source, sourceName), to = resolve(destination, destinationName);
    if (from !== to) copyFileSync(from, to);
  }
  return verifyWindowsRelease(destination, executableName);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, source, destination, executableName] = process.argv.slice(2);
    if (!source || !['verify', 'stage'].includes(command) || (command === 'stage' && !destination)) throw new Error('Usage: windows-release.mjs verify <directory> [exe-name] | stage <source> <destination> [exe-name]');
    const result = command === 'stage' ? stageWindowsRelease(source, destination, executableName) : verifyWindowsRelease(source, destination);
    console.log(`Windows release verified: ${result.architecture}, GUI subsystem ${result.subsystem}, ${result.files.join(' + ')}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
