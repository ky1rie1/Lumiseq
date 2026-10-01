import { useEffect, useRef, useState } from 'react';
import type { DevelopSettings } from '../../../types/develop';
import { defaultAssetManager } from '../../../assets/AssetManager';
import { createDefaultDevelopSettings } from '../../../document/DevelopDocument';
import { defaultImageEngine, DevelopGpuError } from '../../../engine/WebGLImageEngine';
import { LatestPreviewScheduler } from '../../../develop/LatestPreviewScheduler';
import { ReusablePreviewSurface } from '../../../develop/ReusablePreviewSurface';
import { getPlatformBridge, isTauriEnvironment } from '../../../platform';
import { computeRawDetailRegion, type RawDetailRegion } from './rawDetailRegion';
import { paddedRawDetailRegion } from './rawDetailPadding';
import { spatialSourceHalo } from '../../../engine/spatialScale';
import { getRawSpatialAnalysis } from '../../../app/rawSpatialAnalysis';

interface RawDetailOptions {
  documentId?: string;
  nativeAssetId?: string | null;
  sourceWidth: number;
  sourceHeight: number;
  previewWidth: number;
  previewHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  panX: number;
  panY: number;
  settings?: DevelopSettings;
  original: boolean;
  comparison: boolean;
  interacting: boolean;
  onError: (message: string) => void;
}

/** Refines only visible RAW pixels after zoom; the overview remains cheap and responsive. */
export function useRawDetailPreview(options: RawDetailOptions) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scheduler = useRef(new LatestPreviewScheduler());
  const surface = useRef<ReusablePreviewSurface | null>(null);
  const cachedTile = useRef<{ key: string; assetId: string } | null>(null);
  const [region, setRegion] = useState<RawDetailRegion | null>(null);

  useEffect(() => {
    surface.current = new ReusablePreviewSurface(undefined, canvas => {
      defaultImageEngine.releaseDevelopContext(canvas);
      canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = canvas.height = 0;
    });
    return () => {
      scheduler.current.cancel();
      surface.current?.dispose();
      surface.current = null;
      if (cachedTile.current) {
        defaultImageEngine.releaseAsset(cachedTile.current.assetId);
        defaultAssetManager.releaseAsset(cachedTile.current.assetId);
        cachedTile.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      scheduler.current.cancel();
      if (cachedTile.current) {
        defaultImageEngine.releaseAsset(cachedTile.current.assetId);
        defaultAssetManager.releaseAsset(cachedTile.current.assetId);
        cachedTile.current = null;
      }
    };
  }, [options.documentId, options.nativeAssetId]);

  useEffect(() => {
    scheduler.current.cancel();
    setRegion(null);
    if (!options.documentId || !options.nativeAssetId || !options.settings || options.comparison || options.interacting
      || !isTauriEnvironment() || options.viewportWidth < 32 || options.viewportHeight < 32) return;
    const wanted = computeRawDetailRegion(options.sourceWidth, options.sourceHeight,
      options.viewportWidth, options.viewportHeight, options.scale, options.panX, options.panY,
      options.previewWidth, options.previewHeight);
    if (!wanted) return;
    const values = options.original ? createDefaultDevelopSettings(true) : options.settings;
    const { read, display: displayRegion } = paddedRawDetailRegion(wanted, options.sourceWidth, options.sourceHeight,
      spatialSourceHalo(values, options.sourceWidth, options.sourceHeight));
    const timer = window.setTimeout(() => {
      scheduler.current.schedule(async isCurrent => {
        const bridge = getPlatformBridge();
        if (!bridge.getRawDisplayTile || !surface.current) return;
        const key = `${options.nativeAssetId}:${read.x}:${read.y}:${read.width}:${read.height}`;
        try {
          if (cachedTile.current?.key !== key) {
            const bytes = await bridge.getRawDisplayTile(options.nativeAssetId!, read.x, read.y, read.width, read.height);
            if (!isCurrent()) return;
            const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
            const handle = await defaultAssetManager.registerBlob(blob, 'image', 'RAW 细节区域.png', { width: read.width, height: read.height });
            try {
              await defaultImageEngine.loadAsset(handle.id, blob);
              if (!isCurrent()) return;
              if (cachedTile.current) {
                defaultImageEngine.releaseAsset(cachedTile.current.assetId);
                defaultAssetManager.releaseAsset(cachedTile.current.assetId);
              }
              cachedTile.current = { key, assetId: handle.id };
            } finally {
              if (cachedTile.current?.assetId !== handle.id) {
                defaultImageEngine.releaseAsset(handle.id);
                defaultAssetManager.releaseAsset(handle.id);
              }
            }
          }
          if (!isCurrent() || !cachedTile.current || !surface.current) return;
          const spatialAnalysis = await getRawSpatialAnalysis(options.nativeAssetId, values);
          if (!isCurrent()) return;
          const paint = (canvas: HTMLCanvasElement, forceCPU: boolean) => defaultImageEngine.renderDevelop(
            cachedTile.current!.assetId, structuredClone(values), canvas, undefined,
            { forceCPU, spatialAnalysis, sourceRect: { ...read, sourceWidth: options.sourceWidth, sourceHeight: options.sourceHeight } });
          let rendered: HTMLCanvasElement;
          try {
            rendered = await surface.current.render(read, paint);
          } catch (error) {
            if (!(error instanceof DevelopGpuError) || !isCurrent()) throw error;
            surface.current.useCPU();
            rendered = await surface.current.render(read, paint);
          }
          if (!isCurrent() || !canvasRef.current) return;
          const display = canvasRef.current;
          display.width = displayRegion.width;
          display.height = displayRegion.height;
          const context = display.getContext('2d');
          if (!context) throw new Error('细节画布不可用');
          context.drawImage(rendered, displayRegion.x - read.x, displayRegion.y - read.y,
            displayRegion.width, displayRegion.height, 0, 0, displayRegion.width, displayRegion.height);
          setRegion(displayRegion);
        } catch (error) {
          if (isCurrent()) options.onError(`原始像素细节暂不可用：${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }, 180);
    return () => { window.clearTimeout(timer); scheduler.current.cancel(); };
  }, [options.documentId, options.nativeAssetId, options.sourceWidth, options.sourceHeight,
    options.previewWidth, options.previewHeight, options.viewportWidth, options.viewportHeight,
    options.scale, options.panX, options.panY, options.settings, options.original,
    options.comparison, options.interacting, options.onError]);

  return { canvasRef, region };
}
