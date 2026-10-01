import { CUTOUT_MODEL } from './CutoutModelManifest';
import { refineAlpha, paintAlpha, resizeSoftAlpha } from './cutoutMath';
import { validateCutoutSize } from './guidedAlpha';
const worker = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
worker.onmessage = (event: MessageEvent) => {
  try {
    const { base, width, height, outputWidth, outputHeight, options, strokes } = event.data;
    validateCutoutSize(width, height); validateCutoutSize(outputWidth, outputHeight);
    const source = base ? new Uint8ClampedArray(base) : undefined;
    const alpha = source ? source.length === width * height ? source : resizeSoftAlpha(source, CUTOUT_MODEL.inputSize, CUTOUT_MODEL.inputSize, width, height) : new Uint8ClampedArray(width * height).fill(255);
    const refined = refineAlpha(alpha, width, height, options);
    for (const stroke of strokes) paintAlpha(refined, width, height, stroke.point, stroke.radius, stroke.mode);
    const output = width === outputWidth && height === outputHeight ? refined : resizeSoftAlpha(refined, width, height, outputWidth, outputHeight);
    worker.postMessage({ alpha: output.buffer }, [output.buffer]);
  } catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
