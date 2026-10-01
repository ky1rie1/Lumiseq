// src/ai/providers/GenericImageEditProvider.ts
//! Generic Image Edit Provider supporting OpenAI Image Edits (multipart/form-data)
//! and Generic REST (in-memory temporary payload) without leaking base64 into logs or state.

import { IImageEditCapability } from '../capabilities/interfaces';
import { InpaintingOptions } from '../inpainting/types';
import { ProviderConfig } from '../types';
import { Redactor } from '../security/Redactor';
import { defaultLocalInpaintingProvider } from '../inpainting/LocalInpaintingProvider';

export class GenericImageEditProvider implements IImageEditCapability {
  readonly isLocalFallback = false;

  constructor(
    private config: ProviderConfig,
    private apiKeyProvider: () => Promise<string>
  ) {}

  async inpaint(
    contextImage: Blob,
    mask: Blob,
    options?: InpaintingOptions
  ): Promise<Blob> {
    const apiKey = await this.apiKeyProvider();
    if (!apiKey) {
      // Graceful offline emergency fallback when no remote API key is configured
      return defaultLocalInpaintingProvider.inpaint(contextImage, mask, options);
    }

    const style = this.config.imageEditConfig?.style || 'openai-edits';
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const model = this.config.imageEditConfig?.imageEditModel?.trim()
      || (this.config.type === 'openai' ? 'gpt-image-2' : style === 'generic-rest' ? this.config.model : '');
    if (!model) throw new Error('Image edit model ID is required for this service.');

    if (style === 'openai-edits') {
      return this.executeOpenAIEdits(baseUrl, apiKey, model, contextImage, mask, options);
    } else {
      return this.executeGenericRest(baseUrl, apiKey, model, contextImage, mask, options);
    }
  }

  async generativeFill(
    contextImage: Blob,
    mask: Blob,
    prompt: string,
    options?: InpaintingOptions
  ): Promise<Blob> {
    return this.inpaint(contextImage, mask, {
      ...options,
      prompt,
    });
  }

  private async executeOpenAIEdits(
    baseUrl: string,
    apiKey: string,
    model: string,
    contextImage: Blob,
    mask: Blob,
    options?: InpaintingOptions
  ): Promise<Blob> {
    const endpoint = this.config.imageEditConfig?.endpoint || `${baseUrl}/images/edits`;
    const formData = new FormData();
    formData.append('image', contextImage, 'image.png');
    formData.append('mask', mask, 'mask.png');
    formData.append('prompt', options?.prompt || 'Seamlessly blend and fill the masked region with surrounding background texture.');
    formData.append('model', model);
    formData.append('n', '1');
    formData.append('size', '1024x1024');

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData,
      signal: options?.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Image edit failed (${response.status}): ${Redactor.redact(errText)}`);
    }

    const data = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (b64) {
      return this.base64ToBlob(b64);
    }

    const url = data.data?.[0]?.url;
    if (url) {
      const imgRes = await fetch(url);
      return await imgRes.blob();
    }

    throw new Error('Image edit response did not contain b64_json or url in data array.');
  }

  private async executeGenericRest(
    baseUrl: string,
    apiKey: string,
    model: string,
    contextImage: Blob,
    mask: Blob,
    options?: InpaintingOptions
  ): Promise<Blob> {
    const endpoint = this.config.imageEditConfig?.endpoint || `${baseUrl}/images/edits`;

    // Ephemeral in-memory base64 conversion
    let imageB64 = await this.blobToBase64(contextImage);
    let maskB64 = await this.blobToBase64(mask);

    const payload = {
      model,
      image: imageB64,
      mask: maskB64,
      prompt: options?.prompt || 'Seamlessly fill the masked region',
      negative_prompt: options?.negativePrompt,
      seed: options?.seed,
    };

    // Scrub local string pointers from scope early
    imageB64 = '';
    maskB64 = '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Generic image edit API failed (${response.status}): ${Redactor.redact(errText)}`);
    }

    const data = await response.json();
    const resultB64 = data.image || data.data?.[0]?.b64_json || data.output?.[0];
    if (resultB64) {
      return this.base64ToBlob(resultB64);
    }

    const resultUrl = data.url || data.data?.[0]?.url;
    if (resultUrl) {
      const imgRes = await fetch(resultUrl);
      return await imgRes.blob();
    }

    throw new Error('Generic image edit API response did not contain image data or URL.');
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      if (typeof FileReader === 'undefined') {
        // Node / test environment fallback
        blob.arrayBuffer().then((buf) => {
          const b64 = Buffer.from(buf).toString('base64');
          resolve(b64);
        }).catch(reject);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result as string;
        const base64 = res.includes(',') ? res.split(',')[1] : res;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private base64ToBlob(base64: string): Blob {
    const cleanB64 = base64.replace(/^data:image\/\w+;base64,/, '');
    if (typeof atob === 'function') {
      const binary = atob(cleanB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: 'image/png' });
    } else {
      const buf = Buffer.from(cleanB64, 'base64');
      return new Blob([buf], { type: 'image/png' });
    }
  }
}
