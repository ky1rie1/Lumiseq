import { rasterizeDevelopMask } from '../develop/maskRaster';
import { getPlatformBridge } from '../platform';
import type { IDocumentManager, StudioDocument } from '../types/document';
import type { AssetHandle, IAssetManager } from '../types/asset';
import { defaultAssetManager } from '../assets/AssetManager';
import { serializeWrites } from '../app/ProjectOperationService';
import { validateDocument } from './ProjectSerializer';
export interface RecoveryEntry {
    documentId: string;
    name: string;
    timestamp: number;
    data: StudioDocument;
    assets: {
        handle: AssetHandle;
        blob: Blob;
    }[];
    rawSource?: Blob;
}
export interface RecoveryStore {
    put(entry: RecoveryEntry): Promise<void>;
    list(): Promise<RecoveryEntry[]>;
    remove(id: string): Promise<void>;
}
export interface RecoverySourcePorts {
    inspect(path: string): Promise<{
        sizeBytes: number;
        modifiedAt?: number;
    }>;
    read(path: string): Promise<Uint8Array>;
    stage(name: string, blob: Blob): Promise<string>;
    estimate?(): Promise<{
        quota?: number;
        usage?: number;
    }>;
}
const MAX_RAW_BYTES = 256 * 1024 * 1024;
const MAX_RECOVERY_BYTES = 512 * 1024 * 1024;
const defaultRecoverySources: RecoverySourcePorts = {
    inspect: async (path) => { const { invoke } = await import('@tauri-apps/api/core'); const file = await invoke<{
        size_bytes: number;
        modified_at_ms?: number;
    }>('inspect_local_file', { path }); return { sizeBytes: file.size_bytes, modifiedAt: file.modified_at_ms }; },
    read: path => getPlatformBridge().readBinaryFile(path),
    stage: async (fileName, blob) => { const { invoke } = await import('@tauri-apps/api/core'); return invoke<string>('stage_recovery_source', { fileName, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }); },
    estimate: () => typeof navigator !== 'undefined' && navigator.storage?.estimate ? navigator.storage.estimate() : Promise.resolve({}),
};
function packageBytes(entry: RecoveryEntry): number { return entry.assets.reduce((sum, asset) => sum + asset.blob.size, entry.rawSource?.size ?? 0); }
function validateRecovery(entry: RecoveryEntry): void {
    const doc = entry?.data;
    if (!entry || typeof entry.documentId !== 'string' || !entry.documentId || typeof entry.name !== 'string' || !Number.isFinite(entry.timestamp) || !doc || doc.id !== entry.documentId || !['edit', 'develop'].includes(doc.kind) || !Number.isInteger(doc.width) || doc.width <= 0 || !Number.isInteger(doc.height) || doc.height <= 0 || doc.width * doc.height > 150000000 || !Array.isArray(entry.assets) || entry.assets.length > 10000)
        throw new Error('Recovery package is corrupt.');
    if (doc.kind === 'edit' && (!Array.isArray(doc.layers) || typeof doc.name !== 'string'))
        throw new Error('Recovery edit document is corrupt.');
    if (doc.kind === 'develop' && (!doc.settings || !Array.isArray(doc.settings.masks) || typeof doc.isRaw !== 'boolean' || typeof doc.fileName !== 'string' || typeof doc.sourceUri !== 'string'))
        throw new Error('Recovery develop document is corrupt.');
    const ids = new Set<string>();
    for (const asset of entry.assets) {
        const handle = asset?.handle;
        if (!handle || typeof handle.id !== 'string' || ids.has(handle.id) || !['image', 'mask', 'preview', 'thumbnail'].includes(handle.kind) || !(asset.blob instanceof Blob) || !asset.blob.size || handle.sizeBytes !== asset.blob.size)
            throw new Error('Recovery resource is corrupt.');
        ids.add(handle.id);
        if (handle.kind === 'mask' && (!Number.isInteger(handle.width) || !Number.isInteger(handle.height) || handle.width! <= 0 || handle.height! <= 0 || (handle.width as number) * (handle.height as number) !== asset.blob.size))
            throw new Error('Recovery mask dimensions are corrupt.');
    }
    const checkReferences = (value: unknown): void => { if (value && typeof value === 'object')
        for (const [key, child] of Object.entries(value)) {
            if (key !== 'nativeAssetId' && /(?:AssetId|^assetId)$/.test(key) && typeof child === 'string' && child && !ids.has(child))
                throw new Error('Recovery package has a missing resource.');
            checkReferences(child);
        } };
    checkReferences(doc);
    if (doc.kind === 'edit')
        validateDocument(doc, id => ids.has(id));
    if (entry.rawSource && (!(entry.rawSource instanceof Blob) || entry.rawSource.size > MAX_RAW_BYTES))
        throw new Error('Recovery RAW source exceeds the 256 MiB limit.');
    if (doc.kind === 'develop' && doc.isRaw) {
        const original = entry.assets.find(asset => asset.handle.id === doc.originalRawAssetId)?.blob;
        if (original && original.size > MAX_RAW_BYTES)
            throw new Error('Recovery RAW source exceeds the 256 MiB limit.');
        if (!original?.size && !entry.rawSource?.size)
            throw new Error('Recovery RAW source is missing.');
    }
    if (packageBytes(entry) > MAX_RECOVERY_BYTES || JSON.stringify(doc).length > 16 * 1024 * 1024)
        throw new Error('Recovery package exceeds the storage limit.');
}
class IndexedRecoveryStore implements RecoveryStore {
    private async database(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => { const request = indexedDB.open('studio-recovery', 1); request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'documentId' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    }
    private async run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        const db = await this.database();
        return new Promise((resolve, reject) => { const tx = db.transaction('documents', mode); const request = action(tx.objectStore('documents')); tx.oncomplete = () => { db.close(); resolve(request.result); }; tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? request.error); }; });
    }
    async put(entry: RecoveryEntry) { await this.run('readwrite', s => s.put(entry)); }
    list() { return this.run('readonly', s => s.getAll()) as Promise<RecoveryEntry[]>; }
    async remove(id: string) { await this.run('readwrite', s => s.delete(id)); }
}
const recoveryStore = new IndexedRecoveryStore();
export class AutosaveManager {
    private timerId: ReturnType<typeof setInterval> | null = null;
    private unsubscribe?: () => void;
    private sourceCache = new Map<string, {
        key: string;
        blob: Blob;
    }>();
    private storedBytes = new Map<string, number>();
    private persistedSignatures = new Map<string, string>();
    private inFlight: Promise<void> | null = null;
    private saveRequested = false;
    constructor(private documents: IDocumentManager, private intervalMs = 30000, private assets: IAssetManager = defaultAssetManager, private store: RecoveryStore = recoveryStore, private onError: (error: unknown) => void = console.error, private sources: RecoverySourcePorts = defaultRecoverySources) { }
    start() { if (this.timerId !== null)
        return; this.unsubscribe = this.documents.subscribe(e => { if (e.type === 'closed')
        void this.discard(e.documentId).catch(this.onError); if (e.type === 'updated' && !e.document.isDirty)
        void this.discard(e.document.id).catch(this.onError); }); this.timerId = setInterval(() => { void this.performAutosave().catch(this.onError); }, this.intervalMs); }
    stop() { if (this.timerId !== null)
        clearInterval(this.timerId); this.timerId = null; this.unsubscribe?.(); this.unsubscribe = undefined; }
    setIntervalMs(ms: number): void {
        if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2147483647)
            throw new RangeError('Recovery interval must be a positive integer within the timer range.');
        if (ms === this.intervalMs)
            return;
        this.intervalMs = ms;
        if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = setInterval(() => { void this.performAutosave().catch(this.onError); }, this.intervalMs);
        }
    }
    performAutosave(): Promise<void> {
        this.saveRequested = true;
        if (this.inFlight)
            return this.inFlight;
        const saving = async () => {
            do {
                this.saveRequested = false;
                await this.saveDirtyDocuments();
            } while (this.saveRequested);
        };
        this.inFlight = saving().finally(() => { this.inFlight = null; });
        return this.inFlight;
    }
    private async saveDirtyDocuments() {
        const errors: unknown[] = [];
        for (const original of this.documents.getOpenDocuments()) {
            if (!original.isDirty)
                continue;
            const signature = JSON.stringify(original);
            if (this.persistedSignatures.get(original.id) === signature)
                continue;
            const snapshot = structuredClone(original);
            if (snapshot.kind === 'develop' && snapshot.isRaw) {
                snapshot.nativeAssetId = null;
                snapshot.previewAssetId = undefined;
                snapshot.sourceAssetId = undefined;
                snapshot.rawState = 'unloaded';
            }
            try {
                await serializeWrites(['recovery:' + snapshot.id], async () => {
                    const ids = new Set<string>();
                    const collect = (value: unknown) => {
                        if (typeof value === 'string' && this.assets.hasAsset(value))
                            ids.add(value);
                        else if (value && typeof value === 'object')
                            for (const [key, child] of Object.entries(value)) {
                                if (key !== 'nativeAssetId' && /(?:AssetId|^assetId)$/.test(key) && typeof child === 'string' && child && !this.assets.hasAsset(child))
                                    throw new Error(`Recovery resource is missing: ${key}`);
                                collect(child);
                            }
                    };
                    collect(snapshot);
                    const embedded: RecoveryEntry['assets'] = [];
                    for (const id of ids) {
                        const handle = this.assets.getHandle(id);
                        const blob = await this.assets.getBlob(id);
                        if (!handle || !blob)
                            throw new Error('Recovery image resource is missing.');
                        embedded.push({ handle: { ...handle }, blob });
                    }
                    // A save or close during asset reads must not resurrect a discarded recovery.
                    const current = this.documents.getDocument(snapshot.id);
                    if (!current?.isDirty)
                        return;
                    const rawSource = snapshot.kind === 'develop' && snapshot.isRaw && !snapshot.originalRawAssetId ? await this.rawSource(snapshot) : undefined;
                    if (!this.documents.getDocument(snapshot.id)?.isDirty)
                        return;
                    const entry = { rawSource, documentId: snapshot.id, name: snapshot.kind === 'edit' ? snapshot.name : snapshot.fileName, timestamp: Date.now(), data: snapshot, assets: embedded };
                    validateRecovery(entry);
                    const bytes = packageBytes(entry);
                    const estimate = await this.sources.estimate?.();
                    const additional = Math.max(0, bytes - (this.storedBytes.get(snapshot.id) ?? 0));
                    if (estimate?.quota !== undefined && estimate.usage !== undefined && additional > estimate.quota - estimate.usage)
                        throw new Error('Recovery storage quota is exhausted.');
                    if (!this.documents.getDocument(snapshot.id)?.isDirty)
                        return;
                    await this.store.put(entry);
                    // Direct callers also need this guard when the timer subscription is stopped.
                    if (!this.documents.getDocument(snapshot.id)?.isDirty) {
                        await this.store.remove(snapshot.id);
                        this.sourceCache.delete(snapshot.id);
                        this.storedBytes.delete(snapshot.id);
                        this.persistedSignatures.delete(snapshot.id);
                        return;
                    }
                    this.storedBytes.set(snapshot.id, bytes);
                    // The persisted signature describes this snapshot, never a later edit.
                    this.persistedSignatures.set(snapshot.id, signature);
                });
            }
            catch (error) {
                errors.push(error);
            }
        }
        if (errors.length)
            throw new AggregateError(errors, `Recovery failed for ${errors.length} document(s).`);
    }
    async checkForRecovery() {
        const entries = await this.store.list();
        return entries.map(entry => {
            try {
                validateRecovery(entry);
                this.storedBytes.set(entry.documentId, packageBytes(entry));
                return entry;
            }
            catch (error) {
                this.onError(error);
                return { ...entry, name: typeof entry.name === 'string' ? entry.name : '损坏的恢复项目' };
            }
        });
    }
    async restore(entry: RecoveryEntry) {
        validateRecovery(entry);
        const doc = structuredClone(entry.data);
        const remap = new Map<string, string>();
        const registered: string[] = [];
        try {
            for (const asset of entry.assets) {
                const h = asset.handle;
                const newHandle = h.kind === 'mask' ? await this.assets.registerMask(new Uint8ClampedArray(await asset.blob.arrayBuffer()), h.width!, h.height!, h.name) : await this.assets.registerBlob(asset.blob, h.kind, h.name, h);
                remap.set(h.id, newHandle.id);
                registered.push(newHandle.id);
            }
            const replace = (value: unknown): unknown => { if (typeof value === 'string')
                return remap.get(value) ?? value; if (Array.isArray(value))
                return value.map(replace); if (value && typeof value === 'object')
                return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)])); return value; };
            const restored = replace(doc) as StudioDocument;
            if (restored.kind === 'develop') {
                for (const mask of [restored.settings, ...(restored.settingsSnapshots ?? []).map(snapshot => snapshot.settings)].flatMap(settings => settings.masks)) {
                    if (this.assets.hasAsset(mask.maskAssetId))
                        continue;
                    const handle = await this.assets.registerMask(rasterizeDevelopMask(mask), 512, 512, mask.name);
                    registered.push(handle.id);
                    mask.maskAssetId = handle.id;
                }
                restored.nativeAssetId = null;
                restored.rawState = restored.isRaw ? 'unloaded' : restored.rawState;
                if (!restored.isRaw && restored.sourceAssetId)
                    restored.sourceUri = this.assets.getDisplayUrl(restored.sourceAssetId) ?? '';
                if (restored.isRaw) {
                    restored.previewAssetId = undefined;
                    restored.sourceAssetId = undefined;
                }
                if (restored.isRaw) {
                    const original = restored.originalRawAssetId ? await this.assets.getBlob(restored.originalRawAssetId) : entry.rawSource;
                    if (!original?.size)
                        throw new Error('Recovery RAW source is missing.');
                    if (!restored.originalRawAssetId) {
                        const handle = await this.assets.registerBlob(original, 'image', restored.fileName, { width: restored.width, height: restored.height });
                        registered.push(handle.id);
                        restored.originalRawAssetId = handle.id;
                    }
                    restored.sourceUri = await this.sources.stage(restored.fileName, original);
                }
            }
            restored.isDirty = true;
            if (this.documents.getDocument(restored.id)) {
                restored.id = crypto.randomUUID();
                if (restored.kind === 'edit' && restored.selection)
                    restored.selection.documentId = restored.id;
            }
            this.documents.openDocument(restored, true);
            // Keep the recovered package until a successful save or explicit close/discard.
            await this.performAutosave().catch(this.onError);
            if (restored.id !== entry.documentId && this.storedBytes.has(restored.id))
                await this.discard(entry.documentId).catch(this.onError);
        }
        catch (error) {
            for (const id of registered)
                this.assets.releaseAsset(id);
            throw error;
        }
    }
    discard(id: string) { return serializeWrites(['recovery:' + id], async () => { await this.store.remove(id); this.sourceCache.delete(id); this.storedBytes.delete(id); this.persistedSignatures.delete(id); }); }
    private async rawSource(doc: Extract<StudioDocument, {
        kind: 'develop';
    }>): Promise<Blob> {
        if (doc.originalRawAssetId) {
            const original = await this.assets.getBlob(doc.originalRawAssetId);
            if (!original?.size || original.size > MAX_RAW_BYTES)
                throw new Error('Recovery RAW original is missing or exceeds the 256 MiB limit.');
            return original;
        }
        const metadata = await this.sources.inspect(doc.sourceUri);
        if (!Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes <= 0 || metadata.sizeBytes > MAX_RAW_BYTES)
            throw new Error('Recovery RAW source must be between 1 byte and 256 MiB.');
        const key = `${doc.sourceUri}:${metadata.sizeBytes}:${metadata.modifiedAt ?? ''}`;
        const cached = this.sourceCache.get(doc.id);
        if (cached?.key === key)
            return cached.blob;
        const bytes = await this.sources.read(doc.sourceUri);
        if (bytes.byteLength !== metadata.sizeBytes || bytes.byteLength > MAX_RAW_BYTES)
            throw new Error('Recovery RAW source changed while reading.');
        const blob = new Blob([bytes as BlobPart]);
        this.sourceCache.delete(doc.id);
        while ([...this.sourceCache.values()].reduce((sum, value) => sum + value.blob.size, blob.size) > MAX_RAW_BYTES) {
            const id = this.sourceCache.keys().next().value;
            if (!id)
                break;
            this.sourceCache.delete(id);
        }
        this.sourceCache.set(doc.id, { key, blob });
        return blob;
    }
    async clearOpen() { for (const doc of this.documents.getOpenDocuments())
        await this.discard(doc.id); }
}
