import bundledModelUrl from '../../resources/cutout/birefnet-lite-512.onnx?url';
import { CUTOUT_MODEL } from './CutoutModelManifest';
export { CUTOUT_MODEL } from './CutoutModelManifest';

type WeightManifest = { size: number; sha256: string };
type WeightReader = (signal?: AbortSignal) => Promise<Uint8Array>;

export async function verifyModelBytes(bytes: Uint8Array, manifest: WeightManifest = CUTOUT_MODEL): Promise<void> {
  if (bytes.byteLength !== manifest.size) throw new Error('内置模型文件大小不符，请重新获取完整主程序。');
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (actual !== manifest.sha256) throw new Error('内置模型 SHA-256 校验失败，未运行抠图。请重新获取完整主程序。');
}

async function readBundledWeights(signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(bundledModelUrl, { signal });
  if (!response.ok) throw new Error(`内置抠图模型无法读取（HTTP ${response.status}），请重新获取完整主程序。`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Weights are compressed inside the Tauri EXE. Loading never requires a model cache or internet service. */
export class CutoutModelStore {
  constructor(private readonly read: WeightReader = readBundledWeights, private readonly manifest: WeightManifest = CUTOUT_MODEL) {}
  async isInstalled(): Promise<boolean> { return true; }
  async load(signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    const bytes = await this.read(signal);
    signal?.throwIfAborted();
    await verifyModelBytes(bytes, this.manifest);
    signal?.throwIfAborted();
    return bytes;
  }
}
export const defaultCutoutModelStore = new CutoutModelStore();
