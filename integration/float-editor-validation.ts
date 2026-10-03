import { invoke } from '@tauri-apps/api/core';
import { AssetManager } from '../src/assets/AssetManager';
import { DocumentManager } from '../src/document/DocumentManager';
import { createAdjustmentLayer } from '../src/document/EditDocument';
import { CommandBus } from '../src/history/CommandBus';
import { openSelectedFile } from '../src/app/documentOpening';
import { ImageExportService } from '../src/app/ImageExportService';
import { buildNativeDevelopPayload } from '../src/app/nativeDevelopPayload';
import { WebGLImageEngine } from '../src/engine/WebGLImageEngine';
import { getFloatEditSources } from '../src/engine/FloatEditSources';
import { ProjectSerializer } from '../src/project/ProjectSerializer';
import { getPlatformBridge } from '../src/platform';
import { EditNativeBridge } from '../src/platform/EditNativeBridge';
import { EditAutoColorService } from '../src/edit/EditAutoColorService';
import { DevelopAutoToneService } from '../src/develop/DevelopAutoToneService';
import { readFloatAutoToneSource } from '../src/develop/autoToneSource';
import { runNaturalAutoColor } from '../src/develop/autoToneWorkerRunner';
import { NATURAL_AUTO_COLOR_KEYS } from '../src/develop/floatAutoTone';
import { RawSmartObjectService } from '../src/smartobject/RawSmartObjectService';
import type { EditDocument, DevelopSmartObjectLayer, ImageLayer } from '../src/types/edit';
import type { DevelopDocument } from '../src/types/develop';
import type { LinearPixelBuffer } from '../src/engine/editFloat/types';

interface ProbeInputs { reportDir: string; rawPath?: string; rasterPath?: string }
interface CaseResult { name: string; passed: boolean; details?: unknown; diagnostics?: Record<string, unknown>; errorStack?: string }
const report: { complete: boolean; passed: boolean; phase: string; cases: CaseResult[]; errors: string[];
  heartbeat?: { ticks: number; maxGapMs: number } } = {
  complete: false, passed: false, phase: 'initializing', cases: [], errors: [],
};
const reportElement = document.querySelector<HTMLPreElement>('#report')!;
const display = document.querySelector<HTMLCanvasElement>('#display')!;
const assets = new AssetManager();
const documents = new DocumentManager();
const history = new CommandBus(documents);
const engine = new WebGLImageEngine(assets);
const bridge = getPlatformBridge();
const serializer = new ProjectSerializer();
const extraAssets: AssetManager[] = [];
const ownedFiles = new Set<string>();
const nativeRawIds = new Set<string>();
let inputs: ProbeInputs;
let currentCase: CaseResult | undefined;

function publish(): void { reportElement.textContent = JSON.stringify(report, null, 2); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function near(actual: number, expected: number, tolerance = 2e-6): void {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `Expected ${expected} +/- ${tolerance}; received ${actual}`);
}
async function check(name: string, work: () => Promise<unknown>): Promise<boolean> {
  const result: CaseResult = { name, passed: false };
  report.cases.push(result); currentCase = result; report.phase = name; publish();
  try { result.details = await work(); result.passed = true; publish(); return true; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errorStack = error instanceof Error ? error.stack : undefined;
    report.errors.push(`${name}: ${message}`); publish(); return false;
  } finally { currentCase = undefined; }
}
function diagnose(values: Record<string, unknown>): void {
  if (currentCase) currentCase.diagnostics = { ...currentCase.diagnostics, ...values };
  publish();
}
const decodeSrgb = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const displaySrgb = (v: number) => Math.round(255 * Math.max(0, Math.min(1,
  v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055)));
function outputPath(name: string): string {
  const path = `${inputs.reportDir.replace(/[\\/]$/, '')}/${name}`;
  ownedFiles.add(path); return path;
}
function imageLayer(doc: EditDocument): ImageLayer {
  const layer = doc.layers.find(layer => layer.type === 'image');
  assert(layer?.type === 'image', 'Imported raster image layer missing'); return layer;
}
async function blobBytes(blob: Blob | null): Promise<Uint8Array> {
  assert(blob, 'Immutable original blob missing'); return new Uint8Array(await blob.arrayBuffer());
}
function equalBytes(actual: Uint8Array, expected: Uint8Array): void {
  assert(actual.length === expected.length, 'Original byte length changed');
  assert(actual.every((value, index) => value === expected[index]), 'Original bytes changed');
}
function compareFloat(actual: LinearPixelBuffer, expected: LinearPixelBuffer, tolerance = 2e-6): number {
  assert(actual.width === expected.width && actual.height === expected.height, 'Float dimensions changed');
  let maxError = 0;
  for (let i = 0; i < actual.data.length; i++) {
    const error = Math.abs(actual.data[i] - expected.data[i]); maxError = Math.max(error, maxError);
    assert(Number.isFinite(error) && error <= tolerance, `Float sample ${i} changed: ${actual.data[i]} vs ${expected.data[i]}`);
  }
  return maxError;
}
function whole(doc: EditDocument, scale = 1): Promise<LinearPixelBuffer> {
  return engine.renderEditFloatRegion(doc, { x: 0, y: 0, width: doc.width, height: doc.height }, scale);
}
async function openRaster(name: string, bytes: Uint8Array, manager = documents, store = assets): Promise<EditDocument> {
  const doc = await openSelectedFile({ name, sizeBytes: bytes.length, blob: new Blob([bytes as BlobPart]) }, {
    documents: manager, assets: store, platform: bridge,
    decodeImage: async () => { throw new Error('Browser image decoding must not supply float source pixels'); },
  });
  assert(doc.kind === 'edit', 'Raster did not open in Edit');
  doc.backgroundColor = 'transparent'; manager.updateDocument(doc, 'Validation transparent background'); return doc;
}
async function fixture(name: string, width: number, height: number, data: Float32Array): Promise<EditDocument> {
  const path = outputPath(name), job = crypto.randomUUID();
  await EditNativeBridge.beginEditExport(job, path, { width, height, format: 'tiff-f32', quality: 1 });
  try {
    await EditNativeBridge.appendEditExportBand(job, 0, { width, height, data });
    assert(await EditNativeBridge.finishEditExport(job) === path, 'Float fixture save was not confirmed');
  } catch (error) { await EditNativeBridge.cancelEditExport(job); throw error; }
  return openRaster(name, await bridge.readBinaryFile(path));
}
function exposure(doc: EditDocument, ev: number, gamma = 1): EditDocument {
  const layer = createAdjustmentLayer({ name: `Exposure ${ev}`, adjustmentType: 'exposure',
    settings: { type: 'exposure', values: { exposure: ev, offset: 0, gamma } } });
  layer.transform.width = doc.width; layer.transform.height = doc.height;
  return { ...doc, layers: [...doc.layers, layer] };
}
const failCanvas = async (): Promise<never> => { throw new Error('Canvas export fallback invoked for v2'); };
const exports = new ImageExportService({
  exportEditFloat: (doc, options, path) => engine.exportEditFloat(doc, options, path),
  exportRaw: failCanvas, renderDevelop: failCanvas, renderEdit: failCanvas, write: failCanvas,
});

// Parse the actual container structures, independently of the native decoder's bit-depth claim.
function pngMetadata(bytes: Uint8Array): { depth: number; icc: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(0) === 0x89504e47, 'PNG signature missing');
  let depth = 0, icc = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), type = view.getUint32(offset + 4);
    assert(offset + length + 12 <= bytes.length, 'Invalid PNG chunk bounds');
    if (type === 0x49484452) { assert(length === 13, 'Invalid PNG IHDR'); depth = bytes[offset + 16]; }
    if (type === 0x69434350) icc = length > 32;
    offset += length + 12;
  }
  return { depth, icc };
}
function tiffMetadata(bytes: Uint8Array): { depth: number; icc: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint16(0) === 0x4949;
  assert(little || view.getUint16(0) === 0x4d4d, 'TIFF byte order missing');
  assert(view.getUint16(2, little) === 42, 'Unsupported TIFF header');
  const offset = view.getUint32(4, little), count = view.getUint16(offset, little);
  assert(offset + 2 + count * 12 + 4 <= bytes.length, 'Invalid TIFF directory bounds');
  let depth = 0, icc = false;
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12, tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little), size = view.getUint32(entry + 4, little);
    if (tag === 258) {
      assert(type === 3 && size > 0 && size <= 4, 'Invalid BitsPerSample tag');
      const values = size * 2 <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
      depth = view.getUint16(values, little);
      for (let c = 0; c < size; c++) assert(view.getUint16(values + c * 2, little) === depth, 'Unequal TIFF channel depths');
    }
    if (tag === 34675) {
      const profileOffset = view.getUint32(entry + 8, little);
      icc = size > 128 && profileOffset + size <= bytes.length;
    }
  }
  return { depth, icc };
}
async function exportedPixels(doc: EditDocument, format: 'png' | 'tiff', width = doc.width, height = doc.height): Promise<{
  pixels: LinearPixelBuffer; metadata: { depth: number; icc: boolean }; bytes: number;
}> {
  const path = outputPath(`float-validation-${crypto.randomUUID()}.${format}`);
  await exports.export(doc, path, { format, width, height, quality: 100, outputProfile: 'srgb' });
  const bytes = await bridge.readBinaryFile(path), metadata = format === 'png' ? pngMetadata(bytes) : tiffMetadata(bytes);
  const decoded = await EditNativeBridge.decodeEditSource(bytes);
  try {
    assert(decoded.bitDepth === 16, 'Native export returned an 8-bit source');
    assert(decoded.width === width && decoded.height === height, 'Native export dimensions changed');
    assert(metadata.depth === 16 && metadata.icc, 'Export lacks 16-bit channels or embedded ICC profile');
    return { pixels: await EditNativeBridge.readEditSourceTile(decoded.assetId, 0, 0, width, height), metadata, bytes: bytes.length };
  } finally { await EditNativeBridge.releaseEditSource(decoded.assetId); }
}
async function reopenBinary(doc: EditDocument): Promise<{ doc: EditDocument; assets: AssetManager; engine: WebGLImageEngine }> {
  const bytes = await serializer.serializeBinary(doc, assets), path = outputPath(`float-validation-${crypto.randomUUID()}.lumiseq`);
  await bridge.writeBinaryFile(path, bytes);
  const persisted = await bridge.readBinaryFile(path); equalBytes(persisted, bytes);
  assert(String.fromCharCode(...persisted.subarray(0, 4)) === 'LSQ2', 'Project did not use binary v2 storage');
  const freshAssets = new AssetManager(); extraAssets.push(freshAssets);
  const freshDocuments = new DocumentManager();
  const loaded = await openSelectedFile({ name: 'reopened.lumiseq', sizeBytes: persisted.length, blob: new Blob([persisted as BlobPart]) },
    { documents: freshDocuments, assets: freshAssets, platform: bridge });
  assert(loaded.kind === 'edit' && loaded.renderingVersion === 2 && loaded.bitDepth === 32 && loaded.workingProfile === 'linear-srgb',
    'Binary reopen lost the float working contract');
  return { doc: loaded, assets: freshAssets, engine: new WebGLImageEngine(freshAssets) };
}

async function rasterChecks(): Promise<void> {
  let raster: EditDocument | undefined, original: Uint8Array | undefined, source: LinearPixelBuffer | undefined;
  await check('native PNG16 import preserves adjacent values without browser pixel decode', async () => {
    assert(inputs.rasterPath, 'Set LUMISEQ_PROBE_RASTER to the public 8x2 PNG16 gradient fixture');
    original = new Uint8Array(await invoke<ArrayBuffer>('read_quality_input', { kind: 'raster' }));
    const metadata = pngMetadata(original); assert(metadata.depth === 16 && metadata.icc, 'Input must be tagged PNG16');
    let nativeDepth = 0;
    const delegate = bridge.decodeEditSource!.bind(bridge);
    bridge.decodeEditSource = async bytes => { const decoded = await delegate(bytes); nativeDepth = decoded.bitDepth; return decoded; };
    try { raster = await openRaster('public-gradient.png', original); }
    finally { bridge.decodeEditSource = delegate; }
    assert(nativeDepth === 16 && raster.width === 8 && raster.height === 2, 'Native PNG16 source metadata changed');
    assert(raster.renderingVersion === 2 && raster.bitDepth === 32, 'PNG16 source did not open as float Edit');
    source = await whole(raster);
    diagnose({ sourceBitDepth: nativeDepth, dimensions: [source.width, source.height],
      firstRow: Array.from(source.data.subarray(0, 32)), independentExpectedFirst: decodeSrgb(32768 / 65535) });
    for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) {
      const index = (y * 8 + x) * 4, expected = decodeSrgb((32768 + x) / 65535);
      for (let c = 0; c < 3; c++) near(source.data[index + c], expected, 3e-6);
      near(source.data[index + 3], 1);
      if (x) assert(source.data[index] > source.data[index - 4], `Adjacent 16-bit samples ${x - 1}/${x} collapsed`);
    }
    return { sourceBitDepth: nativeDepth, workingBitDepth: raster.bitDepth, first: source.data[0], next: source.data[4] };
  });
  if (raster && source && original) {
    const doc = raster, pixels = source, bytes = original;
    await check('actual Canvas display matches independent float delivery encoding', async () => {
      await engine.renderEdit(doc, display);
      const shown = display.getContext('2d')!.getImageData(0, 0, 8, 2).data;
      diagnose({ shownFirstRow: Array.from(shown.subarray(0, 32)), expectedFirst: displaySrgb(pixels.data[0]) });
      for (let i = 0; i < shown.length; i += 4) {
        for (let c = 0; c < 3; c++) near(shown[i + c], displaySrgb(pixels.data[i + c]), 1);
        assert(shown[i + 3] === 255, 'Opaque display alpha changed');
      }
      const screenshot = await new Promise<Blob>((resolve, reject) => display.toBlob(blob => blob ? resolve(blob) : reject(new Error('Display screenshot failed'))));
      await bridge.writeBinaryFile(outputPath('float-validation-display.png'), new Uint8Array(await screenshot.arrayBuffer()));
      return { firstDisplayPixel: Array.from(shown.subarray(0, 4)), screenshot: 'float-validation-display.png' };
    });
    await check('binary project reopens exact source bytes and float precision', async () => {
      const reopened = await reopenBinary(exposure(doc, .125));
      equalBytes(await blobBytes(await reopened.assets.getBlob(imageLayer(reopened.doc).sourceAssetId)), bytes);
      const native = await EditNativeBridge.decodeEditSource(await blobBytes(await reopened.assets.getBlob(imageLayer(reopened.doc).sourceAssetId)));
      try { assert(native.bitDepth === 16, 'Project original no longer decodes as PNG16'); }
      finally { await EditNativeBridge.releaseEditSource(native.assetId); }
      const region = { x: 0, y: 0, width: doc.width, height: doc.height };
      const maxError = compareFloat(await reopened.engine.renderEditFloatRegion(reopened.doc, region), await whole(exposure(doc, .125)));
      return { originalBytes: bytes.length, workingBitDepth: reopened.doc.bitDepth, maxError };
    });
    for (const format of ['png', 'tiff'] as const) await check(`${format.toUpperCase()}16 export retains gradient and ICC metadata`, async () => {
      const result = await exportedPixels(doc, format);
      diagnose({ decodedFirstRow: Array.from(result.pixels.data.subarray(0, 32)), sourceFirstRow: Array.from(pixels.data.subarray(0, 32)), metadata: result.metadata });
      const maxError = compareFloat(result.pixels, pixels, 3e-6);
      for (let x = 1; x < 8; x++) assert(result.pixels.data[x * 4] > result.pixels.data[(x - 1) * 4], 'Export collapsed adjacent 16-bit values');
      return { ...result.metadata, bytes: result.bytes, maxError };
    });
  }
  await check('signed HDR survives +1/-1 exposure and independent alpha', async () => {
    const original = new Float32Array([.8, -.2, 1.5, .5, 0, 1, 2, 1]);
    const doc = await fixture('float-validation-hdr.tiff', 2, 1, original);
    const initial = await whole(doc); diagnose({ stage: 'float fixture decode', expected: Array.from(original), initial: Array.from(initial.data) });
    compareFloat(initial, { width: 2, height: 1, data: original });
    const raised = await whole(exposure(doc, 1));
    diagnose({ stage: 'raised float', raised: Array.from(raised.data) });
    near(raised.data[0], 1.6); near(raised.data[1], -.4); near(raised.data[2], 3); near(raised.data[3], .5);
    const restored = await whole(exposure(exposure(doc, 1), -1)); compareFloat(restored, initial);
    display.width = 2; display.height = 1;
    await engine.renderEdit(doc, display, undefined, ctx => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 2, 1); });
    const shown = display.getContext('2d')!.getImageData(0, 0, 2, 1).data;
    diagnose({ stage: 'Canvas backdrop', shown: Array.from(shown) });
    for (let c = 0; c < 3; c++) near(shown[c], displaySrgb(original[c]) * .5 + 255 * .5, 2);
    assert(shown[3] === 255, 'Workspace backdrop was erased by transparent delivery');
    near((await whole(doc)).data[3], .5);
    return { raisedPixel: Array.from(raised.data.subarray(0, 4)), restoredPixel: Array.from(restored.data.subarray(0, 4)), backdropPixel: Array.from(shown.subarray(0, 4)) };
  });
  let gammaDoc: EditDocument | undefined;
  await check('native gamma resize fixture imports black/white endpoints', async () => {
    const fixtureDoc = await fixture('float-validation-gamma.tiff', 2, 1, new Float32Array([0, 0, 0, 1, 1, 1, 1, 1]));
    const endpoints = await whole(fixtureDoc); diagnose({ endpoints: Array.from(endpoints.data) });
    near(endpoints.data[0], 0); near(endpoints.data[4], 1);
    gammaDoc = exposure(fixtureDoc, 0, 2); return { endpoints: Array.from(endpoints.data) };
  });
  if (gammaDoc) {
    const doc = gammaDoc;
    await check('native-grid gamma precedes final float-region resize', async () => {
      const scaled = await whole(doc, .5);
      diagnose({ operation: 'renderEditFloatRegion({x:0,y:0,width:2,height:1}, .5)', dimensions: [scaled.width, scaled.height], pixels: Array.from(scaled.data), expectedLinear: .5 });
      assert(scaled.width === 1 && scaled.height === 1, 'Resize dimensions incorrect');
      for (let c = 0; c < 3; c++) near(scaled.data[c], .5);
      return { previewLinear: scaled.data[0], expected: .5 };
    });
    await check('native-grid gamma precedes actual Canvas preview resize', async () => {
      display.width = display.height = 1;
      await engine.renderEdit(doc, display, undefined, undefined, undefined,
        { sourceRegion: { x: 0, y: 0, width: doc.width, height: doc.height } });
      const shown = display.getContext('2d')!.getImageData(0, 0, 1, 1).data;
      diagnose({ operation: 'renderEdit whole 2x1 sourceRegion into 1x1 Canvas', shown: Array.from(shown), expectedDisplay: displaySrgb(.5) });
      near(shown[0], displaySrgb(.5), 1);
      assert(shown[3] === 255, 'Gamma preview lost opaque source alpha');
      return { actualDisplay: shown[0], expected: displaySrgb(.5) };
    });
    await check('aspect-fit preview preserves gamma color and fractional coverage', async () => {
      display.width = display.height = 1; await engine.renderEdit(doc, display);
      const shown = display.getContext('2d')!.getImageData(0, 0, 1, 1).data;
      diagnose({ operation: 'renderEdit aspect-fit 2x1 document into 1x1 Canvas', shown: Array.from(shown), expectedDisplay: displaySrgb(.5) });
      for (let c = 0; c < 3; c++) near(shown[c], displaySrgb(.5), 2);
      assert(shown[3] > 0 && shown[3] < 255, 'Aspect-fit lost fractional document coverage');
      return { displayPixel: Array.from(shown), physicalDocumentHeight: .5 };
    });
    await check('native-grid gamma precedes PNG16 export resize', async () => {
      const exported = await exportedPixels(doc, 'png', 1, 1);
      diagnose({ operation: 'PNG16 export 2x1 document as 1x1', pixels: Array.from(exported.pixels.data), expectedLinear: .5 });
      for (let c = 0; c < 3; c++) near(exported.pixels.data[c], .5, 2e-5);
      return { exportLinear: exported.pixels.data[0], expected: .5 };
    });
  }
  await check('Edit automatic color commits all generated adjustments in one undo', async () => {
    const data = new Float32Array(256 * 4);
    for (let x = 0; x < 256; x++) data.set([.08 + x / 255 * .4, .1 + x / 255 * .4, .12 + x / 255 * .4, 1], x * 4);
    const doc = await fixture('float-validation-auto.tiff', 256, 1, data), before = await whole(doc), count = history.getHistory().length;
    const auto = new EditAutoColorService(documents, history, (doc, region, scale, signal) => engine.renderEditFloatRegion(doc, region, scale, signal));
    const result = await auto.applyWithResult(doc.id, 'autoTone');
    assert(result?.commandId && result.adjustments.length, 'Automatic color fixture did not produce an undoable change');
    assert(history.getHistory().length === count + 1, 'Automatic color produced multiple undo entries');
    assert(history.undo(), 'Automatic color undo failed');
    const restored = documents.getEditDocument(doc.id)!;
    assert(restored.layers.length === doc.layers.length, 'Undo left generated adjustments'); compareFloat(await whole(restored), before);
    return { adjustments: result.adjustments.length, undoEntries: 1, evidence: result.evidence };
  });
}

async function rawChecks(): Promise<void> {
  if (!inputs.rawPath) { report.cases.push({ name: 'optional camera RAW checks', passed: true, details: { skipped: true, reason: 'No LUMISEQ_PROBE_RAW supplied' } }); publish(); return; }
  let raw: DevelopDocument | undefined, rawBytes: Uint8Array | undefined;
  await check('camera RAW decodes High v2 and supplies a bounded linear overview', async () => {
    rawBytes = new Uint8Array(await invoke<ArrayBuffer>('read_quality_input', { kind: 'raw' }));
    const extension = inputs.rawPath!.split('.').at(-1) ?? 'raw';
    const opened = await openSelectedFile({ name: `camera-input.${extension}`, path: inputs.rawPath, sizeBytes: rawBytes.length,
      blob: new Blob([rawBytes as BlobPart]) }, { documents, assets, platform: bridge });
    assert(opened.kind === 'develop' && opened.isRaw, 'Camera RAW did not open in Develop');
    const decoded = await bridge.decodeRawImage(crypto.randomUUID(), inputs.rawPath!, 'High', 2, 'camera');
    assert(decoded, 'High camera RAW decode failed'); nativeRawIds.add(decoded.asset_id);
    assert(decoded.pixel_format === 'RGBA32F' && decoded.metadata.processing_version === 2 &&
      decoded.metadata.optical_correction?.mode === 'camera', 'Native decode did not honor the v2 camera float contract');
    raw = { ...opened, nativeAssetId: decoded.asset_id, width: decoded.width, height: decoded.height,
      rawState: 'ready', rawEngineAttached: true, rawProgress: 100, rawProcessingVersion: 2, rawCorrectionMode: 'camera' };
    documents.updateDocument(raw, 'Native RAW ready');
    const overview = await bridge.getRawLinearPreview!(decoded.asset_id);
    diagnose({ pixelFormat: decoded.pixel_format, processingVersion: decoded.metadata.processing_version,
      correctionMode: decoded.metadata.optical_correction?.mode, overview: [overview.width, overview.height], overviewLimit: 2048 });
    assert(overview.data instanceof Float32Array && Math.max(overview.width, overview.height) <= 2048, 'RAW overview exceeded existing 2048 float/size contract');
    assert(overview.data.length === overview.width * overview.height * 4, 'RAW overview shape invalid');
    return { width: decoded.width, height: decoded.height, overview: [overview.width, overview.height], processingVersion: raw.rawProcessingVersion };
  });
  if (!raw || !rawBytes) return;
  const original = raw, bytes = rawBytes;
  await check('natural eight-control automatic uses real Worker while UI heartbeat advances', async () => {
    documents.setActiveDocument(original.id);
    const before = structuredClone(documents.getDevelopDocument(original.id)!.settings), count = history.getHistory().length;
    let workerCount = 0, ticks = 0, maxGapMs = 0, last = performance.now();
    const heartbeat = setInterval(() => {
      const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - last); last = now; ticks++;
      report.heartbeat = { ticks, maxGapMs }; publish();
    }, 10);
    const auto = new DevelopAutoToneService(documents, history, undefined,
      doc => readFloatAutoToneSource(doc, assets, bridge), assets,
      (snapshot, options) => runNaturalAutoColor(snapshot, { ...options, workerFactory: () => {
        workerCount++;
        const worker = new Worker(new URL('../src/develop/autoToneWorker.ts', import.meta.url), { type: 'module' });
        worker.addEventListener('error', event => diagnose({ workerRuntimeError: {
          message: event.message, filename: event.filename, line: event.lineno, column: event.colno,
          stack: event.error instanceof Error ? event.error.stack : undefined,
        } }));
        worker.addEventListener('message', event => { if (event.data?.error) diagnose({ workerErrorPayload: event.data }); });
        return worker;
      } }));
    const started = performance.now();
    try {
      const result = await auto.applyWithResult(original.id);
      assert(result && NATURAL_AUTO_COLOR_KEYS.every(key => Number.isFinite(result.patch[key])), 'Natural automatic omitted one of eight controls');
      assert(result.evidence?.precision === 'float32' && result.evidence.algorithm === 'natural-linear-v2', 'Automatic source/math was not float v2');
      assert(workerCount === 1 && ticks >= 2 && maxGapMs < 500, 'Automatic Worker blocked the UI heartbeat');
      if (result.commandId) {
        assert(history.getHistory().length === count + 1, 'Natural automatic produced multiple undo entries');
        assert(history.undo(), 'Natural automatic undo failed');
        assert(JSON.stringify(documents.getDevelopDocument(original.id)!.settings) === JSON.stringify(before), 'Natural automatic undo changed the recipe');
      } else assert(history.getHistory().length === count, 'Identity automatic created unexpected history');
      return { workerCount, heartbeatTicks: ticks, maxHeartbeatGapMs: maxGapMs, elapsedMs: performance.now() - started, patch: result.patch, evidence: result.evidence };
    } finally { clearInterval(heartbeat); }
  });
  await check('RAW smart object binary reopen preserves original and native corner recipe apply/undo', async () => {
    const smart = new RawSmartObjectService(documents, history, assets, {
      read: async () => { throw new Error('RAW transfer reread mutable source path'); },
      stage: (name, blob) => bridge.stageRawSource!(name, blob),
    });
    const edit = await smart.transfer(original.id), layer = edit.layers[0] as DevelopSmartObjectLayer;
    equalBytes(await blobBytes(await assets.getBlob(layer.sourceAssetId!)), bytes);
    assert(layer.rawProcessingVersion === 2 && layer.rawCorrectionMode === 'camera', 'RAW transfer lost processing contract');
    const region = { x: 0, y: 0, width: Math.min(128, edit.width), height: Math.min(128, edit.height) };
    const nativeBefore = await bridge.renderRawDevelopTile!(original.nativeAssetId!, await buildNativeDevelopPayload(layer.developSettings, assets),
      region.x, region.y, region.width, region.height);
    compareFloat(await engine.renderEditFloatRegion(edit, region), nativeBefore);
    const count = history.getHistory().length, variant = await smart.openRecipe(edit.id, layer.id);
    const staged = variant.sourceUri; ownedFiles.add(staged);
    const settings = { ...variant.settings, exposure: variant.settings.exposure + .25 };
    documents.updateDocument({ ...variant, settings }, 'Validation recipe exposure');
    await smart.applyRecipe(variant.id);
    assert(history.getHistory().length === count + 1, 'RAW recipe apply produced multiple commands');
    const applied = documents.getEditDocument(edit.id)!;
    const nativeApplied = await bridge.renderRawDevelopTile!(original.nativeAssetId!, await buildNativeDevelopPayload(settings, assets),
      region.x, region.y, region.width, region.height);
    const maxApplyError = compareFloat(await engine.renderEditFloatRegion(applied, region), nativeApplied);
    assert(history.undo(), 'RAW recipe undo failed');
    const undone = documents.getEditDocument(edit.id)!;
    compareFloat(await engine.renderEditFloatRegion(undone, region), nativeBefore);
    const reopened = await reopenBinary(undone), reopenedLayer = reopened.doc.layers[0] as DevelopSmartObjectLayer;
    equalBytes(await blobBytes(await reopened.assets.getBlob(reopenedLayer.sourceAssetId!)), bytes);
    assert(JSON.stringify(reopenedLayer.developSettings) === JSON.stringify(layer.developSettings), 'Binary RAW reopen changed recipe');
    getFloatEditSources(assets).release(layer.sourceAssetId!);
    const maxReopenError = compareFloat(await reopened.engine.renderEditFloatRegion(reopened.doc, region), nativeBefore);
    return { originalBytes: bytes.length, crop: [region.width, region.height], maxApplyError, maxReopenError, undoEntries: 1 };
  });
}

async function main(): Promise<void> {
  try {
    inputs = await invoke<ProbeInputs>('quality_probe_inputs');
    assert(inputs.reportDir, 'External report directory missing');
    await rasterChecks(); await rawChecks();
  } catch (error) { report.errors.push(error instanceof Error ? error.message : String(error)); }
  finally {
    getFloatEditSources(assets).dispose();
    for (const store of extraAssets) { getFloatEditSources(store).dispose(); store.dispose(); }
    assets.dispose();
    for (const id of nativeRawIds) await bridge.releaseRawAsset(id).catch(error => report.errors.push(`RAW release: ${String(error)}`));
    // Keep the display capture externally; discard only probe-generated temporary source/project/export files.
    for (const path of ownedFiles) if (!path.endsWith('/float-validation-display.png')) await bridge.deleteFile(path).catch(error => report.errors.push(`Temporary cleanup: ${String(error)}`));
    report.phase = 'finished'; report.complete = true;
    report.passed = report.errors.length === 0 && report.cases.length > 0 && report.cases.every(result => result.passed); publish();
  }
}
void main();
