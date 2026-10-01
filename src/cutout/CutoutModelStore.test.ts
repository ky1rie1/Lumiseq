import { afterEach, describe, expect, it, vi } from 'vitest';
import { CutoutModelStore, defaultCutoutModelStore, verifyModelBytes, CUTOUT_MODEL } from './CutoutModelStore';

afterEach(() => vi.unstubAllGlobals());
const fixtureManifest = { size: 3, sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81' };

describe('pinned segmentation weights', () => {
  it('is ready without network access or IndexedDB on a fresh installation', async () => {
    const fetcher = vi.fn(() => { throw new Error('offline'); });
    vi.stubGlobal('fetch', fetcher); vi.stubGlobal('indexedDB', undefined);
    expect(await defaultCutoutModelStore.isInstalled()).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reads and verifies bundled bytes rather than a browser cache', async () => {
    const reader = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const store = new CutoutModelStore(reader, fixtureManifest);
    expect(await store.load()).toEqual(new Uint8Array([1, 2, 3]));
    expect(reader).toHaveBeenCalledOnce();
  });
  it('does not read a model after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    const reader = vi.fn(async () => new Uint8Array([1, 2, 3]));
    await expect(new CutoutModelStore(reader, fixtureManifest).load(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(reader).not.toHaveBeenCalled();
  });
  it('rejects cancellation during loading and tampered embedded bytes', async () => {
    const controller = new AbortController();
    const store = new CutoutModelStore(async () => { controller.abort(); return new Uint8Array([1, 2, 3]); }, fixtureManifest);
    await expect(store.load(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(new CutoutModelStore(async () => new Uint8Array([3, 2, 1]), fixtureManifest).load()).rejects.toThrow('校验');
  });
  it('uses an application resource URL and fails closed when it cannot be read', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(defaultCutoutModelStore.load()).rejects.toThrow('内置');
    expect(String(fetcher.mock.calls[0]?.[0])).toMatch(/birefnet-lite-512.*\.onnx/);
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('huggingface.co');
  });
  it('rejects wrong sizes and tampered weights before inference', async () => {
    await expect(verifyModelBytes(new Uint8Array([1]), CUTOUT_MODEL)).rejects.toThrow('大小');
    await expect(verifyModelBytes(new Uint8Array([1]), { ...CUTOUT_MODEL, size: 1 })).rejects.toThrow('校验');
  });
  it('uses a fixed revision and checksum so a changed server response cannot silently change the model', () => {
    expect(CUTOUT_MODEL.url).toContain('/4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7/');
    expect(CUTOUT_MODEL.inputSize).toBe(512);
    expect(CUTOUT_MODEL.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
