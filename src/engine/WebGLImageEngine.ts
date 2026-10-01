// src/engine/WebGLImageEngine.ts
import {
  ExportOptions,
  HistogramData,
  IImageEngine,
  RenderViewport
} from '../types/engine';
import { DevelopMask, DevelopSettings } from '../types/develop';
import { EditDocument, Layer, SmartObjectLayer, AdjustmentLayer } from '../types/edit';
import { layerMatrix, multiplyMatrix, inverseMatrix, linkedMaskTransform, IDENTITY, Affine } from './editTransforms';
import { BASE_TONE_VERTEX_SHADER, BASE_TONE_FRAGMENT_SHADER } from './shaders/passBaseTone';
import { SPATIAL_VERTEX_SHADER, SPATIAL_FRAGMENT_SHADER } from './shaders/passSpatialFilter';
import { COLOR_CURVE_VERTEX_SHADER, COLOR_CURVE_FRAGMENT_SHADER } from './shaders/passColorCurve';
import { DISPLAY_VERTEX_SHADER, DISPLAY_FRAGMENT_SHADER } from './shaders/passDisplay';
import { LOCAL_MASK_VERTEX_SHADER, LOCAL_MASK_FRAGMENT_SHADER } from './shaders/passLocalMask';
import { RenderGraph } from './pipeline/RenderGraph';
import { SpatialQualityPass } from './pipeline/SpatialQualityPass';
import { waveletDenoise, estimateWaveletNoise } from './waveletDenoise';
import { analyzeHaze, applyHaze } from './hazeAnalysis';
import { validateSpatialAnalysis, spatialBasePayload, type RawSpatialAnalysis } from '../app/rawSpatialAnalysis';
import { spatialPreviewPixelScale } from './spatialScale';
import { applySpatialPixel } from './developSpatialMath';
import { applyBaseTone, applyDevelopColor, applyRelativeWhiteBalance, buildDevelopCurveLUT, curvesAreNeutral, linearToSrgb, relativeWhiteBalanceMatrix, srgbToLinear, type RGB } from './developColorMath';
import { computeHistogramFromImageData } from './histogram';
import { defaultAssetManager } from '../assets/AssetManager';
import type { IAssetManager } from '../types/asset';
import { AdjustmentEngine } from './adjustments';
import { drawTextLayer, textEffectInsets } from './drawTextLayer';
import { SelectionUtils } from '../selection/SelectionUtils';
import { normalizeRawSourceRect, type RawSourceRect } from './rawSourceRect';
import { applySmartFilterStack } from '../filters/smartFilters';

interface LoadedImageSource {
  element: HTMLImageElement | ImageBitmap | HTMLCanvasElement;
  width: number;
  height: number;
}

interface LoadedDevelopMask {
  settings: DevelopMask;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface DevelopGpuResources {
  graph: RenderGraph;
  programs: Array<WebGLProgram | null>;
  lut: WebGLTexture | null;
  quality: SpatialQualityPass | null;
}

export class DevelopGpuError extends Error {}
export interface RenderingStatus {
  backend: 'webgl2' | 'canvas2d' | 'uninitialized';
  fallbackReason?: string;
}

export class WebGLImageEngine implements IImageEngine {
  readonly id = 'webgl2-engine';
  readonly name = 'WebGL 2.0 Real-time Image Engine';

  private loadedSources: Map<string, LoadedImageSource> = new Map();
  private smartFilterCache = new Map<string, { signature: string; canvas: HTMLCanvasElement }>();
  private gl: WebGL2RenderingContext | null = null;
  private offscreenCanvas: HTMLCanvasElement | null = null;

  // Multi-pass RenderGraph and modular programs
  private renderGraph: RenderGraph | null = null;
  private progBaseTone: WebGLProgram | null = null;
  private progSpatial: WebGLProgram | null = null;
  private progColorCurve: WebGLProgram | null = null;
  private progDisplay: WebGLProgram | null = null;
  private progLocalMask: WebGLProgram | null = null;
  private curveLutTexture: WebGLTexture | null = null;
  private gpuResources = new WeakMap<WebGL2RenderingContext, DevelopGpuResources>();
  private spatialQuality: SpatialQualityPass | null = null;
  private qualityAnalysis = new Map<string,RawSpatialAnalysis>();
  private renderingStatus: RenderingStatus = { backend: 'uninitialized' };

  private transientRenderBuffers = new Set<HTMLCanvasElement>();
  constructor(private readonly assets: IAssetManager = defaultAssetManager, private readonly transientBuffers = false) {}

  /** Release caches owned by a temporary observation engine. */
  releaseObservationResources(): void {
    for (const id of [...this.loadedSources.keys()]) this.releaseAsset(id);
    for (const entry of this.smartFilterCache.values()) entry.canvas.width = entry.canvas.height = 0;
    this.smartFilterCache.clear();
    this.qualityAnalysis.clear();
    for (const canvas of this.transientRenderBuffers) canvas.width = canvas.height = 1;
    this.transientRenderBuffers.clear();
  }

  getRenderingStatus(): RenderingStatus { return { ...this.renderingStatus }; }

  private saveGpuResources(): void {
    if (this.gl && this.renderGraph) this.gpuResources.set(this.gl, {
      graph: this.renderGraph,
      programs: [this.progBaseTone, this.progSpatial, this.progColorCurve, this.progDisplay, this.progLocalMask],
      lut: this.curveLutTexture,
      quality: this.spatialQuality,
    });
  }

  releaseDevelopContext(canvas: HTMLCanvasElement): void {
    let gl: WebGL2RenderingContext | null;
    try { gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null; }
    catch { return; }
    if (!gl) return;
    if (this.gl === gl) this.saveGpuResources();
    const resources = this.gpuResources.get(gl);
    if (resources) {
      resources.graph.dispose();
      resources.quality?.dispose();
      for (const program of resources.programs) if (program) gl.deleteProgram(program);
      if (resources.lut) gl.deleteTexture(resources.lut);
      this.gpuResources.delete(gl);
    }
    if (this.gl === gl) {
      this.gl = null; this.renderGraph = null; this.curveLutTexture = null;
      this.spatialQuality = null;
      this.progBaseTone = this.progSpatial = this.progColorCurve = this.progDisplay = this.progLocalMask = null;
    }
  }

  async loadAsset(assetId: string, blob: Blob): Promise<{ width: number; height: number }> {
    if (this.loadedSources.has(assetId)) {
      const existing = this.loadedSources.get(assetId)!;
      return { width: existing.width, height: existing.height };
    }

    if (typeof createImageBitmap !== 'undefined') {
      try {
        const bitmap = await createImageBitmap(blob);
        this.loadedSources.set(assetId, {
          element: bitmap,
          width: bitmap.width,
          height: bitmap.height,
        });
        return { width: bitmap.width, height: bitmap.height };
      } catch {
        // Fall back to Image element if createImageBitmap fails
      }
    }

    if (typeof Image !== 'undefined') {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const displayUrl = this.assets.getDisplayUrl(assetId);
        if (!displayUrl) {
          reject(new Error(`Asset "${assetId}" does not have a display URL.`));
          return;
        }

        img.onload = () => {
          this.loadedSources.set(assetId, {
            element: img,
            width: img.naturalWidth || 1920,
            height: img.naturalHeight || 1080,
          });
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };

        img.onerror = (e) => reject(e);
        img.src = displayUrl;
      });
    }

    throw new Error(`Image decoder is unavailable for asset "${assetId}".`);
  }

  releaseAsset(assetId: string): void {
    for (const key of this.qualityAnalysis.keys()) if(key.startsWith(`${assetId}:`)) this.qualityAnalysis.delete(key);
    const item = this.loadedSources.get(assetId);
    if (item && 'close' in item.element && typeof (item.element as any).close === 'function') {
      (item.element as any).close();
    }
    this.loadedSources.delete(assetId);
    for (const [key, cached] of this.smartFilterCache) if (cached.signature.startsWith(`${assetId}:`)) this.smartFilterCache.delete(key);
  }

  getLoadedSourceElement(assetId: string): CanvasImageSource | null {
    const item = this.loadedSources.get(assetId);
    return item ? item.element : null;
  }

  setLoadedSource(assetId: string, element: HTMLImageElement | ImageBitmap | HTMLCanvasElement, width: number, height: number): void {
    for(const key of this.qualityAnalysis.keys())if(key.startsWith(`${assetId}:`))this.qualityAnalysis.delete(key);
    this.loadedSources.set(assetId, { element, width, height });
    for (const [key, cached] of this.smartFilterCache) if (cached.signature.startsWith(`${assetId}:`)) this.smartFilterCache.delete(key);
  }

  private analyzeDevelopSource(assetId:string,source:LoadedImageSource,s:DevelopSettings):RawSpatialAnalysis {
    const key=`${assetId}:${JSON.stringify(spatialBasePayload(s))}`;
    const cached=this.qualityAnalysis.get(key);if(cached)return cached;
    const matrix=relativeWhiteBalanceMatrix(s.whiteBalance);
    const canvas=document.createElement('canvas');
    const scale=Math.min(1,256/Math.max(source.width,source.height));
    canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Spatial analysis canvas unavailable');
    context.drawImage(source.element,0,0,canvas.width,canvas.height);
    const toBase=(data:Uint8ClampedArray)=>{
      const out=new Float32Array(data.length/4*3);
      for(let i=0;i<data.length;i+=4)out.set(applyBaseTone(applyRelativeWhiteBalance(
        [srgbToLinear(data[i]/255),srgbToLinear(data[i+1]/255),srgbToLinear(data[i+2]/255)],matrix),s),i/4*3);
      return out;
    };
    const haze=analyzeHaze(toBase(context.getImageData(0,0,canvas.width,canvas.height).data),canvas.width,canvas.height);
    const pw=Math.min(32,source.width),ph=Math.min(32,source.height),estimates:number[][]=[[],[],[]];
    canvas.width=pw;canvas.height=ph;
    for(let row=0;row<7;row++)for(let column=0;column<7;column++){
      context.clearRect(0,0,pw,ph);context.drawImage(source.element,Math.floor(column*(source.width-pw)/6),Math.floor(row*(source.height-ph)/6),pw,ph,0,0,pw,ph);
      const sigma=estimateWaveletNoise(toBase(context.getImageData(0,0,pw,ph).data),pw,ph);
      for(let c=0;c<3;c++)estimates[c].push(sigma[c]);
    }
    const noise=estimates.map(values=>values.sort((a,b)=>a-b)[24]) as RGB;
    const result:RawSpatialAnalysis={version:1,source_width:source.width,source_height:source.height,haze,noise};
    this.qualityAnalysis.set(key,result);
    while(this.qualityAnalysis.size>4)this.qualityAnalysis.delete(this.qualityAnalysis.keys().next().value!);
    canvas.width=canvas.height=0;return result;
  }

  /** Reuse whole-image analysis when a separate caller subsequently renders source crops. */
  async getDevelopSpatialAnalysis(assetId: string, settings: DevelopSettings): Promise<RawSpatialAnalysis | undefined> {
    if (!settings.dehaze && !settings.detail.lumaDenoise && !settings.detail.chromaDenoise) return undefined;
    await this.getOrLoadSourceElement(assetId);
    const source = this.loadedSources.get(assetId);
    if (!source) throw new Error('Whole-source analysis image is unavailable');
    return this.analyzeDevelopSource(assetId, source, settings);
  }

  async getOrLoadSourceElement(assetId: string): Promise<CanvasImageSource | null> {
    if (!assetId) return null;
    const existing = this.loadedSources.get(assetId);
    if (existing) return existing.element;
    const blob = await this.assets.getBlob(assetId);
    if (blob) {
      await this.loadAsset(assetId, blob);
      return this.loadedSources.get(assetId)?.element || null;
    }
    return null;
  }

  /**
   * Real Develop Pipeline Pixel Rendering
   */
  async renderDevelop(
    sourceAssetId: string,
    settings: DevelopSettings,
    targetCanvas: HTMLCanvasElement,
    _viewport?: RenderViewport,
    options?: { forceCPU?: boolean; fallbackReason?: string; sourceRect?: RawSourceRect; spatialSourceSize?: { width: number; height: number }; spatialAnalysis?:RawSpatialAnalysis }
  ): Promise<void> {
    relativeWhiteBalanceMatrix(settings.whiteBalance);
    const source = this.loadedSources.get(sourceAssetId);
    if (!source) {
      // If not loaded into engine cache yet, try loading from AssetManager
      const blob = await this.assets.getBlob(sourceAssetId);
      if (blob) {
        await this.loadAsset(sourceAssetId, blob);
        return this.renderDevelop(sourceAssetId, settings, targetCanvas, _viewport, options);
      }
      throw new Error(`Source image asset "${sourceAssetId}" is unavailable.`);
    }

    let spatialAnalysis=options?.spatialAnalysis;
    if(settings.dehaze || settings.detail.lumaDenoise || settings.detail.chromaDenoise){
      if(spatialAnalysis){
        validateSpatialAnalysis(spatialAnalysis);
        const expected=options?.sourceRect
          ? {width:options.sourceRect.sourceWidth,height:options.sourceRect.sourceHeight}
          : options?.spatialSourceSize??{width:source.width,height:source.height};
        if(spatialAnalysis.source_width!==expected.width || spatialAnalysis.source_height!==expected.height)
          throw new Error('全图分析与当前照片尺寸不一致');
      }
      else if(options?.sourceRect)throw new Error('局部预览必须使用整张照片的去雾与降噪分析');
      else spatialAnalysis=this.analyzeDevelopSource(sourceAssetId,source,settings);
    }
    const masks = await Promise.all((settings.masks || []).filter((mask) => mask.opacity > 0).map(async (mask): Promise<LoadedDevelopMask> => {
      const handle = this.assets.getHandle(mask.maskAssetId);
      const data = await this.assets.getMask(mask.maskAssetId);
      if (!handle || handle.kind !== 'mask' || !handle.width || !handle.height || !data || data.length !== handle.width * handle.height) {
        throw new Error(`Develop mask "${mask.name}" (${mask.maskAssetId}) is missing or invalid.`);
      }
      return { settings: mask, data, width: handle.width, height: handle.height };
    }));

    // Try WebGL 2.0 real shader pipeline
    let gl: WebGL2RenderingContext | null = null;
    let fallbackReason = options?.fallbackReason;
    if (!options?.forceCPU) {
      try { gl = targetCanvas.getContext('webgl2', { preserveDrawingBuffer: true, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null; }
      catch (error) { fallbackReason = String(error); }
    }
    if (gl) {
      try {
        const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (typeof limit === 'number' && (targetCanvas.width > limit || targetCanvas.height > limit)) throw new Error(`Preview exceeds this device's WebGL texture limit (${limit}).`);
        if (gl.isContextLost()) throw new Error('WebGL context was lost.');
        this.renderDevelopWebGL(gl, source.element, settings, masks, targetCanvas.width, targetCanvas.height,
          options?.sourceRect, options?.spatialSourceSize ?? { width: source.width, height: source.height },spatialAnalysis);
        const error = gl.getError();
        if (typeof error === 'number' && error !== gl.NO_ERROR) throw new Error(`WebGL rendering failed (${error}).`);
        if (gl.isContextLost()) throw new Error('WebGL context was lost.');
        this.renderingStatus = { backend: 'webgl2' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.renderingStatus = { backend: 'uninitialized', fallbackReason: message };
        throw new DevelopGpuError(message);
      } finally { this.saveGpuResources(); }
      return;
    }

    try {
      if (masks.length > 0) throw new Error('Local develop masks require WebGL 2.0 rendering.');
      // Reject unsupported controls instead of silently exporting different adjustments.
      const unsupported: string[] = [];
      if (settings.optics?.vignetteAmount) unsupported.push('vignette');
      if (Object.values(settings.hsl || {}).some(value => value.hue || value.saturation || value.luminance)) unsupported.push('HSL');

      if (unsupported.length) throw new Error(`These adjustments require WebGL 2: ${unsupported.join(', ')}.`);
      const ctx = targetCanvas.getContext('2d');
      if (!ctx) throw new Error('Neither WebGL 2 nor Canvas 2D rendering is available.');
      const originalWidth = options?.sourceRect?.sourceWidth ?? options?.spatialSourceSize?.width ?? source.width;
      const originalHeight = options?.sourceRect?.sourceHeight ?? options?.spatialSourceSize?.height ?? source.height;
      this.renderDevelop2D(ctx, source.element, settings, targetCanvas.width, targetCanvas.height,
        spatialPreviewPixelScale(originalWidth, originalHeight, targetCanvas.width, targetCanvas.height, options?.sourceRect?.width ?? originalWidth),
        spatialAnalysis,targetCanvas.width/(options?.sourceRect?.width??originalWidth),options?.sourceRect ? normalizeRawSourceRect(options.sourceRect):[0,0,1,1]);
      this.renderingStatus = { backend: 'canvas2d', fallbackReason: fallbackReason || 'WebGL 2 unavailable; using basic CPU adjustments.' };
    } catch (error) {
      this.renderingStatus = { backend: 'uninitialized', fallbackReason: error instanceof Error ? error.message : String(error) };
      throw error;
    }
  }

  private renderDevelopWebGL(
    gl: WebGL2RenderingContext,
    imageSource: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
    settings: DevelopSettings,
    masks: LoadedDevelopMask[],
    width: number,
    height: number,
    sourceRect?: RawSourceRect,
    spatialSourceSize?: { width: number; height: number },
    spatialAnalysis?:RawSpatialAnalysis
  ): void {
    if (!this.renderGraph || this.gl !== gl) {
      this.saveGpuResources();
      this.gl = gl;
      const cached = this.gpuResources.get(gl);
      if (cached) {
        this.renderGraph = cached.graph; this.curveLutTexture = cached.lut;
        this.spatialQuality = cached.quality;
        [this.progBaseTone, this.progSpatial, this.progColorCurve, this.progDisplay, this.progLocalMask] = cached.programs;
      } else {
        this.renderGraph = new RenderGraph(gl);
        this.spatialQuality = null;
        this.curveLutTexture = null;
        this.progBaseTone = this.progSpatial = this.progColorCurve = this.progDisplay = this.progLocalMask = null;
        this.initModularPrograms(gl);
      }
    }

    if (!this.progBaseTone || !this.progSpatial || !this.progColorCurve || !this.progDisplay || !this.progLocalMask) {
      throw new Error('Develop rendering programs are unavailable.');
    }

    this.renderGraph.resize(width, height);
    const globalRect: [number, number, number, number] = sourceRect ? normalizeRawSourceRect(sourceRect) : [0, 0, 1, 1];

    // 1. Upload initial source image texture
    const srcTexture = gl.createTexture()!;
    try {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);
    } catch (error) {
      throw new Error(`Could not upload develop source image: ${String(error)}`);
    }

    // 2. Upload Tone Curve 1D LUT texture
    if (!this.curveLutTexture) {
      this.curveLutTexture = gl.createTexture();
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveLutTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const curveBuffer = buildDevelopCurveLUT(settings.curves);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1024, 1, 0, gl.RGBA, gl.FLOAT, curveBuffer);

    // 3. Begin multi-pass pipeline
    this.renderGraph.begin(srcTexture);

    // --- Pass 1: Base Tone (Linear Exposure, Soft-Knee Highlights/Shadows, Whites, Blacks, Guarded WB) ---
    this.renderGraph.runPass(this.progBaseTone, (readTex) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(gl.getUniformLocation(this.progBaseTone!, 'u_image'), 0);

      gl.uniform1f(gl.getUniformLocation(this.progBaseTone!, 'u_exposure'), settings.exposure);
      gl.uniform1f(gl.getUniformLocation(this.progBaseTone!, 'u_contrast'), settings.contrast);
      gl.uniform1f(gl.getUniformLocation(this.progBaseTone!, 'u_highlights'), settings.highlights);
      gl.uniform1f(gl.getUniformLocation(this.progBaseTone!, 'u_shadows'), settings.shadows);
      gl.uniform1f(gl.getUniformLocation(this.progBaseTone!, 'u_whites'), settings.whites);
      gl.uniform1f(gl.getUniformLocation(this.progBaseTone!, 'u_blacks'), settings.blacks);

      const wbMode = settings.whiteBalance.mode === 'as-shot' ? 0 : (settings.whiteBalance.mode === 'custom' ? 1 : 2);
      gl.uniform1i(gl.getUniformLocation(this.progBaseTone!, 'u_wb_mode'), wbMode);
      // Guard against double multiplication
      // Every current source is decoded display RGB with camera WB already applied.
      const wbApplied = 1;
      gl.uniform1i(gl.getUniformLocation(this.progBaseTone!, 'u_white_balance_applied'), wbApplied);

      const multipliers = settings.whiteBalance.cameraMultipliers || [1.0, 1.0, 1.0, 1.0];
      const gGain = multipliers[1] > 0 ? multipliers[1] : 1.0;
      gl.uniform3f(
        gl.getUniformLocation(this.progBaseTone!, 'u_camera_wb'),
        multipliers[0] / gGain,
        1.0,
        multipliers[2] / gGain
      );

      const matrix = relativeWhiteBalanceMatrix(settings.whiteBalance);
      gl.uniformMatrix3fv(gl.getUniformLocation(this.progBaseTone!, 'u_wb_matrix'), false, new Float32Array([matrix[0],matrix[3],matrix[6],matrix[1],matrix[4],matrix[7],matrix[2],matrix[5],matrix[8]]));
    }, false);

    const sourceWidth=sourceRect?.sourceWidth??spatialSourceSize?.width??width;
    const nativePixelScale=width/(sourceRect?.width??sourceWidth);
    if(spatialAnalysis && !this.spatialQuality)this.spatialQuality=new SpatialQualityPass(gl);
    if(spatialAnalysis)this.spatialQuality!.denoise(this.renderGraph,width,height,settings,spatialAnalysis,nativePixelScale);
    // --- Pass 2: Detail filter on denoised pixels ---
    this.renderGraph.runPass(this.progSpatial, (readTex) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(gl.getUniformLocation(this.progSpatial!, 'u_image'), 0);
      gl.uniform2f(gl.getUniformLocation(this.progSpatial!, 'u_texel_size'), 1.0 / width, 1.0 / height);
      const originalWidth = sourceRect?.sourceWidth ?? spatialSourceSize?.width ?? width;
      const originalHeight = sourceRect?.sourceHeight ?? spatialSourceSize?.height ?? height;
      gl.uniform1f(gl.getUniformLocation(this.progSpatial!, 'u_spatial_scale'),
        spatialPreviewPixelScale(originalWidth, originalHeight, width, height, sourceRect?.width ?? originalWidth));

      gl.uniform1f(gl.getUniformLocation(this.progSpatial!, 'u_texture'), settings.texture);
      gl.uniform1f(gl.getUniformLocation(this.progSpatial!, 'u_clarity'), settings.clarity);

      const detail = settings.detail || { sharpenAmount: 0, sharpenRadius: 1.0, sharpenThreshold: 0, lumaDenoise: 0, chromaDenoise: 0 };
      gl.uniform1f(gl.getUniformLocation(this.progSpatial!, 'u_sharpen_amount'), detail.sharpenAmount);
      gl.uniform1f(gl.getUniformLocation(this.progSpatial!, 'u_sharpen_radius'), detail.sharpenRadius);
      gl.uniform1f(gl.getUniformLocation(this.progSpatial!, 'u_sharpen_threshold'), detail.sharpenThreshold);
    }, false);

    if(spatialAnalysis)this.spatialQuality!.dehaze(this.renderGraph,spatialAnalysis,settings.dehaze,globalRect);

    // --- Pass 3: Color, HSL 8-Channel Mixer, Vibrance, 1D LUT Tone Curve ---
    this.renderGraph.runPass(this.progColorCurve, (readTex) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(gl.getUniformLocation(this.progColorCurve!, 'u_image'), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curveLutTexture);
      gl.uniform1i(gl.getUniformLocation(this.progColorCurve!, 'u_curve_lut'), 1);

      gl.uniform1i(gl.getUniformLocation(this.progColorCurve!, 'u_curve_enabled'), curvesAreNeutral(settings.curves) ? 0 : 1);
      gl.uniform1i(gl.getUniformLocation(this.progColorCurve!, 'u_hsl_enabled'), Object.values(settings.hsl || {}).some(value => value.hue || value.saturation || value.luminance) ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(this.progColorCurve!, 'u_vibrance'), settings.vibrance);
      gl.uniform1f(gl.getUniformLocation(this.progColorCurve!, 'u_saturation'), settings.saturation);

      const hsl = settings.hsl;
      const getHslVec = (ch: any) => {
        const s = (hsl as any)?.[ch] || { hue: 0, saturation: 0, luminance: 0 };
        return [s.hue * 0.3, 1.0 + s.saturation / 100, s.luminance / 200];
      };

      const setHslUniform = (name: string, ch: any) => {
        const v = getHslVec(ch);
        gl.uniform3f(gl.getUniformLocation(this.progColorCurve!, name), v[0], v[1], v[2]);
      };

      setHslUniform('u_hsl_red', 'red');
      setHslUniform('u_hsl_orange', 'orange');
      setHslUniform('u_hsl_yellow', 'yellow');
      setHslUniform('u_hsl_green', 'green');
      setHslUniform('u_hsl_aqua', 'aqua');
      setHslUniform('u_hsl_blue', 'blue');
      setHslUniform('u_hsl_purple', 'purple');
      setHslUniform('u_hsl_magenta', 'magenta');
    }, false);

    // Apply local masks in document order, preserving the underlying image outside each mask.
    for (const mask of masks) {
      const maskTexture = gl.createTexture();
      if (!maskTexture) throw new Error(`Could not allocate texture for develop mask "${mask.settings.name}".`);
      try {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, maskTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

        this.renderGraph.runPass(this.progLocalMask, (readTex) => {
          const program = this.progLocalMask!;
          const local = mask.settings;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, readTex);
          gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, maskTexture);
          gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 2);
          gl.uniform4f(gl.getUniformLocation(program, 'u_source_rect'), ...globalRect);
          gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), Math.max(0, Math.min(1, local.opacity)));
          gl.uniform1i(gl.getUniformLocation(program, 'u_inverted'), local.inverted ? 1 : 0);
          gl.uniform1f(gl.getUniformLocation(program, 'u_exposure'), local.exposure ?? 0);
          gl.uniform1f(gl.getUniformLocation(program, 'u_temperature'), local.temperature ?? 0);
          gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), local.contrast ?? 0);
          gl.uniform1f(gl.getUniformLocation(program, 'u_highlights'), local.highlights ?? 0);
          gl.uniform1f(gl.getUniformLocation(program, 'u_shadows'), local.shadows ?? 0);
          gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), local.saturation ?? 0);
        }, false);
      } finally {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.deleteTexture(maskTexture);
      }
    }

    // --- Pass 4: Final Display Pass (Vignette & Linear -> sRGB Display EOTF) ---
    this.renderGraph.runPass(this.progDisplay, (readTex) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(gl.getUniformLocation(this.progDisplay!, 'u_image'), 0);
      gl.uniform4f(gl.getUniformLocation(this.progDisplay!, 'u_source_rect'), ...globalRect);

      const optics = settings.optics || { vignetteAmount: 0, vignetteMidpoint: 50 };
      gl.uniform1f(gl.getUniformLocation(this.progDisplay!, 'u_vignette_amount'), optics.vignetteAmount);
      gl.uniform1f(gl.getUniformLocation(this.progDisplay!, 'u_vignette_midpoint'), optics.vignetteMidpoint);
    }, true);

    } finally { gl.deleteTexture(srcTexture); }
  }

  private initModularPrograms(gl: WebGL2RenderingContext): void {
    const compile = (vsSrc: string, fsSrc: string) => {
      const vs = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vs, vsSrc);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        const reason = gl.getShaderInfoLog(vs) || 'unknown vertex shader error';
        gl.deleteShader(vs);
        throw new Error(`Develop vertex shader failed: ${reason}`);
      }

      const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fs, fsSrc);
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        const reason = gl.getShaderInfoLog(fs) || 'unknown fragment shader error';
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        throw new Error(`Develop fragment shader failed: ${reason}`);
      }

      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const reason = gl.getProgramInfoLog(prog) || 'unknown link error';
        gl.deleteProgram(prog);
        throw new Error(`Develop shader program failed: ${reason}`);
      }
      return prog;
    };

    this.progBaseTone = compile(BASE_TONE_VERTEX_SHADER, BASE_TONE_FRAGMENT_SHADER);
    this.progSpatial = compile(SPATIAL_VERTEX_SHADER, SPATIAL_FRAGMENT_SHADER);
    this.progColorCurve = compile(COLOR_CURVE_VERTEX_SHADER, COLOR_CURVE_FRAGMENT_SHADER);
    this.progDisplay = compile(DISPLAY_VERTEX_SHADER, DISPLAY_FRAGMENT_SHADER);
    this.progLocalMask = compile(LOCAL_MASK_VERTEX_SHADER, LOCAL_MASK_FRAGMENT_SHADER);
  }

  /**
   * Canvas 2D fallback with real pixel transformation (Linear exposure, tone, curve LUT & HSL)
   */
  private renderDevelop2D(
    ctx: CanvasRenderingContext2D,
    imageSource: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
    settings: DevelopSettings,
    width: number,
    height: number,
    spatialScale = 1,
    spatialAnalysis?:RawSpatialAnalysis,
    nativePixelScale=1,
    sourceRect:[number,number,number,number]=[0,0,1,1]
  ): void {
    ctx.clearRect(0, 0, width, height);

    try {
      ctx.drawImage(imageSource, 0, 0, width, height);
    } catch (error) {
      throw new Error(`Could not draw CPU develop source: ${String(error)}`);
    }

    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;
      const curveLUT = buildDevelopCurveLUT(settings.curves);
      const matrix = relativeWhiteBalanceMatrix(settings.whiteBalance);
      const base = new Float32Array(width * height * 3);
      for (let i = 0; i < data.length; i += 4) {
        const input = [srgbToLinear(data[i]/255),srgbToLinear(data[i+1]/255),srgbToLinear(data[i+2]/255)] as RGB;
        base.set(applyBaseTone(applyRelativeWhiteBalance(input,matrix),settings), i / 4 * 3);
      }
      const filtered=spatialAnalysis ? waveletDenoise(base,width,height,settings.detail.lumaDenoise,settings.detail.chromaDenoise,
        spatialAnalysis.noise.map(v=>v*Math.min(1,nativePixelScale)) as RGB,nativePixelScale) : base;
      const detailSettings={...settings,dehaze:0,detail:{...settings.detail,lumaDenoise:0,chromaDenoise:0}};
      for (let i = 0; i < data.length; i += 4) {
        const index = i / 4;
        let spatial=applySpatialPixel(filtered,width,height,index % width,Math.floor(index/width),detailSettings,spatialScale);
        if(spatialAnalysis && settings.dehaze)spatial=applyHaze(spatial,spatialAnalysis.haze,
          sourceRect[0]+(index%width+.5)/width*sourceRect[2],sourceRect[1]+(Math.floor(index/width)+.5)/height*sourceRect[3],settings.dehaze);
        const color = applyDevelopColor(spatial,settings,curveLUT);
        for(let c=0;c<3;c++) data[i+c] = Math.round(Math.max(0,Math.min(1,linearToSrgb(color[c])))*255);
      }

      ctx.putImageData(imgData, 0, 0);
    } catch (error) {
      throw new Error(`CPU develop pixels are unavailable: ${String(error)}`);
    }
  }

  /**
   * Real multi-layer compositing for Edit Workspace (Section 9)
   */
  async renderEdit(
    document: EditDocument,
    targetCanvas: HTMLCanvasElement,
    viewport?: RenderViewport,
    previewBackdrop?: (context: CanvasRenderingContext2D, documentRect: { x: number; y: number; width: number; height: number }) => void,
    layerOverrides?: Map<string, CanvasImageSource>,
    options?: { sourceRegion?: { x: number; y: number; width: number; height: number } }
  ): Promise<void> {
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) throw new Error('Canvas render context is unavailable.');

    const preload = async (layers: Layer[]): Promise<void> => {
      for (const layer of layers) {
        if (!layer.visible || layer.opacity <= 0) continue;
        if (layer.type === 'group') { await preload(layer.children); continue; }
        if (layer.type === 'develop-smart-object') throw new Error('Develop smart objects cannot currently be rendered in Edit.');
        const assetId = 'sourceAssetId' in layer ? layer.sourceAssetId : 'rasterAssetId' in layer ? layer.rasterAssetId : undefined;
        if (assetId && !layerOverrides?.has(layer.id) && !this.loadedSources.has(assetId)) {
          const blob = await this.assets.getBlob(assetId);
          if (!blob) throw new Error(`Image asset "${assetId}" is unavailable.`);
          await this.loadAsset(assetId, blob);
        }
      }
    };
    await preload(document.layers);

    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

    // Calculate scaling to fit target canvas while maintaining document aspect ratio and viewport zoom/pan
    const baseScale = Math.min(
      targetCanvas.width / document.width,
      targetCanvas.height / document.height
    );
    const zoom = viewport?.zoom ?? 1.0;
    const scale = baseScale * zoom;
    const panX = viewport?.panX ?? 0;
    const panY = viewport?.panY ?? 0;

    const region = options?.sourceRegion;
    if (region && (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > document.width || region.y + region.height > document.height)) throw new Error('Invalid Edit render source region');
    const scaleX = region ? targetCanvas.width / region.width : scale;
    const scaleY = region ? targetCanvas.height / region.height : scale;
    const offsetX = region ? -region.x * scaleX : (targetCanvas.width - document.width * scale) / 2 + panX;
    const offsetY = region ? -region.y * scaleY : (targetCanvas.height - document.height * scale) / 2 + panY;

    // Workspace-only backdrop. Export callers omit it and retain the document background.
    if (previewBackdrop) previewBackdrop(ctx, { x: offsetX, y: offsetY, width: document.width * scale, height: document.height * scale });
    else {
      ctx.fillStyle = document.backgroundColor || '#121215';
      ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    }

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scaleX, scaleY);

    try {
      const hasAdjustments = (layers: Layer[]): boolean => layers.some(layer => layer.visible && layer.opacity > 0 &&
        (layer.type === 'adjustment' || (layer.type === 'group' && hasAdjustments(layer.children))));
      if (hasAdjustments(document.layers)) {
        // Adjust the document pixels independently of the viewport/checker backdrop.
        const content = this.createEditBuffer(document.width, document.height);
        const contentCtx = content.getContext('2d');
        if (!contentCtx) throw new Error('Document render context is unavailable.');
        contentCtx.fillStyle = document.backgroundColor || '#121215';
        contentCtx.fillRect(0, 0, content.width, content.height);
        await this.renderLayers(contentCtx, document.layers, document, IDENTITY, layerOverrides);
        ctx.drawImage(content, 0, 0);
      } else await this.renderLayers(ctx, document.layers, document, IDENTITY, layerOverrides);
    }
    finally { ctx.restore(); }
  }

  private async renderLayers(
    ctx: CanvasRenderingContext2D,
    layers: Layer[],
    document: EditDocument,
    parent: Affine,
    layerOverrides?: Map<string, CanvasImageSource>
  ): Promise<void> {
    for (const layer of layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const world = multiplyMatrix(parent, layerMatrix(layer.transform));
      if (layer.type === 'adjustment') {
        await this.renderAdjustmentLayer(ctx, layer, world);
        continue;
      }
      ctx.save();
      try {
        ctx.globalAlpha *= Math.max(0, Math.min(1, layer.opacity));
        ctx.globalCompositeOperation = layer.blendMode === 'normal' ? 'source-over' : layer.blendMode;
        ctx.translate(layer.transform.x, layer.transform.y);
        if (layer.transform.rotation) ctx.rotate(layer.transform.rotation * Math.PI / 180);
        if (layer.transform.scaleX !== 1 || layer.transform.scaleY !== 1) ctx.scale(layer.transform.scaleX, layer.transform.scaleY);
        if (layer.type === 'group') {
          if (layer.opacity === 1 && layer.blendMode === 'normal' && !layer.mask?.enabled) {
            await this.renderLayers(ctx, layer.children, document, world, layerOverrides);
            continue;
          }
          // Isolate group opacity/blending once, so overlapping children do not multiply it twice.
          const groupCanvas = this.createEditBuffer(document.width, document.height);
          const groupCtx = groupCanvas.getContext('2d');
          if (!groupCtx) throw new Error('Group render context is unavailable.');
          groupCtx.transform(...world);
          await this.renderLayers(groupCtx, layer.children, document, world, layerOverrides);
          if (layer.mask?.enabled) {
            groupCtx.setTransform(1, 0, 0, 1, 0, 0);
            await this.applyDocumentMask(groupCtx, layer, world);
          }
          ctx.transform(...inverseMatrix(world));
          ctx.drawImage(groupCanvas, 0, 0);
        } else if (layer.mask && layer.mask.enabled !== false) await this.renderMaskedLayer(ctx, layer, world, layerOverrides);
        else this.renderDirectLayer(ctx, layer, layerOverrides);
      } finally { ctx.restore(); }
    }
  }

  private createEditBuffer(width: number, height: number): HTMLCanvasElement {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 32767 || height > 32767 || width * height > 64 * 1024 * 1024) throw new Error('Layer exceeds the supported render buffer size.');
    if (typeof window === 'undefined') throw new Error('Canvas rendering is unavailable.');
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
    if (this.transientBuffers) this.transientRenderBuffers.add(canvas);
    return canvas;
  }

  /**
   * Render individual layer content directly
   */
  private renderDirectLayer(ctx: CanvasRenderingContext2D, layer: any, layerOverrides?: Map<string, CanvasImageSource>): void {
    if (layerOverrides && layerOverrides.has(layer.id)) {
      const override = layerOverrides.get(layer.id)!;
      ctx.drawImage(override, 0, 0, layer.transform.width, layer.transform.height);
      return;
    }
    if (layer.type === 'image') {
      const source = this.loadedSources.get(layer.sourceAssetId);
      if (source) {
        ctx.drawImage(source.element, 0, 0, layer.transform.width, layer.transform.height);
      } else {
        const url = this.assets.getDisplayUrl(layer.sourceAssetId);
        if (url && typeof Image !== 'undefined') {
          const img = new Image();
          img.src = url;
          if (img.complete) {
            ctx.drawImage(img, 0, 0, layer.transform.width, layer.transform.height);
          }
        }
      }
    } else if (layer.type === 'generated-patch') {
      const source = this.loadedSources.get(layer.sourceAssetId);
      const w = layer.bounds?.width || layer.transform.width;
      const h = layer.bounds?.height || layer.transform.height;
      if (source) {
        ctx.drawImage(source.element, 0, 0, w, h);
      } else {
        const url = this.assets.getDisplayUrl(layer.sourceAssetId);
        if (url && typeof Image !== 'undefined') {
          const img = new Image();
          img.src = url;
          if (img.complete) {
            ctx.drawImage(img, 0, 0, w, h);
          }
        }
      }
    } else if (layer.type === 'paint' || layer.type === 'retouch') {
      const assetId = layer.rasterAssetId;
      const source = this.loadedSources.get(assetId);
      if (source) {
        ctx.drawImage(source.element, 0, 0, layer.transform.width, layer.transform.height);
      } else {
        const url = this.assets.getDisplayUrl(assetId);
        if (url && typeof Image !== 'undefined') {
          const img = new Image();
          img.src = url;
          if (img.complete) {
            ctx.drawImage(img, 0, 0, layer.transform.width, layer.transform.height);
          }
        }
      }
    } else if (layer.type === 'smart-object') {
      const assetId = layer.sourceAssetId;
      const source = this.loadedSources.get(assetId);
      if (source) {
        this.renderSmartObject(ctx, layer, source.element);
      } else {
        const url = this.assets.getDisplayUrl(assetId);
        if (url && typeof Image !== 'undefined') {
          const img = new Image();
          img.src = url;
          if (img.complete) {
            this.renderSmartObject(ctx, layer, img);
          }
        }
      }
    } else if (layer.type === 'text') {
      drawTextLayer(ctx, layer);
    }
  }

  private async renderAdjustmentLayer(ctx: CanvasRenderingContext2D, layer: AdjustmentLayer, world: Affine): Promise<void> {
    const width = ctx.canvas.width, height = ctx.canvas.height;
    const original = ctx.getImageData(0, 0, width, height);
    const base = this.createEditBuffer(width, height);
    const effect = this.createEditBuffer(width, height);
    const baseCtx = base.getContext('2d'), effectCtx = effect.getContext('2d');
    if (!baseCtx || !effectCtx) throw new Error('Adjustment render context is unavailable.');
    const opaque = baseCtx.createImageData(width, height);
    opaque.data.set(original.data);
    // Adjust colors without accumulating the backdrop alpha a second time.
    for (let i = 3; i < opaque.data.length; i += 4) opaque.data[i] = original.data[i] > 0 ? 255 : 0;
    baseCtx.putImageData(opaque, 0, 0);
    AdjustmentEngine.apply(opaque.data, layer.settings);
    effectCtx.putImageData(opaque, 0, 0);
    if (layer.mask?.enabled) await this.applyDocumentMask(effectCtx, layer, world);
    baseCtx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    baseCtx.globalCompositeOperation = layer.blendMode === 'normal' ? 'source-over' : layer.blendMode;
    baseCtx.drawImage(effect, 0, 0);
    const blended = baseCtx.getImageData(0, 0, width, height);
    for (let i = 3; i < blended.data.length; i += 4) blended.data[i] = original.data[i];
    ctx.putImageData(blended, 0, 0);
  }

  /** Bake content-space pixels; the raster layer keeps its transform, mask and compositing properties. */
  async rasterizeSmartObjectContent(layer: SmartObjectLayer): Promise<{ blob: Blob; width: number; height: number }> {
    if (!this.loadedSources.has(layer.sourceAssetId)) {
      const blob = await this.assets.getBlob(layer.sourceAssetId);
      if (!blob) throw new Error(`Image asset "${layer.sourceAssetId}" is unavailable.`);
      await this.loadAsset(layer.sourceAssetId, blob);
    }
    const width = Math.ceil(layer.transform.width), height = Math.ceil(layer.transform.height);
    const canvas = this.createEditBuffer(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Rasterization context is unavailable.');
    this.renderSmartObject(context, { ...layer, transform: { ...layer.transform, width, height } }, this.loadedSources.get(layer.sourceAssetId)!.element);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Smart Object rasterization failed.')), 'image/png'));
    return { blob, width, height };
  }

  private renderSmartObject(ctx: CanvasRenderingContext2D, layer: SmartObjectLayer, source: CanvasImageSource): void {
    const filters = layer.smartFilters || [];
    if (!filters.some((filter) => filter.enabled && filter.opacity > 0)) {
      ctx.drawImage(source, 0, 0, layer.transform.width, layer.transform.height);
      return;
    }
    const width = Math.max(1, Math.ceil(layer.transform.width));
    const height = Math.max(1, Math.ceil(layer.transform.height));
    const signature = `${layer.sourceAssetId}:${width}x${height}:${JSON.stringify(filters)}`;
    let cached = this.smartFilterCache.get(layer.id);
    if (!cached || cached.signature !== signature) {
      const canvas = this.createEditBuffer(width, height);
      const filterContext = canvas.getContext('2d', { willReadFrequently: true });
      if (!filterContext) throw new Error('Smart filter render context is unavailable.');
      filterContext.drawImage(source, 0, 0, width, height);
      const image = filterContext.getImageData(0, 0, width, height);
      image.data.set(applySmartFilterStack(image.data, width, height, filters));
      filterContext.putImageData(image, 0, 0);
      cached = { signature, canvas };
      this.smartFilterCache.set(layer.id, cached);
    }
    ctx.drawImage(cached.canvas, 0, 0, layer.transform.width, layer.transform.height);
  }

  /**
   * Non-destructive layer mask compositing using isolated offscreen buffer (Section 9)
   */
  private async renderMaskedLayer(
    targetCtx: CanvasRenderingContext2D,
    layer: Layer,
    world: Affine,
    layerOverrides?: Map<string, CanvasImageSource>
  ): Promise<void> {
    const insets = layer.type === 'text' ? textEffectInsets(layer) : { left: 0, right: 0, top: 0, bottom: 0 };
    const textHeight = layer.type === 'text' ? Math.max(layer.transform.height, layer.text.split(/\r\n|\r|\n/).length * layer.fontSize * (layer.lineHeight ?? 1.2)) : layer.transform.height;
    const offscreen = this.createEditBuffer(layer.transform.width + insets.left + insets.right, textHeight + insets.top + insets.bottom);
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) throw new Error('Masked layer render context is unavailable.');
    offCtx.translate(insets.left, insets.top);
    this.renderDirectLayer(offCtx, layer, layerOverrides);
    offCtx.save();
    try {
      offCtx.transform(...inverseMatrix(world));
      await this.applyDocumentMask(offCtx, layer, world);
    } finally { offCtx.restore(); }
    targetCtx.drawImage(offscreen, -insets.left, -insets.top);
  }

  private async applyDocumentMask(ctx: CanvasRenderingContext2D, layer: Layer, world: Affine): Promise<void> {
    const mask = layer.mask!;
    const data = await this.assets.getMask(mask.assetId);
    const handle = this.assets.getHandle(mask.assetId);
    if (!data || !handle || !Number.isSafeInteger(handle.width) || !Number.isSafeInteger(handle.height) || handle.width! < 1 || handle.height! < 1 || data.length !== handle.width! * handle.height!) throw new Error(`Layer mask "${mask.assetId}" is unavailable or has invalid dimensions.`);
    // Captured masks retain their own pixel grid; linkedMaskTransform maps it to
    // the current layer after a layer or canvas resize, without duplicating assets.
    const maskWidth = handle.width!, maskHeight = handle.height!;
    const density = mask.density ?? 1;
    const feather = mask.feather ?? 0;
    if (!Number.isFinite(density) || density < 0 || density > 1 || !Number.isFinite(feather) || feather < 0 || feather > 2048) throw new Error('Layer mask density or feather is invalid.');
    const canvas = this.createEditBuffer(maskWidth, maskHeight);
    const maskCtx = canvas.getContext('2d');
    if (!maskCtx) throw new Error('Layer mask context is unavailable.');
    const pixels = maskCtx.createImageData(maskWidth, maskHeight);
    const feathered = feather > 0 ? SelectionUtils.featherMask(data, maskWidth, maskHeight, feather) : data;
    for (let i = 0; i < data.length; i++) pixels.data[i * 4 + 3] = Math.round((mask.inverted ? 255 - feathered[i] : feathered[i]) * density + 255 * (1 - density));
    maskCtx.putImageData(pixels, 0, 0);
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.filter = 'none';
      ctx.transform(...linkedMaskTransform(world, mask, layer.transform));
      ctx.drawImage(canvas, 0, 0);
    } finally { ctx.restore(); }
  }

  /**
   * Real 256-bin Histogram Computation (Section 7)
   */
  async computeHistogram(sourceCanvas: HTMLCanvasElement): Promise<HistogramData> {
    try {
      const gl = sourceCanvas.getContext('webgl2');
      if (gl) {
        const width = sourceCanvas.width;
        const height = sourceCanvas.height;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return computeHistogramFromImageData(pixels, pixels.length);
      }

      const ctx = sourceCanvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        return computeHistogramFromImageData(imgData.data, imgData.data.length);
      }
    } catch (err) {
      console.warn('Could not extract canvas pixels for histogram:', err);
    }

    // Default neutral empty histogram
    return {
      r: new Array(256).fill(0),
      g: new Array(256).fill(0),
      b: new Array(256).fill(0),
      lum: new Array(256).fill(0),
      maxCount: 1,
    };
  }

  /**
   * Real Export without modifying source asset (Section 12)
   */
  async exportDevelopImage(
    sourceAssetId: string,
    settings: DevelopSettings,
    options: ExportOptions
  ): Promise<Blob> {
    if (!this.loadedSources.has(sourceAssetId)) {
      const blob = await this.assets.getBlob(sourceAssetId);
      if (!blob) throw new Error(`Source image asset "${sourceAssetId}" is unavailable.`);
      await this.loadAsset(sourceAssetId, blob);
    }
    const source = this.loadedSources.get(sourceAssetId)!;
    const width = options.width || source.width;
    const height = options.height || source.height;

    let canvas = this.getOrCreateOffscreenCanvas(width, height);
    try { await this.renderDevelop(sourceAssetId, settings, canvas); }
    catch (error) {
      if (!(error instanceof DevelopGpuError)) throw error;
      this.releaseDevelopContext(canvas);
      const gl = canvas.getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = canvas.height = 0;
      // WebGL canvases cannot change to a 2D context; preserve output size on a fresh surface.
      this.offscreenCanvas = null;
      canvas = this.getOrCreateOffscreenCanvas(width, height);
      await this.renderDevelop(sourceAssetId, settings, canvas, undefined, { forceCPU: true, fallbackReason: error.message });
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to export develop image to blob.'));
        },
        `image/${options.format}`,
        options.quality ?? 0.92
      );
    });
  }

  async exportEditImage(
    document: EditDocument,
    options: ExportOptions
  ): Promise<Blob> {
    const width = options.width || document.width;
    const height = options.height || document.height;
    let canvas: HTMLCanvasElement;
    if (document.cropRect) {
      const crop = document.cropRect;
      const x = Math.max(0, Math.min(document.width, crop.x));
      const y = Math.max(0, Math.min(document.height, crop.y));
      const sourceWidth = Math.max(0, Math.min(document.width - x, crop.width));
      const sourceHeight = Math.max(0, Math.min(document.height - y, crop.height));
      if (sourceWidth < 1 || sourceHeight < 1) throw new Error('Crop rectangle is outside the document.');
      const source = this.getOrCreateOffscreenCanvas(document.width, document.height);
      await this.renderEdit(document, source);
      canvas = globalThis.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Crop export context is unavailable.');
      context.drawImage(source, x, y, sourceWidth, sourceHeight, 0, 0, width, height);
    } else {
      canvas = this.getOrCreateOffscreenCanvas(width, height);
      await this.renderEdit(document, canvas);
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to export edit image to blob.'));
        },
        `image/${options.format}`,
        options.quality ?? 0.92
      );
    });
  }

  private getOrCreateOffscreenCanvas(width: number, height: number): HTMLCanvasElement {
    if (!this.offscreenCanvas && typeof document !== 'undefined') {
      this.offscreenCanvas = document.createElement('canvas');
    }
    if (this.offscreenCanvas) {
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
      return this.offscreenCanvas;
    }
    throw new Error('Canvas element creation is not supported in this environment.');
  }
}

export const defaultImageEngine = new WebGLImageEngine();
