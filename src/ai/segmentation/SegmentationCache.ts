// src/ai/segmentation/SegmentationCache.ts
//! In-memory Embedding and Segmentation Mask cache with LRU eviction and memory budget

export interface CachedEmbedding {
  assetId: string;
  renderVersion: number;
  modelVersion: string;
  embedding: Float32Array | ArrayBuffer;
  byteSize: number;
  createdAt: number;
  lastUsedAt: number;
}

export class SegmentationCache {
  private cache: Map<string, CachedEmbedding> = new Map();
  private maxByteBudget: number = 256 * 1024 * 1024; // 256 MB default budget
  private currentByteSize: number = 0;

  constructor(budgetBytes?: number) {
    if (budgetBytes) this.maxByteBudget = budgetBytes;
  }

  private makeKey(assetId: string, renderVersion: number, modelVersion: string): string {
    return `${assetId}:${renderVersion}:${modelVersion}`;
  }

  get(assetId: string, renderVersion: number, modelVersion: string): Float32Array | ArrayBuffer | null {
    const key = this.makeKey(assetId, renderVersion, modelVersion);
    const item = this.cache.get(key);
    if (!item) return null;
    item.lastUsedAt = Date.now();
    return item.embedding;
  }

  set(
    assetId: string,
    renderVersion: number,
    modelVersion: string,
    embedding: Float32Array | ArrayBuffer
  ): void {
    const byteSize = embedding.byteLength;
    // Evict oldest items if exceeding budget
    while (this.currentByteSize + byteSize > this.maxByteBudget && this.cache.size > 0) {
      this.evictOldest();
    }

    const key = this.makeKey(assetId, renderVersion, modelVersion);
    const existing = this.cache.get(key);
    if (existing) {
      this.currentByteSize -= existing.byteSize;
    }

    const item: CachedEmbedding = {
      assetId,
      renderVersion,
      modelVersion,
      embedding,
      byteSize,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    this.cache.set(key, item);
    this.currentByteSize += byteSize;
  }

  /**
   * Invalidate embeddings for a specific asset when pixels change
   */
  invalidateAsset(assetId: string): void {
    for (const [key, item] of this.cache.entries()) {
      if (item.assetId === assetId) {
        this.currentByteSize -= item.byteSize;
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all segmentation cache entries
   */
  clear(): void {
    this.cache.clear();
    this.currentByteSize = 0;
  }

  getStats(): { count: number; byteSize: number; maxBudget: number } {
    return {
      count: this.cache.size,
      byteSize: this.currentByteSize,
      maxBudget: this.maxByteBudget,
    };
  }

  getCurrentMemoryUsage(): number {
    return this.currentByteSize;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.lastUsedAt < oldestTime) {
        oldestTime = item.lastUsedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const item = this.cache.get(oldestKey)!;
      this.currentByteSize -= item.byteSize;
      this.cache.delete(oldestKey);
    }
  }
}

export const defaultSegmentationCache = new SegmentationCache();
