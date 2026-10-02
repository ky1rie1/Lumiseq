import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPeMetadata, verifyWindowsRelease, stageWindowsRelease } from '../scripts/windows-release.mjs';

function pe({ machine = 0x8664, dll = false, subsystem = 2, imports = [] } = {}) {
  const data = Buffer.alloc(0x600);
  data.write('MZ');
  data.writeUInt32LE(0x80, 0x3c);
  data.write('PE\0\0', 0x80, 'binary');
  data.writeUInt16LE(machine, 0x84);
  data.writeUInt16LE(1, 0x86);
  data.writeUInt16LE(240, 0x94);
  data.writeUInt16LE(dll ? 0x2000 : 2, 0x96);
  const optional = 0x98;
  data.writeUInt16LE(0x20b, optional);
  data.writeUInt16LE(subsystem, optional + 68);
  data.writeUInt32LE(16, optional + 108);
  const section = optional + 240;
  data.writeUInt32LE(0x400, section + 8);
  data.writeUInt32LE(0x1000, section + 12);
  data.writeUInt32LE(0x400, section + 16);
  data.writeUInt32LE(0x200, section + 20);
  if (imports.length) {
    data.writeUInt32LE(0x1000, optional + 120);
    data.writeUInt32LE((imports.length + 1) * 20, optional + 124);
    imports.forEach((name, index) => {
      data.writeUInt32LE(0x1100 + index * 64, 0x200 + index * 20 + 12);
      data.write(name + '\0', 0x300 + index * 64);
    });
  }
  return data;
}

function temporary(run) {
  const directory = mkdtempSync(join(tmpdir(), 'lumiseq-release-'));
  try { return run(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('Windows release dependency gate', () => {
  it('reads the native architecture, GUI subsystem and DLL imports', () => {
    expect(readPeMetadata(pe({ imports: ['KERNEL32.dll', 'WebView2Loader.dll'] }))).toEqual({
      machine: 0x8664, subsystem: 2, isDll: false, imports: ['KERNEL32.dll', 'WebView2Loader.dll'],
    });
  });
  it('rejects an EXE-only publication even when WebView2 Runtime is installed', () => temporary(directory => {
    writeFileSync(join(directory, 'lumiseq.exe'), pe({ imports: ['WebView2Loader.dll'] }));
    expect(() => verifyWindowsRelease(directory)).toThrow(/WebView2Loader\.dll.*missing/i);
  }));
  it('rejects the wrong loader architecture', () => temporary(directory => {
    writeFileSync(join(directory, 'lumiseq.exe'), pe({ imports: ['WebView2Loader.dll'] }));
    writeFileSync(join(directory, 'WebView2Loader.dll'), pe({ machine: 0x14c, dll: true }));
    expect(() => verifyWindowsRelease(directory)).toThrow(/architecture/i);
  }));
  it('rejects an unresolved additional native dependency', () => temporary(directory => {
    writeFileSync(join(directory, 'lumiseq.exe'), pe({ imports: ['WebView2Loader.dll', 'libgcc_s_seh-1.dll'] }));
    writeFileSync(join(directory, 'WebView2Loader.dll'), pe({ dll: true }));
    expect(() => verifyWindowsRelease(directory)).toThrow(/libgcc_s_seh-1.dll/);
  }));
  it('checks loader dependencies too', () => temporary(directory => {
    writeFileSync(join(directory, 'lumiseq.exe'), pe({ imports: ['WebView2Loader.dll'] }));
    writeFileSync(join(directory, 'WebView2Loader.dll'), pe({ dll: true, imports: ['unexpected.dll'] }));
    expect(() => verifyWindowsRelease(directory)).toThrow(/unexpected.dll/);
  }));
  it('stages the matching EXE and loader together', () => temporary(source => temporary(destination => {
    const executable = pe({ imports: ['WebView2Loader.dll', 'KERNEL32.dll'] });
    const loader = pe({ dll: true, imports: ['ole32.dll'] });
    writeFileSync(join(source, 'lumiseq.exe'), executable);
    writeFileSync(join(source, 'WebView2Loader.dll'), loader);
    stageWindowsRelease(source, destination);
    expect(readFileSync(join(destination, 'lumiseq.exe'))).toEqual(executable);
    expect(readFileSync(join(destination, 'WebView2Loader.dll'))).toEqual(loader);
    expect(verifyWindowsRelease(destination).files).toEqual(['lumiseq.exe', 'WebView2Loader.dll']);
  })));
  it('rejects invalid binaries and console releases', () => temporary(directory => {
    expect(() => readPeMetadata(Buffer.from('not PE'))).toThrow(/PE/i);
    writeFileSync(join(directory, 'lumiseq.exe'), pe({ subsystem: 3 }));
    writeFileSync(join(directory, 'WebView2Loader.dll'), pe({ dll: true }));
    expect(() => verifyWindowsRelease(directory)).toThrow(/GUI/i);
  }));
});
