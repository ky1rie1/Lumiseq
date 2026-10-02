import type { IAssetManager } from '../../types/asset';
import type { IPlatformBridge } from '../../platform/IPlatformBridge';
import type { DevelopDocument, DevelopSettings } from '../../types/develop';
import { getPlatformBridge, isTauriEnvironment } from '../../platform';
import { WebGLImageEngine } from '../../engine/WebGLImageEngine';
import { spatialSourceHalo } from '../../engine/spatialScale';
import { paddedRawDetailRegion } from '../../ui/workspaces/develop/rawDetailPadding';
import { createDefaultDevelopSettings } from '../../document/DevelopDocument';
import { getRawSpatialAnalysis, RawSpatialAnalysisCache, type RawSpatialAnalysis } from '../../app/rawSpatialAnalysis';
import type { DocumentObservationRenderPort, ObservationGeometry } from './observationTypes';

interface Dependencies {
  assets: IAssetManager;
  bridge?: Pick<IPlatformBridge, 'getRawDisplayTile' | 'getRawSpatialAnalysis' | 'getRawLinearPreview' | 'getRawLinearTile'>;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  engineFactory?: () => WebGLImageEngine;
}
function check(signal: AbortSignal): void {
  if (signal.aborted) { const error = new Error('Observation render aborted'); error.name = 'AbortError'; throw error; }
}
function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function sourceIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) {
    if (/assetId$/i.test(key) && typeof v === 'string') ids.add(v); else sourceIds(v, ids);
  }
  return ids;
}
/** Uses the workspace's existing render pipeline with separately owned engine/surfaces. */
export function createDocumentObservationRenderer(deps: Dependencies): DocumentObservationRenderPort {
  let disposed = false;
  const analysisCache = new RawSpatialAnalysisCache();
  const create = deps.createCanvas ?? ((width, height) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
  });
  async function analysis(doc: DevelopDocument, settings: DevelopSettings): Promise<RawSpatialAnalysis | undefined> {
    if (!doc.isRaw || !doc.nativeAssetId || (!settings.dehaze && !settings.detail.lumaDenoise && !settings.detail.chromaDenoise)) return undefined;
    if (!deps.bridge) return getRawSpatialAnalysis(doc.nativeAssetId, settings);
    if (!deps.bridge.getRawSpatialAnalysis) throw new Error('Whole-source spatial analysis is unavailable');
    return analysisCache.get(doc.nativeAssetId, settings, (id, base) => deps.bridge!.getRawSpatialAnalysis!(id, base));
  }
  return {
    dispose() { disposed = true; analysisCache.clear(); },
    async render(doc, geometry, variant, signal) {
      check(signal); if (disposed) throw new Error('Observation renderer is disposed');
      if (doc.kind === 'edit' && variant === 'original') throw new Error('Edit original observation is unsupported; capture a current baseline');
      const engine = deps.engineFactory?.() ?? new WebGLImageEngine(deps.assets, true);
      const loaded = sourceIds(doc), temporaries = new Set<string>(), surfaces = new Set<HTMLCanvasElement>();
      const surface = (w: number, h: number) => { const canvas = create(w, h); surfaces.add(canvas); return canvas; };
      const releaseSurface = (canvas: HTMLCanvasElement) => {
        engine.releaseDevelopContext(canvas);
        try { canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* 2D surface */ }
        canvas.width = canvas.height = 1; surfaces.delete(canvas);
      };
      const releaseTile = (id: string) => { engine.releaseAsset(id); deps.assets.releaseAsset(id); temporaries.delete(id); };
      let approximate = false;
      try {
        const output = surface(geometry.width, geometry.height);
        if (doc.kind === 'edit') {
          await engine.renderEdit(doc, output, undefined, undefined, undefined, { sourceRegion: geometry.region });
        } else {
          if (doc.isRaw && doc.rawState !== 'ready') throw new Error('RAW decode is not ready for a recipe observation');
          const settings = variant === 'original' ? createDefaultDevelopSettings(doc.isRaw) : doc.settings;
          let spatialAnalysis = await analysis(doc, settings); check(signal);
          if (geometry.mode === 'overview') {
            const id = doc.previewAssetId ?? doc.sourceAssetId;
            if (!id) throw new Error('Document display asset is unavailable');
            const blob = await deps.assets.getBlob(id);
            if (!blob) throw new Error('Document display asset is unavailable');
            const sourceSize = await engine.loadAsset(id, blob); check(signal);
            const bridge = deps.bridge ?? getPlatformBridge();
            if (doc.isRaw && doc.nativeAssetId && bridge.getRawLinearPreview && (deps.bridge || isTauriEnvironment())) {
              const linear = await bridge.getRawLinearPreview(doc.nativeAssetId); check(signal);
              engine.setRawLinearSource(id, linear);
            }
            await engine.renderDevelop(id, settings, output, undefined, {
              spatialAnalysis, spatialSourceSize: { width: doc.width, height: doc.height },
            });
            approximate = doc.isRaw && (geometry.width !== doc.width || geometry.height !== doc.height ||
              sourceSize.width !== doc.width || sourceSize.height !== doc.height);
          } else {
            const bridge = deps.bridge ?? getPlatformBridge();
            if (doc.isRaw && (!doc.nativeAssetId || !bridge.getRawDisplayTile)) throw new Error('Native original-resolution RAW tile access is unavailable');
            let raster: CanvasImageSource | null = null;
            if (!doc.isRaw) {
              const id = doc.sourceAssetId ?? doc.previewAssetId;
              if (!id) throw new Error('Document source asset is unavailable');
              raster = await engine.getOrLoadSourceElement(id);
              if (!raster) throw new Error('Document source pixels are unavailable');
              spatialAnalysis = await engine.getDevelopSpatialAnalysis(id, settings);
            }
            const context = output.getContext('2d', { colorSpace: 'srgb' });
            if (!context) throw new Error('Observation output context is unavailable');
            const halo = spatialSourceHalo(settings, doc.width, doc.height);
            // Native reads are <=4096 per side / 6M pixels. Bound the display tiles too;
            // no full-source JS pixel copy is created for any individual tile.
            const tileSide = Math.min(1536, 4096 - 2 * halo, Math.floor(Math.sqrt(6_000_000)) - 2 * halo);
            if (tileSide < 1) throw new Error('Recipe halo exceeds supported tile allocation');
            for (let y = geometry.region.y; y < geometry.region.y + geometry.region.height; y += tileSide) {
              for (let x = geometry.region.x; x < geometry.region.x + geometry.region.width; x += tileSide) {
                check(signal);
                const wanted = { x, y, width: Math.min(tileSide, geometry.region.x + geometry.region.width - x),
                  height: Math.min(tileSide, geometry.region.y + geometry.region.height - y) };
                const { display, read } = paddedRawDetailRegion(wanted, doc.width, doc.height, halo);
                if (JSON.stringify(display) !== JSON.stringify(wanted)) throw new Error('Requested tile exceeds halo allocation');
                let blob: Blob;
                if (doc.isRaw) {
                  const bytes = await bridge.getRawDisplayTile!(doc.nativeAssetId!, read.x, read.y, read.width, read.height);
                  check(signal); blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
                } else {
                  const crop = surface(read.width, read.height), ctx = crop.getContext('2d', { colorSpace: 'srgb' });
                  if (!ctx) throw new Error('Observation crop context is unavailable');
                  ctx.drawImage(raster!, read.x, read.y, read.width, read.height, 0, 0, read.width, read.height);
                  blob = await encode(crop, 'image/png'); releaseSurface(crop);
                }
                const asset = await deps.assets.registerBlob(blob, 'image', 'Temporary document observation tile', { width: read.width, height: read.height });
                temporaries.add(asset.id); check(signal);
                const rendered = surface(read.width, read.height);
                try {
                  const decoded = await engine.loadAsset(asset.id, blob); check(signal);
                  if (doc.isRaw && bridge.getRawLinearTile) {
                    const linear = await bridge.getRawLinearTile(doc.nativeAssetId!, read.x, read.y, read.width, read.height); check(signal);
                    engine.setRawLinearSource(asset.id, linear);
                  }
                  if (decoded.width !== read.width || decoded.height !== read.height) throw new Error('Observation source tile dimensions do not match requested native pixels');
                  await engine.renderDevelop(asset.id, settings, rendered, undefined, { spatialAnalysis,
                    sourceRect: { ...read, sourceWidth: doc.width, sourceHeight: doc.height } });
                  check(signal);
                  const scaleX = geometry.width / geometry.region.width, scaleY = geometry.height / geometry.region.height;
                  context.drawImage(rendered, display.x - read.x, display.y - read.y, display.width, display.height,
                    (display.x - geometry.region.x) * scaleX, (display.y - geometry.region.y) * scaleY,
                    display.width * scaleX, display.height * scaleY);
                } finally { releaseSurface(rendered); releaseTile(asset.id); }
              }
            }
          }
        }
        check(signal);
        const blob = await encode(output, geometry.mimeType); check(signal);
        // Guard before materializing base64 as well as at the service cache boundary.
        if (blob.size > 8 * 1024 * 1024) throw new Error('Observation image exceeds size limit');
        const data = base64(new Uint8Array(await blob.arrayBuffer())); check(signal);
        return { data, mimeType: geometry.mimeType, approximate };
      } finally {
        for (const canvas of surfaces) releaseSurface(canvas);
        for (const id of temporaries) releaseTile(id);
        for (const id of loaded) engine.releaseAsset(id);
        engine.releaseObservationResources();
      }
    },
  };
}
async function encode(canvas: HTMLCanvasElement, mimeType: ObservationGeometry['mimeType']): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.type !== mimeType) reject(new Error('Observation image encoding failed'));
    else resolve(blob);
  }, mimeType, mimeType === 'image/jpeg' ? 0.82 : undefined));
}
