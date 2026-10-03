import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDevelopDocument } from '../document/DevelopDocument';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultAssetManager } from '../assets/AssetManager';
import { defaultImageEngine } from '../engine/WebGLImageEngine';
import { defaultCommandBus } from '../history/CommandBus';
import { DevelopLookService } from '../develop/DevelopLookService';
import { useDevelopStore } from './useDevelopStore';
import { UpdateDevelopSettingsCommand } from '../commands/develop/UpdateDevelopSettingsCommand';

const native = vi.hoisted(() => ({
  getRawMetadata: vi.fn(), extractRawThumbnail: vi.fn(), decodeRawImage: vi.fn(), cancelRawDecode: vi.fn(), releaseRawAsset: vi.fn(),
  getRawLinearPreview: undefined as undefined | ReturnType<typeof vi.fn>,
  stageRawSource: undefined as undefined | ReturnType<typeof vi.fn>, deleteFile: vi.fn(),
}));
vi.mock('../platform', () => ({ isTauriEnvironment: () => false, getPlatformBridge: () => native }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const result = (assetId: string, preview = false) => ({ asset_id: assetId, width: 20, height: 10, preview_png_bytes: preview ? [137, 80, 78, 71] : [] });
function openRaw() {
  const doc = createDevelopDocument({ sourceUri: 'C:\\photo.cr3', fileName: 'photo.cr3', isRaw: true });
  defaultDocumentManager.openDocument(doc);
  return doc;
}
beforeEach(() => {
  native.getRawLinearPreview=undefined;
  native.stageRawSource=vi.fn().mockResolvedValue('C:\\cache\\immutable.cr3');
  native.deleteFile.mockResolvedValue(true);
  native.getRawMetadata.mockResolvedValue(null);
  native.decodeRawImage.mockReset().mockResolvedValue(result('default-native'));
  native.extractRawThumbnail.mockResolvedValue(null);
  native.cancelRawDecode.mockResolvedValue(undefined);
  native.releaseRawAsset.mockResolvedValue(undefined);
});
afterEach(() => {
  native.getRawLinearPreview=undefined;
  native.stageRawSource=undefined;
  defaultDocumentManager.closeAll();
  defaultCommandBus.clearHistory();
  for (const asset of defaultAssetManager.listAssets()) {
    defaultImageEngine.releaseAsset(asset.id);
    defaultAssetManager.releaseAsset(asset.id);
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('decodes a valid RAW even when no embedded JPEG is available',async()=>{
  const doc=openRaw();native.extractRawThumbnail.mockRejectedValue(new Error('No JPEG thumbnail'));
  native.decodeRawImage.mockResolvedValue(result('no-thumbnail-native'));
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  expect(native.decodeRawImage).toHaveBeenCalledOnce();
  expect(native.decodeRawImage.mock.calls[0].slice(2)).toEqual(['High',2,'camera']);
  expect(defaultDocumentManager.getDevelopDocument(doc.id)?.rawState).toBe('ready');
});

it('waits for working RAW pixels instead of publishing a camera JPEG that changes brightness after decode',async()=>{
  const doc=openRaw();
  native.extractRawThumbnail.mockResolvedValue(new Uint8Array([255,216]));
  const decode=deferred<ReturnType<typeof result>>();native.decodeRawImage.mockReturnValue(decode.promise);
  vi.spyOn(defaultImageEngine,'loadAsset').mockResolvedValue({width:20,height:10});
  const loading=useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await vi.waitFor(()=>expect(native.decodeRawImage).toHaveBeenCalledOnce());
  const pending=defaultDocumentManager.getDevelopDocument(doc.id)!;
  const interimSource=pending.sourceAssetId||pending.previewAssetId;
  decode.resolve(result('stable-raw-source',true));await loading;
  expect(interimSource).toBeUndefined();
  expect(native.extractRawThumbnail).not.toHaveBeenCalled();
  const ready=defaultDocumentManager.getDevelopDocument(doc.id)!;
  expect(ready.rawState).toBe('ready');expect(ready.sourceAssetId).toBeTruthy();
  expect(ready.sourceAssetId).toBe(ready.previewAssetId);
});

it('releases both native and browser sources if the document closes during linear-preview IPC',async()=>{
  const doc=openRaw(),linear=deferred<{width:number;height:number;data:Uint16Array}>();
  native.decodeRawImage.mockResolvedValue(result('linear-native',true));
  native.getRawLinearPreview=vi.fn(()=>linear.promise);
  let assetId='';vi.spyOn(defaultImageEngine,'loadAsset').mockImplementation(async id=>{
    assetId=id;defaultImageEngine.setLoadedSource(id,{} as HTMLCanvasElement,20,10);return {width:20,height:10};
  });
  const loading=useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await vi.waitFor(()=>expect(native.getRawLinearPreview).toHaveBeenCalledWith('linear-native'));
  defaultDocumentManager.closeDocument(doc.id);linear.resolve({width:20,height:10,data:new Uint16Array(800)});
  await loading;expect(defaultAssetManager.hasAsset(assetId)).toBe(false);
  expect(defaultImageEngine.getLoadedSourceElement(assetId)).toBeNull();
  expect(native.releaseRawAsset).toHaveBeenCalledWith('linear-native');
});

it.each(['add', 'delete'] as const)('preserves snapshot %s during asynchronous RAW decoding', async action => {
  const doc = openRaw();
  const looks = new DevelopLookService(defaultDocumentManager, defaultCommandBus);
  const old = looks.saveSnapshot(doc.id, 'Old look');
  const decode = deferred<ReturnType<typeof result>>();
  native.decodeRawImage.mockReturnValue(decode.promise);
  const loading = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await vi.waitFor(() => expect(native.decodeRawImage).toHaveBeenCalledOnce());
  if (action === 'add') looks.saveSnapshot(doc.id, 'New look');
  else looks.deleteSnapshot(doc.id, old.id);
  const expectedNames = action === 'add' ? ['Old look', 'New look'] : [];
  const updatedAt = defaultDocumentManager.getDevelopDocument(doc.id)!.updatedAt;
  const other = openRaw();
  decode.resolve(result('completed-native'));
  await loading;
  const current = defaultDocumentManager.getDevelopDocument(doc.id)!;
  expect(current.settingsSnapshots!.map(snapshot => snapshot.name)).toEqual(expectedNames);
  expect(current.rawState).toBe('ready');
  expect(current.isDirty).toBe(true);
  expect(current.updatedAt).toBe(updatedAt);
  expect(defaultDocumentManager.getActiveDocument()?.id).toBe(other.id);
  expect(useDevelopStore.getState().currentDoc?.id).toBe(other.id);
});

it('ignores metadata completion after the RAW document closes', async () => {
  const doc = openRaw();
  const metadata = deferred<null>();
  native.getRawMetadata.mockReturnValue(metadata.promise);
  const loading = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  defaultDocumentManager.closeDocument(doc.id);
  metadata.resolve(null);
  await expect(loading).resolves.toBeUndefined();
  expect(defaultDocumentManager.getDocument(doc.id)).toBeNull();
  expect(native.extractRawThumbnail).not.toHaveBeenCalled();
});

it('ignores metadata rejection after the RAW document closes', async () => {
  const doc = openRaw();
  const metadata = deferred<null>();
  native.getRawMetadata.mockReturnValue(metadata.promise);
  const loading = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  defaultDocumentManager.closeDocument(doc.id);
  metadata.reject(new Error('Decoder failed after close'));
  await expect(loading).resolves.toBeUndefined();
  expect(defaultDocumentManager.getDocument(doc.id)).toBeNull();
});

it('keeps the newer RAW job when an older metadata request finishes', async () => {
  const doc = openRaw();
  const olderMetadata = deferred<null>();
  native.getRawMetadata.mockReturnValueOnce(olderMetadata.promise).mockResolvedValueOnce(null);
  native.decodeRawImage.mockResolvedValue(result('newer-native'));
  const older = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  olderMetadata.resolve(null);
  await older;
  expect(defaultDocumentManager.getDevelopDocument(doc.id)?.nativeAssetId).toBe('newer-native');
  expect(native.decodeRawImage).toHaveBeenCalledOnce();
});

it('releases browser pixels registered while the RAW document closes', async () => {
  const doc = openRaw();
  native.decodeRawImage.mockResolvedValue(result('native-pixels', true));
  const decodedImage = deferred<void>();
  let assetId = '';
  vi.spyOn(defaultImageEngine, 'loadAsset').mockImplementation(async id => {
    assetId = id;
    await decodedImage.promise;
    defaultImageEngine.setLoadedSource(id, {} as HTMLCanvasElement, 20, 10);
    return { width: 20, height: 10 };
  });
  const loading = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await vi.waitFor(() => expect(assetId).not.toBe(''));
  expect(defaultAssetManager.hasAsset(assetId)).toBe(true);
  defaultDocumentManager.closeDocument(doc.id);
  decodedImage.resolve();
  await expect(loading).resolves.toBeUndefined();
  expect(defaultAssetManager.hasAsset(assetId)).toBe(false);
  expect(defaultImageEngine.getLoadedSourceElement(assetId)).toBeNull();
  expect(native.releaseRawAsset).toHaveBeenCalledWith('native-pixels');
});

it('releases only the stale native result when another RAW job takes ownership', async () => {
  const doc = openRaw();
  const olderDecode = deferred<ReturnType<typeof result>>();
  native.decodeRawImage.mockReturnValueOnce(olderDecode.promise).mockResolvedValueOnce(result('current-native'));
  const older = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await vi.waitFor(() => expect(native.decodeRawImage).toHaveBeenCalledOnce());
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  olderDecode.resolve(result('stale-native'));
  await older;
  expect(defaultDocumentManager.getDevelopDocument(doc.id)?.nativeAssetId).toBe('current-native');
  expect(native.releaseRawAsset).toHaveBeenCalledExactlyOnceWith('stale-native');
});

it('keeps the decoded RAW and overview available through slider undo and redo', async () => {
  const doc = openRaw();
  native.extractRawThumbnail.mockResolvedValue(new Uint8Array([255, 216]));
  const decode = deferred<ReturnType<typeof result>>();
  native.decodeRawImage.mockReturnValue(decode.promise);
  vi.spyOn(defaultImageEngine, 'loadAsset').mockResolvedValue({ width: 20, height: 10 });
  const loading = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await vi.waitFor(() => expect(native.decodeRawImage).toHaveBeenCalledOnce());
  defaultCommandBus.beginTransaction('Exposure drag', doc.id);
  defaultCommandBus.preview(new UpdateDevelopSettingsCommand(doc.id, { exposure: 1 }, 'Exposure', defaultDocumentManager));
  decode.resolve(result('native-with-overview', true));
  await loading;
  const decodedPreviewId = defaultDocumentManager.getDevelopDocument(doc.id)!.previewAssetId!;
  defaultCommandBus.commitTransaction();
  for (const action of [() => defaultCommandBus.undo(), () => defaultCommandBus.redo()]) {
    expect(action()).toBe(true);
    const current = defaultDocumentManager.getDevelopDocument(doc.id)!;
    expect(current.rawState).toBe('ready');
    expect(current.nativeAssetId).toBe('native-with-overview');
    expect(current.previewAssetId).toBe(decodedPreviewId);
    expect(defaultAssetManager.hasAsset(decodedPreviewId)).toBe(true);
  }
});

async function openCapturedRaw() {
  const doc = openRaw(), blob = new Blob(['captured camera bytes']);
  const handle = await defaultAssetManager.registerBlob(blob, 'image', doc.fileName, { width: 20, height: 10 });
  defaultDocumentManager.updateDocument({ ...doc, originalRawAssetId: handle.id });
  return { doc, handle, blob };
}

it('loads captured RAW bytes through staging even when the original disk path was replaced', async () => {
  const { doc, blob } = await openCapturedRaw();
  native.getRawMetadata.mockImplementation(async path => {
    if (path === doc.sourceUri) throw new Error('Original disk path was replaced');
    return null;
  });
  native.decodeRawImage.mockImplementation(async (_job, path) => {
    if (path === doc.sourceUri) throw new Error('Mutable disk path must not be decoded');
    return result('immutable-native');
  });
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  expect(native.stageRawSource).toHaveBeenCalledExactlyOnceWith(doc.fileName, blob);
  expect(native.getRawMetadata).toHaveBeenCalledExactlyOnceWith('C:\\cache\\immutable.cr3');
  expect(native.decodeRawImage.mock.calls[0].slice(1)).toEqual(['C:\\cache\\immutable.cr3', 'High', 2, 'camera']);
  const ready = defaultDocumentManager.getDevelopDocument(doc.id)!;
  expect(ready.rawState).toBe('ready'); expect(ready.nativeAssetId).toBe('immutable-native');
  expect(ready.sourceUri).toBe(doc.sourceUri);
  expect(native.deleteFile).toHaveBeenCalledExactlyOnceWith('C:\\cache\\immutable.cr3');
  expect(native.releaseRawAsset).not.toHaveBeenCalled();
});

it.each(['missing original', 'missing staging backend'] as const)('fails explicitly for %s instead of falling back to mutable disk', async failure => {
  const { doc, handle } = await openCapturedRaw();
  if (failure === 'missing original') defaultAssetManager.releaseAsset(handle.id);
  else native.stageRawSource = undefined;
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  const failed = defaultDocumentManager.getDevelopDocument(doc.id)!;
  expect(failed.rawState).toBe('error'); expect(failed.rawError).toMatch(/original|staging/i);
  expect(native.getRawMetadata).not.toHaveBeenCalled(); expect(native.decodeRawImage).not.toHaveBeenCalled();
});

it('cleans a late staged RAW file after closing during staging without decoding it', async () => {
  const { doc } = await openCapturedRaw(), staged = deferred<string>();
  native.stageRawSource!.mockReturnValue(staged.promise);
  const loading = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await vi.waitFor(() => expect(native.stageRawSource).toHaveBeenCalledOnce());
  defaultDocumentManager.closeDocument(doc.id);
  expect(native.deleteFile).not.toHaveBeenCalled();
  staged.resolve('C:\\cache\\late.cr3'); await loading;
  expect(native.getRawMetadata).not.toHaveBeenCalled(); expect(native.decodeRawImage).not.toHaveBeenCalled();
  expect(native.deleteFile).toHaveBeenCalledExactlyOnceWith('C:\\cache\\late.cr3');
  expect(native.cancelRawDecode).not.toHaveBeenCalled();
});

it('keeps a staged RAW file until cancelled native decoding settles, then cleans it and the stale result once', async () => {
  const { doc } = await openCapturedRaw(), decoded = deferred<ReturnType<typeof result>>();
  native.decodeRawImage.mockReturnValue(decoded.promise);
  const loading = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await vi.waitFor(() => expect(native.decodeRawImage).toHaveBeenCalledOnce());
  defaultDocumentManager.closeDocument(doc.id);
  expect(native.cancelRawDecode).toHaveBeenCalledOnce(); expect(native.deleteFile).not.toHaveBeenCalled();
  decoded.resolve(result('closed-native')); await loading;
  expect(native.deleteFile).toHaveBeenCalledExactlyOnceWith('C:\\cache\\immutable.cr3');
  expect(native.releaseRawAsset).toHaveBeenCalledExactlyOnceWith('closed-native');
});

it.each(['metadata rejection', 'decode rejection'] as const)('cleans the staged RAW source after %s', async failure => {
  const { doc } = await openCapturedRaw();
  if (failure === 'metadata rejection') native.getRawMetadata.mockRejectedValue(new Error('Metadata rejected'));
  else native.decodeRawImage.mockRejectedValue(new Error('Decode rejected'));
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  expect(defaultDocumentManager.getDevelopDocument(doc.id)?.rawState).toBe('error');
  expect(native.deleteFile).toHaveBeenCalledExactlyOnceWith('C:\\cache\\immutable.cr3');
});

it.each(['staging', 'decoding'] as const)('invalidates a captured RAW identity change during %s', async stage => {
  const { doc } = await openCapturedRaw(), staged = deferred<string>(), decoded = deferred<ReturnType<typeof result>>();
  native.stageRawSource!.mockReturnValue(stage === 'staging' ? staged.promise : Promise.resolve('C:\\cache\\immutable.cr3'));
  native.decodeRawImage.mockReturnValue(decoded.promise);
  const loading = useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await vi.waitFor(() => expect(stage === 'staging' ? native.stageRawSource : native.decodeRawImage).toHaveBeenCalledOnce());
  const replacement = await defaultAssetManager.registerBlob(new Blob(['replacement source']), 'image', 'other.cr3', { width: 20, height: 10 });
  defaultDocumentManager.updateDocument({ ...defaultDocumentManager.getDevelopDocument(doc.id)!, originalRawAssetId: replacement.id });
  if (stage === 'staging') staged.resolve('C:\\cache\\immutable.cr3');
  else decoded.resolve(result('wrong-original-native'));
  await loading;
  expect(defaultDocumentManager.getDevelopDocument(doc.id)?.nativeAssetId).toBeFalsy();
  expect(native.deleteFile).toHaveBeenCalledExactlyOnceWith('C:\\cache\\immutable.cr3');
  if (stage === 'staging') expect(native.decodeRawImage).not.toHaveBeenCalled();
  else {
    expect(native.cancelRawDecode).toHaveBeenCalledOnce();
    expect(native.releaseRawAsset).toHaveBeenCalledExactlyOnceWith('wrong-original-native');
  }
});

it('releases a ready native RAW handle when its document later closes', async () => {
  const doc = openRaw(); native.decodeRawImage.mockResolvedValue(result('ready-native'));
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  expect(native.releaseRawAsset).not.toHaveBeenCalled();
  defaultDocumentManager.closeDocument(doc.id); await Promise.resolve();
  expect(native.releaseRawAsset).toHaveBeenCalledExactlyOnceWith('ready-native');
});

it('retains a shared ready native handle until the final open document closes', async () => {
  const doc = openRaw(); native.decodeRawImage.mockResolvedValue(result('shared-native'));
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  const copy = { ...defaultDocumentManager.getDevelopDocument(doc.id)!, id: 'native-shared-copy' };
  defaultDocumentManager.openDocument(copy);
  defaultDocumentManager.closeDocument(doc.id); await Promise.resolve();
  expect(native.releaseRawAsset).not.toHaveBeenCalled();
  defaultDocumentManager.closeDocument(copy.id); await Promise.resolve();
  expect(native.releaseRawAsset).toHaveBeenCalledExactlyOnceWith('shared-native');
});

it('releases the prior ready native handle on reload and the replacement on close', async () => {
  const doc = openRaw();
  native.decodeRawImage.mockResolvedValueOnce(result('old-ready-native')).mockResolvedValueOnce(result('new-ready-native'));
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
  expect(native.releaseRawAsset).toHaveBeenCalledExactlyOnceWith('old-ready-native');
  expect(defaultDocumentManager.getDevelopDocument(doc.id)?.nativeAssetId).toBe('new-ready-native');
  defaultDocumentManager.closeDocument(doc.id); await Promise.resolve();
  expect(native.releaseRawAsset.mock.calls).toEqual([['old-ready-native'], ['new-ready-native']]);
});

it('hands off ownership before synchronous document close during ready publication', async () => {
  const doc = openRaw(); native.decodeRawImage.mockResolvedValue(result('closed-on-publication'));
  const unsubscribe = defaultDocumentManager.subscribe(event => {
    if (event.type === 'updated' && event.document.id === doc.id && event.document.kind === 'develop' && event.document.rawState === 'ready') {
      defaultDocumentManager.closeDocument(doc.id);
    }
  });
  try { await useDevelopStore.getState().startRawLoadingPipeline(doc.id); }
  finally { unsubscribe(); }
  expect(defaultDocumentManager.getDocument(doc.id)).toBeNull();
  expect(native.releaseRawAsset).toHaveBeenCalledExactlyOnceWith('closed-on-publication');
});

it('releases every ready handle across repeated linked RAW variant open and close', async () => {
  for (let i = 0; i < 3; i++) {
    const doc = openRaw();
    defaultDocumentManager.updateDocument({ ...doc, rawSmartObjectLink: { documentId: 'edit-source', layerId: 'raw-layer', sourceRevision: 'recipe' } });
    native.decodeRawImage.mockResolvedValue(result(`variant-native-${i}`));
    await useDevelopStore.getState().startRawLoadingPipeline(doc.id);
    defaultDocumentManager.closeDocument(doc.id);
  }
  await Promise.resolve();
  expect(native.releaseRawAsset.mock.calls).toEqual([['variant-native-0'], ['variant-native-1'], ['variant-native-2']]);
});
