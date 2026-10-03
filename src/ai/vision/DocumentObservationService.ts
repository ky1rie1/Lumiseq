import type { IDocumentManager, StudioDocument } from '../../types/document';
import type { IAssetManager } from '../../types/asset';
import { defaultAssetManager } from '../../assets/AssetManager';
import { observationGeometry } from './observationGeometry';
import { createDocumentObservationRenderer } from './documentObservationRenderer';
import type { DocumentObservation, DocumentObservationRenderPort, ObservationRequest } from './observationTypes';

interface Options {
  documents: IDocumentManager; assets?: IAssetManager; renderer?: DocumentObservationRenderPort;
  maxImages?: number; maxBytes?: number; maxImageBytes?: number;
}
interface Cached { key: string; observation: DocumentObservation; bytes: number }
let observationSerial = 0;

// These fields affect UI/history only. All remaining layer properties, including nested
// masks/filters/recipes, remain in the signature, so new rendering fields invalidate it.
const layerUiFields = new Set(['name', 'locked', 'collapsed', 'generationMetadata']);
function canonical(value: unknown, omit?: Set<string>): unknown {
  if (Array.isArray(value)) return value.map(v => canonical(v, omit));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, v]) => v !== undefined && !omit?.has(key)).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => [key, canonical(v, omit)]));
  return value;
}
function renderState(doc: StudioDocument): unknown {
  return doc.kind === 'edit'
    ? { kind: doc.kind, width: doc.width, height: doc.height, backgroundColor: doc.backgroundColor,
      renderingVersion: doc.renderingVersion, bitDepth: doc.bitDepth, workingProfile: doc.workingProfile,
      cropRect: doc.cropRect, layers: canonical(doc.layers, layerUiFields) }
    : { kind: doc.kind, width: doc.width, height: doc.height, sourceUri: doc.sourceUri,
      sourceAssetId: doc.sourceAssetId, nativeAssetId: doc.nativeAssetId, previewAssetId: doc.previewAssetId,
      isRaw: doc.isRaw, rawEngineAttached: doc.rawEngineAttached, rawState: doc.rawState,
      exif: doc.exif, pipelineState: doc.pipelineState, settings: doc.settings };
}
function assetIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) {
    if (/assetId$/i.test(key) && key !== 'nativeAssetId' && typeof v === 'string') ids.add(v);
    else assetIds(v, ids);
  }
  return ids;
}
function abortError(): Error { const error = new Error('Document observation aborted'); error.name = 'AbortError'; return error; }
// Deterministic content fingerprint; the full signature is retained to detect changes,
// without exposing document text, file paths, recipes or resource metadata in evidence.
function fingerprint(text: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9, c = 0x85ebca6b, d = 0xc2b2ae35;
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    a = Math.imul(a ^ n, 0x01000193); b = Math.imul(b ^ n, 0x85ebca6b);
    c = Math.imul(c ^ n, 0xc2b2ae35); d = Math.imul(d ^ n, 0x27d4eb2f);
  }
  return [a, b, c, d].map(n => (n >>> 0).toString(16).padStart(8, '0')).join('');
}
export class DocumentObservationService {
  private readonly assets: IAssetManager;
  private readonly renderer: DocumentObservationRenderPort;
  private readonly limits: { images: number; bytes: number; imageBytes: number };
  private readonly cache = new Map<string, Cached>();
  private readonly pending = new Set<AbortController>();
  private readonly signatures = new Map<string, { signature: string; revision: string }>();
  private disposed = false;
  private readonly unsubscribe: () => void;
  constructor(private readonly options: Options) {
    this.assets = options.assets ?? defaultAssetManager;
    this.renderer = options.renderer ?? createDocumentObservationRenderer({ assets: this.assets });
    this.limits = { images: options.maxImages ?? 16, bytes: options.maxBytes ?? 32 * 1024 * 1024,
      imageBytes: options.maxImageBytes ?? 8 * 1024 * 1024 };
    if (!Object.values(this.limits).every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid observation cache limits');
    this.unsubscribe = options.documents.subscribe(event => {
      if (event.type === 'closed') {
        for (const [id, entry] of this.cache) if (entry.observation.evidence.documentId === event.documentId) this.release(id);
        this.signatures.delete(event.documentId);
      } else if (event.type === 'updated' || event.type === 'opened') this.invalidate(event.document.id);
    });
  }
  revision(documentId: string): string {
    const doc = this.options.documents.getDocument(documentId);
    if (!doc) throw new Error('Observation document does not exist');
    const state = renderState(doc);
    // AssetManager ids point to immutable blobs/masks; handles detect removal or replacement.
    const resources = [...assetIds(state)].sort().map(id => [id, this.assets.getHandle(id)]);
    const signature = JSON.stringify(canonical({ state, resources }));
    const previous = this.signatures.get(documentId);
    if (!previous || previous.signature !== signature) this.signatures.set(documentId, { signature, revision: `render-v1:${fingerprint(signature)}` });
    return this.signatures.get(documentId)!.revision;
  }
  private invalidate(documentId: string): void {
    const revision = this.revision(documentId);
    for (const [id, entry] of this.cache) if (entry.observation.evidence.documentId === documentId && entry.observation.evidence.revision !== revision) this.release(id);
  }
  async observe(request: ObservationRequest, signal?: AbortSignal): Promise<DocumentObservation> {
    if (this.disposed) throw new Error('Document observation service is disposed');
    if (signal?.aborted) throw abortError();
    const doc = this.options.documents.getDocument(request.documentId);
    if (!doc) throw new Error('Observation document does not exist');
    const geometry = observationGeometry(request, doc.width, doc.height);
    if (doc.kind === 'edit' && request.variant === 'original') throw new Error('Edit original observation is unsupported; capture a current baseline');
    const revision = this.revision(doc.id), variant = request.variant ?? 'current';
    if (request.expectedRevision !== undefined && request.expectedRevision !== revision) throw new Error('Observation revision does not match');
    this.invalidate(doc.id);
    const key = JSON.stringify([doc.id, revision, variant, geometry]);
    for (const [id, entry] of this.cache) if (entry.key === key) {
      this.cache.delete(id); this.cache.set(id, entry); return entry.observation;
    }
    const controller = new AbortController(); this.pending.add(controller);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await this.renderer.render(structuredClone(doc), geometry, variant, controller.signal);
      if (controller.signal.aborted || this.disposed) throw abortError();
      if (!this.options.documents.getDocument(doc.id) || this.revision(doc.id) !== revision) throw new Error('Observation document changed; stale result rejected');
      if (result.mimeType !== geometry.mimeType || typeof result.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.data) || !result.data.length) {
        throw new Error('Invalid observation image');
      }
      const payloadBytes = Math.floor(result.data.length * 3 / 4) - (result.data.endsWith('==') ? 2 : result.data.endsWith('=') ? 1 : 0);
      if (payloadBytes > this.limits.imageBytes) throw new Error('Observation image exceeds size limit');
      const observation: DocumentObservation = { evidence: { observationId: `observation:${++observationSerial}`, documentId: doc.id,
        revision, sourceWidth: doc.width, sourceHeight: doc.height, region: { ...geometry.region }, width: geometry.width, height: geometry.height,
        mimeType: geometry.mimeType, variant, colorSpace: 'srgb', approximate: result.approximate,
        pixelToDocument: [...geometry.pixelToDocument] }, image: { mimeType: result.mimeType, data: result.data } };
      Object.freeze(observation.evidence.region); Object.freeze(observation.evidence.pixelToDocument);
      Object.freeze(observation.evidence); Object.freeze(observation.image); Object.freeze(observation);
      const bytes = result.data.length * 2; // conservative UTF-16 storage bound, not just decoded bytes
      if (bytes <= this.limits.bytes) {
        this.cache.set(observation.evidence.observationId, { key, observation, bytes });
        while (this.cache.size > this.limits.images || [...this.cache.values()].reduce((n, e) => n + e.bytes, 0) > this.limits.bytes) {
          this.release(this.cache.keys().next().value!);
        }
      }
      return observation;
    } catch (error) {
      if (controller.signal.aborted) throw abortError();
      // Never propagate an engine/provider exception that might embed pixels or a DataURL.
      if (error instanceof Error && error.message === 'Layer exceeds the supported render buffer size.') {
        throw new Error('Observation exceeds the supported render buffer size');
      }
      if (error instanceof Error && ['Observation document changed; stale result rejected',
        'Observation image exceeds size limit', 'Invalid observation image'].includes(error.message)) throw new Error(error.message);
      throw new Error('Document observation render failed');
    } finally { signal?.removeEventListener('abort', abort); this.pending.delete(controller); }
  }
  get(observationId: string): DocumentObservation | undefined {
    const entry = this.cache.get(observationId); if (!entry) return undefined;
    const doc = this.options.documents.getDocument(entry.observation.evidence.documentId);
    if (!doc || this.revision(doc.id) !== entry.observation.evidence.revision) { this.release(observationId); return undefined; }
    return entry.observation;
  }
  release(observationId: string): void { this.cache.delete(observationId); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.unsubscribe();
    for (const controller of this.pending) controller.abort();
    this.cache.clear(); this.signatures.clear(); this.renderer.dispose?.();
  }
}
