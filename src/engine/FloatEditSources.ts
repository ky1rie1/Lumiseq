import type { IAssetManager } from '../types/asset';
import type { DevelopSmartObjectLayer } from '../types/edit';
import { getPlatformBridge, type IPlatformBridge } from '../platform';
import type { FloatSource, LinearPixelBuffer } from './editFloat/types';
import { buildNativeDevelopPayload } from '../app/nativeDevelopPayload';
import type { IDocumentManager } from '../types/document';

type NativeSource = { assetId: string; width: number; height: number; bitDepth: 8 | 16 | 32 };
interface Lease { source: FloatSource; release(): Promise<void> }

/** Owns decoded leases; the asset manager continues to own immutable original blobs. */
export class FloatEditSources {
  private sources = new Map<string, Promise<Lease>>();
  private raws = new Map<string, Promise<Lease>>();
  constructor(private readonly assets: IAssetManager, private readonly platform = getPlatformBridge) {
    assets.subscribeRelease?.(id => this.release(id));
  }

  adopt(id: string, decoded: NativeSource, bridge: IPlatformBridge): void {
    this.release(id);
    this.sources.set(id, Promise.resolve(this.nativeLease(decoded, bridge)));
  }

  private nativeLease(decoded: NativeSource, bridge: IPlatformBridge): Lease {
    return {
      source: { width: decoded.width, height: decoded.height, getRegion: region => {
        if (!bridge.readEditSourceTile) throw new Error('高精度图像读取需要桌面版。');
        return bridge.readEditSourceTile(decoded.assetId, region.x, region.y, region.width, region.height);
      } }, release: () => bridge.releaseEditSource?.(decoded.assetId) ?? Promise.resolve(),
    };
  }

  async getSource(id: string): Promise<FloatSource> {
    let pending = this.sources.get(id);
    if (!pending) {
      pending = this.decode(id);
      this.sources.set(id, pending);
      void pending.catch(() => { if (this.sources.get(id) === pending) this.sources.delete(id); });
    }
    return (await pending).source;
  }

  private async decode(id: string): Promise<Lease> {
    const blob = await this.assets.getBlob(id);
    if (!blob) throw new Error('原始图像资源丢失。');
    const bridge = this.platform();
    if (bridge.decodeEditSource) return this.nativeLease(await bridge.decodeEditSource(new Uint8Array(await blob.arrayBuffer())), bridge);
    throw new Error('高精度编辑需要原生图像解码器，请使用桌面版。');
  }

  async getRawSource(layer: DevelopSmartObjectLayer): Promise<FloatSource> {
    if (!layer.sourceAssetId) throw new Error('RAW 智能对象缺少原始文件。');
    const bridge = this.platform();
    const key = `${layer.sourceAssetId}:${layer.rawProcessingVersion ?? 1}:${layer.rawCorrectionMode ?? 'camera'}`;
    let pending = this.raws.get(key);
    if (!pending) {
      pending = (async () => {
        const blob = await this.assets.getBlob(layer.sourceAssetId!);
        if (!blob || !bridge.stageRawSource || !bridge.renderRawDevelopTile) throw new Error('RAW 智能对象需要桌面原生解码器。');
        const name = this.assets.getHandle(layer.sourceAssetId!)?.name ?? 'source.raw';
        const path = await bridge.stageRawSource(name, blob);
        try {
          const decoded = await bridge.decodeRawImage(crypto.randomUUID(), path, 'High', layer.rawProcessingVersion ?? 1, layer.rawCorrectionMode ?? 'camera');
          if (!decoded) throw new Error('无法解码原始 RAW。');
          return { source: { width: decoded.width, height: decoded.height, getRegion: () => { throw new Error('RAW recipe missing'); } }, nativeId: decoded.asset_id,
            release: () => bridge.releaseRawAsset(decoded.asset_id) };
        } finally { await bridge.deleteFile(path).catch(() => false); }
      })();
      this.raws.set(key, pending);
      void pending.catch(() => { if (this.raws.get(key) === pending) this.raws.delete(key); });
    }
    const lease = await pending as Lease & { nativeId: string };
    const payload = await buildNativeDevelopPayload(layer.developSettings, this.assets);
    return { width: lease.source.width, height: lease.source.height, getRegion: region => bridge.renderRawDevelopTile!(lease.nativeId, payload, region.x, region.y, region.width, region.height) };
  }

  release(id: string): void {
    const pending = this.sources.get(id);
    this.sources.delete(id);
    if (pending) void pending.then(lease => lease.release()).catch(() => {});
    for (const [key, lease] of this.raws) if (key.startsWith(`${id}:`)) {
      this.raws.delete(key); void lease.then(value => value.release()).catch(() => {});
    }
  }

  dispose(): void {
    for (const id of [...this.sources.keys()]) this.release(id);
    for (const [key, lease] of this.raws) {
      this.raws.delete(key); void lease.then(value => value.release()).catch(() => {});
    }
  }
}

const caches = new WeakMap<IAssetManager, FloatEditSources>();
export function getFloatEditSources(assets: IAssetManager): FloatEditSources {
  let cache = caches.get(assets);
  if (!cache) { cache = new FloatEditSources(assets); caches.set(assets, cache); }
  return cache;
}

const bindings = new WeakMap<IDocumentManager, WeakSet<IAssetManager>>();
export function bindFloatEditSourcesToDocuments(documents: IDocumentManager, assets: IAssetManager): void {
  let stores = bindings.get(documents);
  if (!stores) { stores = new WeakSet(); bindings.set(documents, stores); }
  if (stores.has(assets)) return; stores.add(assets);
  const references = new Map<string, Set<string>>();
  const collect = (value: unknown, ids = new Set<string>()): Set<string> => {
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (/assetId$/i.test(key) && key !== 'nativeAssetId' && typeof child === 'string') ids.add(child);
      else collect(child, ids);
    }
    return ids;
  };
  for (const doc of documents.getOpenDocuments()) references.set(doc.id, collect(doc));
  documents.subscribe(event => {
    if (event.type !== 'closed' && event.type !== 'updated' && event.type !== 'opened') return;
    const id = event.type === 'closed' ? event.documentId : event.document.id;
    const old = references.get(id) ?? new Set<string>();
    if (event.type === 'closed') references.delete(id); else references.set(id, collect(event.document));
    const remaining = new Set([...references.values()].flatMap(values => [...values]));
    for (const asset of old) if (!remaining.has(asset)) getFloatEditSources(assets).release(asset);
  });
}

export function floatToDisplay(pixels: LinearPixelBuffer): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(pixels.data.length);
  const encode = (value: number) => Math.max(0, Math.min(1, value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055));
  for (let i = 0; i < output.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) output[i + channel] = Math.round(encode(pixels.data[i + channel]) * 255);
    output[i + 3] = Math.round(pixels.data[i + 3] * 255);
  }
  return output;
}
