import { describe, expect, it } from 'vitest';
import { CutoutBackendSession, probeCutoutGpu, type CutoutBackend } from './cutoutBackend';

type Session = { backend: CutoutBackend; release(): Promise<void> };
const session = (backend: CutoutBackend): Session => ({ backend, async release() {} });

describe('per-machine cutout backend', () => {
  it('uses CPU when WebGPU is absent', async () => {
    expect(await probeCutoutGpu(undefined)).toMatchObject({ backend: 'wasm', fallbackReason: expect.any(String) });
  });
  it('uses an available hardware adapter without relying on its vendor', async () => {
    const adapter = { isFallbackAdapter: false };
    expect(await probeCutoutGpu({ async requestAdapter() { return adapter; } })).toEqual({ backend: 'webgpu', adapter });
  });
  it('falls back when adapter request fails, returns null, or only software is available', async () => {
    for (const gpu of [
      { async requestAdapter() { throw new Error('driver unavailable'); } },
      { async requestAdapter() { return null; } },
      { async requestAdapter() { return { isFallbackAdapter: true }; } },
    ]) expect(await probeCutoutGpu(gpu)).toMatchObject({ backend: 'wasm', fallbackReason: expect.any(String) });
  });
  it('recognizes software adapters exposed through modern adapter info', async () => {
    expect(await probeCutoutGpu({ async requestAdapter() { return { info: { isFallbackAdapter: true } }; } }))
      .toMatchObject({ backend: 'wasm', fallbackReason: expect.any(String) });
  });
  it('reports GPU only after GPU session initialization succeeds', async () => {
    const runtime = await CutoutBackendSession.create({ backend: 'webgpu', adapter: {} }, async backend => session(backend));
    expect(await runtime.run(async value => value.backend)).toBe('webgpu');
    expect(runtime.status).toEqual({ backend: 'webgpu' });
  });
  it('recreates a CPU session when GPU initialization fails', async () => {
    const runtime = await CutoutBackendSession.create({ backend: 'webgpu', adapter: {} }, async backend => {
      if (backend === 'webgpu') throw new Error('unsupported graph');
      return session(backend);
    });
    expect(await runtime.run(async value => value.backend)).toBe('wasm');
    expect(runtime.status).toMatchObject({ backend: 'wasm', fallbackReason: expect.stringContaining('unsupported graph') });
  });
  it('releases the failed GPU session and retries inference once on CPU, then stays CPU', async () => {
    let released = false;
    const runtime = await CutoutBackendSession.create({ backend: 'webgpu', adapter: {} }, async backend => {
      if (backend === 'wasm') expect(released).toBe(true);
      return { backend, async release() { released = true; } };
    });
    let attempts = 0;
    const result = await runtime.run(async value => {
      attempts++;
      if (value.backend === 'webgpu') throw new Error('GPU device lost');
      return 128;
    });
    expect(result).toBe(128);
    expect(attempts).toBe(2);
    expect(runtime.status).toMatchObject({ backend: 'wasm', fallbackReason: expect.stringContaining('GPU device lost') });
    expect(await runtime.run(async value => value.backend)).toBe('wasm');
  });
  it('still falls back if failed GPU resource release throws', async () => {
    const runtime = await CutoutBackendSession.create({ backend: 'webgpu', adapter: {} }, async backend => ({
      backend, async release() { throw new Error('device lost'); },
    }));
    expect(runtime.status.backend).toBe('webgpu');
    expect(await runtime.run(async value => {
      if (value.backend === 'webgpu') throw new Error('GPU device lost');
      return value.backend;
    })).toBe('wasm');
  });
  it('propagates CPU inference failure without a retry loop', async () => {
    const runtime = await CutoutBackendSession.create({ backend: 'webgpu', adapter: {} }, async backend => session(backend));
    let attempts = 0;
    await expect(runtime.run(async () => { attempts++; throw new Error('inference failed'); })).rejects.toThrow('inference failed');
    expect(attempts).toBe(2);
    await expect(runtime.run(async () => { attempts++; throw new Error('CPU failed'); })).rejects.toThrow('CPU failed');
    expect(attempts).toBe(3);
  });
  it('does not reuse a failed GPU session if CPU session creation fails', async () => {
    const runtime = await CutoutBackendSession.create({ backend: 'webgpu', adapter: {} }, async backend => {
      if (backend === 'wasm') throw new Error('CPU init failed');
      return session(backend);
    });
    await expect(runtime.run(async () => { throw new Error('GPU failed'); })).rejects.toThrow('CPU init failed');
    await expect(runtime.run(async () => 1)).rejects.toThrow('尚未初始化');
  });
});
