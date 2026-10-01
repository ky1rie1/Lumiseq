// Test-only browser adapters around Skia's real Canvas implementation.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { vi } from 'vitest';

export function installPixelCanvas() {
  const create = (width = 1, height = 1): HTMLCanvasElement => {
    const canvas = createCanvas(width, height);
    Object.assign(canvas, { toBlob: (done: (blob: Blob) => void) => {
      done(new Blob([new Uint8Array(canvas.toBuffer('image/png'))], { type: 'image/png' }));
    } });
    return canvas as unknown as HTMLCanvasElement;
  };
  const document = { createElement: () => create() };
  vi.stubGlobal('window', { document });
  vi.stubGlobal('document', document);
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => loadImage(Buffer.from(await blob.arrayBuffer())));
  return create;
}

export function pixelBytes(canvas: HTMLCanvasElement) {
  return [...canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data];
}
