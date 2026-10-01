import type { EditDocument } from '../types/edit';
import { defaultImageEngine } from '../engine/WebGLImageEngine';
import { colorSampleBounds, defaultEyedropper, type EyedropperSampleSize, type SampledColorResult } from './eyedropper';

/** Composite document pixels at 1:1, without preview resampling, checkerboards or tool overlays. */
export async function sampleDocumentColor(doc: EditDocument, x: number, y: number, size: EyedropperSampleSize = 1): Promise<SampledColorResult> {
  const area = colorSampleBounds(doc.width, doc.height, x, y, size);
  const canvas = document.createElement('canvas');
  canvas.width = area.width;
  canvas.height = area.height;
  try {
    const baseScale = Math.min(area.width / doc.width, area.height / doc.height);
    await defaultImageEngine.renderEdit(doc, canvas, {
      canvasWidth: area.width, canvasHeight: area.height,
      zoom: 1 / baseScale,
      panX: (doc.width - area.width) / 2 - area.left,
      panY: (doc.height - area.height) / 2 - area.top,
    });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法读取图像颜色。');
    const sample = defaultEyedropper.sampleColor({ source: ctx, x: area.x - area.left, y: area.y - area.top, sampleSize: size });
    return { ...sample, x: area.x, y: area.y };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
