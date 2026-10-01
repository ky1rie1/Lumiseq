import type { DevelopSettings } from '../types/develop';
import type { HazeAnalysis } from '../engine/hazeAnalysis';
import type { NativeDevelopPayload } from './nativeDevelopPayload';
import { relativeWhiteBalanceMatrix } from '../engine/developColorMath';
import { getPlatformBridge } from '../platform';

export interface RawSpatialAnalysis {
  version: 1;
  source_width: number;
  source_height: number;
  haze: HazeAnalysis;
  /** Finest wavelet band standard deviation in sqrt-RGB opponent coordinates. */
  noise: [number,number,number];
}

export function spatialBasePayload(s: DevelopSettings): NativeDevelopPayload {
  return { exposure:s.exposure,contrast:s.contrast,highlights:s.highlights,shadows:s.shadows,
    whites:s.whites,blacks:s.blacks,white_balance_mode:s.whiteBalance.mode,
    white_balance_matrix:s.whiteBalance.mode==='auto' ? relativeWhiteBalanceMatrix(s.whiteBalance) : undefined,
    temperature:s.whiteBalance.temperature,tint:s.whiteBalance.tint,
    saturation:0,vibrance:0,curve_lut:[],hsl:[],vignette_amount:0,vignette_midpoint:50,
    texture:0,clarity:0,dehaze:0,sharpen_amount:0,sharpen_radius:1,sharpen_threshold:0,
    luma_denoise:0,chroma_denoise:0,masks:[] };
}

export function validateSpatialAnalysis(value: RawSpatialAnalysis): RawSpatialAnalysis {
  const h = value?.haze;
  if (value?.version !== 1 || !Number.isInteger(value.source_width) || value.source_width<1 ||
    !Number.isInteger(value.source_height) || value.source_height<1 || value.source_width*value.source_height>150_000_000 ||
    !Array.isArray(value.noise) || value.noise.length!==3 || value.noise.some(v=>!Number.isFinite(v)||v<0) ||
    h?.version!==1 || !Number.isInteger(h.width) || !Number.isInteger(h.height) || h.width<1 || h.height<1 ||
    Math.max(h.width,h.height)>256 || !Array.isArray(h.atmosphere) || h.atmosphere.length!==3 ||
    h.atmosphere.some(v=>!Number.isFinite(v)||v<0) || !Array.isArray(h.coefficients) ||
    h.coefficients.length!==h.width*h.height*2 || h.coefficients.some(v=>!Number.isFinite(v))) {
    throw new Error('Invalid whole-source spatial analysis');
  }
  return value;
}

export class RawSpatialAnalysisCache {
  private entries = new Map<string,Promise<RawSpatialAnalysis>>();
  constructor(private capacity = 4) {}
  get(assetId:string, settings:DevelopSettings,
    load:(assetId:string,base:NativeDevelopPayload)=>Promise<RawSpatialAnalysis>):Promise<RawSpatialAnalysis> {
    const base = spatialBasePayload(settings), key = JSON.stringify([assetId,base]);
    const previous = this.entries.get(key);
    if (previous) { this.entries.delete(key); this.entries.set(key,previous); return previous; }
    const pending = Promise.resolve().then(()=>load(assetId,base)).then(validateSpatialAnalysis);
    this.entries.set(key,pending);
    while(this.entries.size>this.capacity) this.entries.delete(this.entries.keys().next().value!);
    void pending.catch(()=>{ if(this.entries.get(key)===pending) this.entries.delete(key); });
    return pending;
  }
  clear():void { this.entries.clear(); }
}

const shared = new RawSpatialAnalysisCache();
export async function getRawSpatialAnalysis(assetId:string|undefined|null,settings:DevelopSettings):Promise<RawSpatialAnalysis|undefined> {
  if (!assetId || (!settings.dehaze && !settings.detail.lumaDenoise && !settings.detail.chromaDenoise)) return undefined;
  const bridge = getPlatformBridge();
  if (!bridge.getRawSpatialAnalysis) throw new Error('当前宿主缺少全图去雾和降噪分析接口');
  return shared.get(assetId,settings,(id,base)=>bridge.getRawSpatialAnalysis!(id,base));
}
