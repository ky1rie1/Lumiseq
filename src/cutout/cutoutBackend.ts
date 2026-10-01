export type CutoutBackend = 'webgpu' | 'wasm';
export type CutoutBackendStatus = { backend: CutoutBackend; fallbackReason?: string };
type GpuProbe = CutoutBackendStatus & { adapter?: object };
type GpuAccess = { requestAdapter(options?: { powerPreference: 'high-performance'; forceFallbackAdapter: false }): Promise<({ isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } }) | null> };

export async function probeCutoutGpu(gpu: GpuAccess | undefined): Promise<GpuProbe> {
  if (!gpu) return { backend: 'wasm', fallbackReason: '此设备环境未提供 WebGPU，使用 CPU。' };
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance', forceFallbackAdapter: false });
    if (!adapter || adapter.info?.isFallbackAdapter || adapter.isFallbackAdapter) return { backend: 'wasm', fallbackReason: '未找到可用的硬件 GPU，使用 CPU。' };
    return { backend: 'webgpu', adapter };
  } catch (reason) {
    return { backend: 'wasm', fallbackReason: `GPU 检测失败，使用 CPU：${errorMessage(reason)}` };
  }
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

export class CutoutBackendSession<S extends { release(): Promise<void> }> {
  private constructor(private session: S | undefined, public status: CutoutBackendStatus, private readonly createSession: (backend: CutoutBackend) => Promise<S>) {}
  static async create<S extends { release(): Promise<void> }>(probe: GpuProbe, create: (backend: CutoutBackend) => Promise<S>): Promise<CutoutBackendSession<S>> {
    let status: CutoutBackendStatus = { backend: probe.backend, ...(probe.fallbackReason ? { fallbackReason: probe.fallbackReason } : {}) };
    if (probe.backend === 'webgpu') {
      try { return new CutoutBackendSession(await create('webgpu'), status, create); }
      catch (reason) { status = { backend: 'wasm', fallbackReason: `GPU 初始化失败，使用 CPU：${errorMessage(reason)}` }; }
    }
    return new CutoutBackendSession(await create('wasm'), status, create);
  }
  async run<T>(operation: (session: S) => Promise<T>): Promise<T> {
    if (!this.session) throw new Error('本地抠图模型尚未初始化。');
    try { return await operation(this.session); }
    catch (reason) {
      if (this.status.backend !== 'webgpu') throw reason;
      const failedSession = this.session;
      this.session = undefined;
      this.status = { backend: 'wasm', fallbackReason: `GPU 推理失败，已切换 CPU：${errorMessage(reason)}` };
      // A lost device may also reject cleanup. It must not prevent CPU recovery.
      try { await failedSession.release(); } catch { /* Already unusable. */ }
      this.session = await this.createSession('wasm');
      return operation(this.session);
    }
  }
}
