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
  native.getRawMetadata.mockResolvedValue(null);
  native.extractRawThumbnail.mockResolvedValue(null);
  native.cancelRawDecode.mockResolvedValue(undefined);
  native.releaseRawAsset.mockResolvedValue(undefined);
});
afterEach(() => {
  native.getRawLinearPreview=undefined;
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
