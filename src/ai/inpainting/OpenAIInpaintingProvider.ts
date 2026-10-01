// src/ai/inpainting/OpenAIInpaintingProvider.ts
//! OpenAI / DALL-E 2 / 3 Image Edits Inpainting Provider

import { IImageGenerationProvider, ImageProviderCapabilities, InpaintingOptions } from './types';
import { Redactor } from '../security/Redactor';

export class OpenAIInpaintingProvider implements IImageGenerationProvider {
  readonly id = 'openai-images';
  readonly name = 'OpenAI Image Edits (DALL-E Inpainting)';
  readonly isLocal = false;

  readonly capabilities: ImageProviderCapabilities = {
    textToImage: true,
    imageToImage: true,
    inpainting: true,
    outpainting: true,
    maskInput: true,
    seed: false,
    maxPixels: 1024 * 1024,
  };

  constructor(
    private apiKeyProvider: () => Promise<string>,
    private baseUrl: string = 'https://api.openai.com/v1',
    private model: string = 'dall-e-2'
  ) {}

  async inpaint(
    contextImageBlob: Blob,
    maskBlob: Blob,
    options?: InpaintingOptions
  ): Promise<Blob> {
    const apiKey = await this.apiKeyProvider();
    if (!apiKey) {
      throw new Error('OpenAIInpaintingProvider: Missing API Key.');
    }

    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/images/edits`;
    const formData = new FormData();
    formData.append('image', contextImageBlob, 'image.png');
    formData.append('mask', maskBlob, 'mask.png');
    formData.append('prompt', options?.prompt || 'Seamlessly blend and fill the masked region with surrounding background texture.');
    formData.append('model', this.model);
    formData.append('n', '1');
    formData.append('size', '1024x1024');
    formData.append('response_format', 'b64_json');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: options?.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      const sanitized = Redactor.redact(errText);
      throw new Error(`OpenAI Image Inpaint error (${response.status}): ${sanitized}`);
    }

    const data = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error('OpenAI Image Inpaint: Response did not contain b64_json image data.');
    }

    // Convert base64 to binary Blob
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: 'image/png' });
  }
}
