/** Browser integration: production editor renderer, original 24 MP source, exact pixel oracle. */
import { createAiHarnessPattern, AI_HARNESS_PATTERN as pattern } from './aiHarnessPattern';
import { AssetManager } from '../src/assets/AssetManager';
import { DocumentManager } from '../src/document/DocumentManager';
import { createEditDocument, createImageLayer } from '../src/document/EditDocument';
import { DocumentObservationService } from '../src/ai/vision/DocumentObservationService';
import type { DocumentObservation } from '../src/ai/vision/observationTypes';
import { validateCameraObservation } from './aiHarnessRawValidation';

const report = { complete: false, passed: false, cases: [] as Array<{ name: string; passed: boolean; detail?: unknown }>, errors: [] as string[] };
const check = (name: string, passed: boolean, detail?: unknown) => {
  report.cases.push({ name, passed, detail });
  if (!passed) throw new Error(name);
};
const assets = new AssetManager();
const documents = new DocumentManager();
const observer = new DocumentObservationService({ documents, assets });
async function pixels(observation: DocumentObservation): Promise<CanvasRenderingContext2D> {
  const image = new Image();
  image.src = `data:${observation.image.mimeType};base64,${observation.image.data}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  return context;
}
function display(id: string, label: string, observation: DocumentObservation) {
  const heading = document.createElement('h2'); heading.textContent = label;
  const image = new Image(); image.alt = label;
  image.src = `data:${observation.image.mimeType};base64,${observation.image.data}`;
  document.getElementById(id)!.append(heading, image);
}
let sourceId: string | undefined;
try {
  const canvas = createAiHarnessPattern();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Fixture encoding failed')), 'image/png'));
  const asset = await assets.registerBlob(blob, 'image', 'Original 24 MP harness pattern'); sourceId = asset.id;
  const layer = createImageLayer({ id: 'harness-pattern', name: '原创测试图', sourceAssetId: asset.id, naturalWidth: pattern.width, naturalHeight: pattern.height });
  const source = createEditDocument({ id: 'harness-observation', name: 'AI 观察验收', width: pattern.width, height: pattern.height, layers: [layer] });
  documents.openDocument(source);
  const overview = await observer.observe({ documentId: source.id, mode: 'overview' });
  check('Whole document overview dimensions', overview.evidence.width === 1024 && overview.evidence.height === 683, overview.evidence);
  check('Independent rounded coordinate scales', overview.evidence.pixelToDocument[0] === pattern.width / 1024 && overview.evidence.pixelToDocument[3] === pattern.height / 683);
  const overviewContext = await pixels(overview);
  const overviewSamples = [[50, 80, [200, 60, 70]], [950, 80, [224, 216, 200]], [50, 620, [56, 108, 200]], [950, 620, [224, 216, 200]]] as const;
  check('Overview includes all four source quadrants', overviewSamples.every(([x, y, expected]) => {
    const actual = overviewContext.getImageData(x, y, 1, 1).data;
    return expected.every((value, channel) => Math.abs(actual[channel] - value) <= 6);
  }));
  display('overview', '整图 · 1024 × 683', overview);
  const detail = await observer.observe({ documentId: source.id, mode: 'detail', region: pattern.detail, expectedRevision: overview.evidence.revision });
  check('Native detail dimensions and transform', detail.evidence.width === 1200 && detail.evidence.height === 800 && JSON.stringify(detail.evidence.pixelToDocument) === JSON.stringify([1, 0, 0, 1, 1500, 1000]), detail.evidence);
  const context = await pixels(detail);
  const sampled = [...context.getImageData(pattern.sample.x - pattern.detail.x, pattern.sample.y - pattern.detail.y, 1, 1).data];
  check('Exact original-resolution source RGB', sampled.every((value, index) => Math.abs(value - [...pattern.sample.rgb, 255][index]) <= 1), sampled);
  const edgeX = pattern.edge.x - pattern.detail.x, edgeY = pattern.edge.y - pattern.detail.y;
  const edge = [...context.getImageData(edgeX, edgeY, 2, 1).data];
  const adjacent = [...context.getImageData(edgeX - 1, edgeY, 1, 1).data];
  check('Two-pixel detail remains contiguous and sharp', edge[0] <= 17 && edge[4] <= 17 && adjacent[1] >= 159, { edge, adjacent });
  display('detail', '细看 · 原尺寸 1200 × 800（12 px 字样与 2 px 线条）', detail);
  check('Observation preserves source document and source asset', documents.getDocument(source.id) === source && !!assets.getHandle(asset.id));
  if (new URLSearchParams(location.search).has('runtime')) {
    const { validateHarnessRuntime } = await import('./aiHarnessRuntimeValidation');
    await validateHarnessRuntime(check, documents, observer, source.id, layer.id);
  }
  if (new URLSearchParams(location.search).has('creative')) {
    const { validateHarnessCreative } = await import('./aiHarnessCreativeValidation');
    await validateHarnessCreative(check, documents, observer, assets, source.id, layer.id);
  }
  if (new URLSearchParams(location.search).has('raw')) await validateCameraObservation(check);
  report.passed = true;
} catch (error) {
  report.errors.push(String(error));
} finally {
  observer.dispose();
  if (sourceId) assets.releaseAsset(sourceId);
  report.complete = true;
  document.getElementById('report')!.textContent = JSON.stringify(report, null, 2);
}
