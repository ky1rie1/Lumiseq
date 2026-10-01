// src/ai/capabilities/CapabilityRouter.ts
//! Central AI Capability Router (Phase 5)
//! Routes Agent, Vision, Segmentation, and Image Edit tasks to configured providers with
//! Primary/Fallback support, Privacy Mode enforcement, Cost Guard, and Remote Upload notifications.

import {
  AIStackConfig,
  CostGuardConfig,
  PrivacyMode
} from '../types';
import {
  IAgentCapability,
  IImageEditCapability,
  ISegmentationCapability,
  IVisionCapability
} from './interfaces';
import { ProviderRegistry, defaultProviderRegistry } from '../providers/ProviderRegistry';
import { segmentForeground } from '../../cutout/CutoutService';
import { maskBounds } from '../../cutout/cutoutMath';
import { defaultSegmentationProvider } from '../segmentation/LocalSegmentationProvider';
import { defaultLocalInpaintingProvider } from '../inpainting/LocalInpaintingProvider';

async function encodeVisionImage(image: Blob | string): Promise<{ mimeType: string; data: string }> {
  if (typeof image === 'string') {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image);
    if (!match) throw new Error('Vision input must be an image Blob or base64 image data URL.');
    return { mimeType: match[1].toLowerCase(), data: match[2] };
  }
  const mimeType = image.type || 'image/png';
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(mimeType)) throw new Error(`Unsupported vision image type: ${mimeType}`);
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return { mimeType, data: btoa(binary) };
}

export interface RemoteUploadEvent {
  providerId: string;
  providerName: string;
  capability: 'vision' | 'image-edit' | 'segmentation';
  detail: string;
  timestamp: number;
}

export type UploadNotificationListener = (event: RemoteUploadEvent) => void;

export class CapabilityRouter {
  private stackConfig: AIStackConfig;
  private privacyMode: PrivacyMode = 'allow';
  private costGuard: CostGuardConfig = {
    askBeforeImageGeneration: true,
    askBeforeBatch: true,
    confirmAboveMegapixels: 10,
    maxBatchPhotos: 5,
  };

  private uploadListeners: Set<UploadNotificationListener> = new Set();
  private confirmRemote: (message: string) => boolean | Promise<boolean> = (message) =>
    typeof window !== 'undefined' && window.confirm(message);

  constructor(
    private providerRegistry: ProviderRegistry = defaultProviderRegistry
  ) {
    this.stackConfig = this.loadStackConfig();
    this.privacyMode = this.loadPrivacyMode();
    this.costGuard = this.loadCostGuard();
  }

  private loadCostGuard(): CostGuardConfig {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('ai_studio_cost_guard');
        if (saved) return { ...this.costGuard, ...JSON.parse(saved) };
      } catch { /* Keep defaults if old settings are damaged. */ }
    }
    return this.costGuard;
  }

  private loadStackConfig(): AIStackConfig {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('ai_studio_stack_config');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {}
      }
    }
    const defaultProv = this.providerRegistry.getActiveConfig().id || 'openai';
    return {
      agentProviderId: defaultProv,
      visionProviderId: defaultProv,
      segmentationProviderId: 'birefnet-local',
      imageEditProviderId: defaultProv,
    };
  }

  private loadPrivacyMode(): PrivacyMode {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('ai_studio_privacy_mode');
      if (saved === 'allow' || saved === 'ask' || saved === 'never') {
        return saved;
      }
    }
    return 'allow';
  }

  saveStackConfig(config: AIStackConfig): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ai_studio_stack_config', JSON.stringify(config));
    }
    this.stackConfig = { ...config };
  }

  getStackConfig(): AIStackConfig {
    return { ...this.stackConfig };
  }

  setPrivacyMode(mode: PrivacyMode): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ai_studio_privacy_mode', mode);
    }
    this.privacyMode = mode;
  }

  getPrivacyMode(): PrivacyMode {
    return this.privacyMode;
  }

  setCostGuard(config: CostGuardConfig): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ai_studio_cost_guard', JSON.stringify(config));
    }
    this.costGuard = { ...config };
  }

  getCostGuard(): CostGuardConfig {
    return { ...this.costGuard };
  }

  setRemoteConfirmationHandler(handler: (message: string) => boolean | Promise<boolean>): void {
    this.confirmRemote = handler;
  }

  private async authorizeRemote(kind: 'vision' | 'image-edit'): Promise<void> {
    if (this.privacyMode === 'never') throw new Error('PRIVACY_RESTRICTION: Image upload is disabled.');
    const needsPrivacyConsent = this.privacyMode === 'ask';
    const needsCostConsent = kind === 'image-edit' && this.costGuard.askBeforeImageGeneration;
    if (!needsPrivacyConsent && !needsCostConsent) return;
    const message = [
      needsPrivacyConsent ? '此操作会向 AI 服务上传图像数据。' : '',
      needsCostConsent ? '远程图像编辑可能产生 API 费用。' : '',
      '继续吗？',
    ].filter(Boolean).join('\n');
    if (await this.confirmRemote(message)) return;
    throw new Error(needsPrivacyConsent ? 'PRIVACY_RESTRICTION: Image upload was declined.'
      : 'COST_GUARD_BLOCKED: Remote image edit was declined.');
  }

  subscribeUploadNotice(listener: UploadNotificationListener): () => void {
    this.uploadListeners.add(listener);
    return () => this.uploadListeners.delete(listener);
  }

  notifyRemoteUpload(
    providerId: string,
    providerName: string,
    capability: 'vision' | 'image-edit' | 'segmentation',
    detail: string
  ): void {
    const event: RemoteUploadEvent = {
      providerId,
      providerName,
      capability,
      detail,
      timestamp: Date.now(),
    };
    this.uploadListeners.forEach((l) => {
      try {
        l(event);
      } catch (e) {
        console.warn('Upload notification error:', e);
      }
    });
  }

  /**
   * 1. Resolve Agent Capability (LLM planning & tool execution)
   */
  resolveAgent(targetProviderId?: string): IAgentCapability {
    const pId = targetProviderId || this.stackConfig.agentProviderId || this.providerRegistry.getActiveConfig().id;
    try {
      const provider = this.providerRegistry.getProvider(pId);
      return {
        chat: (messages, tools, onDelta, signal) => provider.chat(messages, tools, onDelta, signal),
      };
    } catch (err) {
      if (this.stackConfig.agentFallbackId && this.stackConfig.agentFallbackId !== pId) {
        const fb = this.providerRegistry.getProvider(this.stackConfig.agentFallbackId);
        return {
          chat: (messages, tools, onDelta, signal) => fb.chat(messages, tools, onDelta, signal),
        };
      }
      throw err;
    }
  }

  /**
   * 2. Resolve Vision Capability (Image comprehension & inspection)
   */
  resolveVision(targetProviderId?: string): IVisionCapability | null {
    if (this.privacyMode === 'never') {
      throw new Error('PRIVACY_RESTRICTION: Image upload is disabled by Privacy Policy.');
    }

    const pId = targetProviderId || this.stackConfig.visionProviderId || this.providerRegistry.getActiveConfig().id;
    const cfg=this.providerRegistry.getConfig(pId);
    if (!cfg) return null;
    const primary = cfg.visionModel && cfg.visionModel!==cfg.model ? this.providerRegistry.getProviderForModel(pId,cfg.visionModel) : this.providerRegistry.getProvider(pId);
    if (!primary.prepareCapabilities && primary.capabilities.vision === false && !this.stackConfig.visionFallbackId)
      throw new Error('Vision input unsupported by configured provider; configure a vision fallback explicitly.');
    const analyzeImage = async (image: Blob | string, prompt: string, signal?: AbortSignal): Promise<string> => {
      const selected = await this.prepareVisionProvider(signal, targetProviderId);
      const encoded = await encodeVisionImage(image);
      await this.authorizeVisionUpload(selected.id);
      const res = await selected.provider.chat([{ role: 'user', content: prompt, image: encoded }], [], undefined, signal);
      return res.content || '';
    };

    return {
      analyzeImage,
      locateObject: async (image, desc, signal) => {
        const answer = await analyzeImage(image, `Locate ${desc} in the image. Describe its position briefly.`, signal);
        return { description: answer };
      },
    };
  }

  /** Shared configured selection for single-image inspection and bounded before/after review. */
  async prepareVisionProvider(signal?: AbortSignal, targetProviderId?: string) {
    const primaryId = targetProviderId || this.stackConfig.visionProviderId || this.providerRegistry.getActiveConfig().id;
    for (const id of [primaryId, this.stackConfig.visionFallbackId].filter((id, i, list): id is string => !!id && list.indexOf(id) === i)) {
      const config = this.providerRegistry.getConfig(id);
      if (!config) continue;
      const provider = config.visionModel && config.visionModel !== config.model ? this.providerRegistry.getProviderForModel(id, config.visionModel) : this.providerRegistry.getProvider(id);
      await provider.prepareCapabilities?.(signal);
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      if (provider.capabilities.vision !== false) return { id, config, provider };
    }
    throw new Error('Vision input unsupported by configured provider; configure a vision fallback explicitly.');
  }

  async authorizeVisionUpload(providerId: string): Promise<void> {
    await this.authorizeRemote('vision');
    const cfg = this.providerRegistry.getConfig(providerId);
    this.notifyRemoteUpload(providerId, cfg?.name ?? providerId, 'vision', `Sending visual inspection request (${cfg?.visionModel || cfg?.model || 'configured model'})`);
  }

  /**
   * 3. Resolve Segmentation Capability (Mask generation)
   */
  resolveSegmentation(_targetProviderId?: string): ISegmentationCapability {
    // Subject/background use pinned local BiRefNet; interactive object/sky remain explicit heuristics.
    const localSubject: ISegmentationCapability['segmentSubject'] = async (image, options) => {
      if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') throw new Error('Local model inference is unavailable without browser pixel rendering.');
      return segmentForeground(image, options?.signal);
    };
    return {
      isLocalFallback: false,
      segmentSubject: localSubject,
      segmentObject: (img, prompt, opt) => {
        if (typeof prompt === 'object' && 'x' in prompt && 'y' in prompt && !('width' in prompt)) {
          return defaultSegmentationProvider.segmentPoint(img as any, prompt.x, prompt.y, opt);
        } else if (typeof prompt === 'object' && 'width' in prompt) {
          return defaultSegmentationProvider.segmentBox(img as any, prompt as any, opt);
        }
        return localSubject(img, opt);
      },
      segmentSky: (img, opt) => defaultSegmentationProvider.segmentSky(img as any, opt),
      segmentBackground: async (img, opt) => {
        const sub = await localSubject(img, opt);
        const inverted = new Uint8ClampedArray(sub.mask.length);
        for (let i = 0; i < sub.mask.length; i++) inverted[i] = 255 - sub.mask[i];
        return { ...sub, mask: inverted, bounds: maskBounds(inverted, sub.width, sub.height) };
      },
    };
  }

  /**
   * 4. Resolve Image Edit Capability (Inpainting & Generative Fill)
   */
  resolveImageEdit(targetProviderId?: string): IImageEditCapability {
    const pId = targetProviderId || this.stackConfig.imageEditProviderId;
    const cfg = pId ? this.providerRegistry.getConfig(pId) : null;

    if (!cfg || pId === 'fallback-classical') {
      // Fall back to offline Classical Content-Aware Fill
      return {
        isLocalFallback: true,
        inpaint: (ctx, mask, opt) => defaultLocalInpaintingProvider.inpaint(ctx, mask, opt),
        generativeFill: (ctx, mask, prompt, opt) => defaultLocalInpaintingProvider.inpaint(ctx, mask, { ...opt, prompt }),
      };
    }
    if (this.privacyMode === 'never') {
      throw new Error('PRIVACY_RESTRICTION: Image generation upload is disabled by Privacy Policy.');
    }

    // Wrap with GenericImageEditProvider
    const genericProvider = this.providerRegistry.getImageEditProvider(cfg.id);

    return {
      isLocalFallback: false,
      inpaint: async (ctx, mask, opt) => {
        if (!(await this.providerRegistry.hasApiKey(cfg.id))) {
          return defaultLocalInpaintingProvider.inpaint(ctx, mask, opt);
        }
        await this.authorizeRemote('image-edit');
        this.notifyRemoteUpload(cfg.id, cfg.name, 'image-edit', `Sending inpainting request (${cfg.model})`);
        return genericProvider.inpaint(ctx, mask, opt);
      },
      generativeFill: async (ctx, mask, prompt, opt) => {
        if (!(await this.providerRegistry.hasApiKey(cfg.id))) {
          return defaultLocalInpaintingProvider.inpaint(ctx, mask, { ...opt, prompt });
        }
        await this.authorizeRemote('image-edit');
        this.notifyRemoteUpload(cfg.id, cfg.name, 'image-edit', `Sending Generative Fill: "${prompt}" (${cfg.model})`);
        return genericProvider.generativeFill(ctx, mask, prompt, opt);
      },
    };
  }
}

export const defaultCapabilityRouter = new CapabilityRouter(defaultProviderRegistry);
