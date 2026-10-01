import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveExportedImage } from './exportImage';
import type { IPlatformBridge } from '../platform/IPlatformBridge';

/** 假桥接：只覆盖本用例需要的成员，其余用 vi.fn() 占位。 */
const createBridge = (overrides: Partial<IPlatformBridge>): IPlatformBridge => ({
  isDesktop: false,
  openFileDialog: vi.fn(),
  saveFileDialog: vi.fn(),
  readBinaryFile: vi.fn(),
  writeBinaryFile: vi.fn(),
  getRawMetadata: vi.fn(),
  extractRawThumbnail: vi.fn(),
  decodeRawImage: vi.fn(),
  cancelRawDecode: vi.fn(),
  exportRawDevelop: vi.fn(),
  saveSecureSecret: vi.fn(),
  getSecureSecret: vi.fn(),
  hasSecureSecret: vi.fn(),
  deleteSecureSecret: vi.fn(),
  getPlatformInfo: () => ({ isDesktop: false, platform: 'test' }),
  ...overrides,
} as unknown as IPlatformBridge);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saveExportedImage', () => {
  it('桌面原生桥接：把导出字节直接写入目标文件路径', async () => {
    const writeBinaryFile = vi.fn(async (_filePath: string, _bytes: Uint8Array) => undefined);
    const bridge = createBridge({ isDesktop: true, writeBinaryFile });
    const blob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10])]);

    await saveExportedImage(bridge, blob, 'C:\\导出\\composite.png');

    expect(writeBinaryFile).toHaveBeenCalledTimes(1);
    const [targetPath, bytes] = writeBinaryFile.mock.calls[0];
    expect(targetPath).toBe('C:\\导出\\composite.png');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(blob.size);
    expect(bytes[0]).toBe(137);
  });
});
