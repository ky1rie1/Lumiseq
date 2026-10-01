/** Optional private camera check. Reads ignored local native reports, never calls a provider. */
import { AssetManager } from '../src/assets/AssetManager';
import { DocumentManager } from '../src/document/DocumentManager';
import { createDefaultDevelopSettings, createDevelopDocument } from '../src/document/DevelopDocument';
import { WebGLImageEngine } from '../src/engine/WebGLImageEngine';
import { DocumentObservationService } from '../src/ai/vision/DocumentObservationService';
import { createDocumentObservationRenderer } from '../src/ai/vision/documentObservationRenderer';
import type { RawSpatialAnalysis } from '../src/app/rawSpatialAnalysis';

interface NativeReport {
  camera: string; width: number; height: number;
  crop: { x: number; y: number; width: number; height: number };
}
export async function validateCameraObservation(check: (name: string, passed: boolean, detail?: unknown) => void) {
  const directory = '/generated-test-output/ai-harness/raw-camera/';
  const loadJson = async <T,>(name: string): Promise<T> => {
    const response = await fetch(directory + name);
    if (!response.ok) throw new Error('Generate the opt-in native RAW inputs before this camera check.');
    return response.json();
  };
  const sourceReport = await loadJson<NativeReport>('report.json');
  const analysis = await loadJson<RawSpatialAnalysis>('combined-analysis.json');
  const source = new Image(); source.src = directory + 'detail-source.png'; await source.decode();
  const expected = new Image(); expected.src = directory + 'combined-detail.png'; await expected.decode();
  const assets = new AssetManager(), documents = new DocumentManager();
  const engines: WebGLImageEngine[] = [];
  const nativeReads: Array<{ x: number; y: number; width: number; height: number }> = [];
  const renderer = createDocumentObservationRenderer({ assets,
    engineFactory: () => { const engine = new WebGLImageEngine(assets, true); engines.push(engine); return engine; },
    bridge: {
      // Replay exact decoded native display pixels. This is not a live Tauri IPC assertion.
      async getRawDisplayTile(_id, x, y, width, height) {
        const crop = sourceReport.crop;
        if (x < crop.x || y < crop.y || x + width > crop.x + crop.width || y + height > crop.y + crop.height) throw new Error('Native recorded crop does not cover the requested halo.');
        nativeReads.push({ x, y, width, height });
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d')!.drawImage(source, x - crop.x, y - crop.y, width, height, 0, 0, width, height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Native tile encoding failed')), 'image/png'));
        return new Uint8Array(await blob.arrayBuffer());
      },
      async getRawSpatialAnalysis() { return analysis; },
    },
  });
  const observer = new DocumentObservationService({ documents, assets, renderer });
  try {
    const settings = createDefaultDevelopSettings(true);
    Object.assign(settings, { texture: 35, clarity: 40, dehaze: 30 });
    Object.assign(settings.detail, { sharpenAmount: 45, sharpenRadius: 1.7, sharpenThreshold: 3, lumaDenoise: 40, chromaDenoise: 45 });
    const document = createDevelopDocument({ id: 'camera-observation', sourceUri: 'memory://authorized-native-report', fileName: 'Camera observation validation', isRaw: true, rawState: 'ready', rawEngineAttached: true, width: sourceReport.width, height: sourceReport.height, settings });
    document.nativeAssetId = 'camera-native-record';
    documents.openDocument(document);
    const margin = 128;
    const region = { x: sourceReport.crop.x + margin, y: sourceReport.crop.y + margin, width: sourceReport.crop.width - 2 * margin, height: sourceReport.crop.height - 2 * margin };
    const observed = await observer.observe({ documentId: document.id, mode: 'detail', region });
    check('Camera observation uses native detail dimensions', observed.evidence.width === region.width && observed.evidence.height === region.height && observed.evidence.pixelToDocument[0] === 1 && observed.evidence.pixelToDocument[3] === 1, { camera: sourceReport.camera, sourceSize: [sourceReport.width, sourceReport.height], evidence: observed.evidence, nativeReads });
    check('Camera recipe executes in actual WebGL2', engines.length > 0 && engines.every(engine => engine.getRenderingStatus().backend === 'webgl2'));
    const rendered = new Image(); rendered.src = `data:${observed.image.mimeType};base64,${observed.image.data}`; await rendered.decode();
    const canvas = window.document.createElement('canvas'); canvas.width = region.width; canvas.height = region.height;
    const context = canvas.getContext('2d')!; context.drawImage(rendered, 0, 0);
    const actualPixels = context.getImageData(0, 0, region.width, region.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(expected, margin, margin, region.width, region.height, 0, 0, region.width, region.height);
    const expectedPixels = context.getImageData(0, 0, region.width, region.height).data;
    const histogram = new Uint32Array(256); let total = 0, channels = 0;
    for (let pixel = 0; pixel < actualPixels.length; pixel += 4) for (let channel = 0; channel < 3; channel++) {
      const difference = Math.abs(actualPixels[pixel + channel] - expectedPixels[pixel + channel]);
      histogram[difference]++; total += difference; channels++;
    }
    let cumulative = 0, p95 = 255;
    for (let value = 0; value < histogram.length; value++) { cumulative += histogram[value]; if (cumulative >= channels * .95) { p95 = value; break; } }
    check('Camera original-size observation matches full-size native recipe output', total / channels < 2 && p95 <= 5, { meanError8bit: total / channels, p95Error8bit: p95, channels, comparison: 'decoded native RW2 display tile → production observer versus full-size 16-bit native PNG crop converted to RGB8; no chart calibration' });
  } finally { observer.dispose(); }
}
