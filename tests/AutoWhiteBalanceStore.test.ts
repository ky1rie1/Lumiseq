import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDocumentManager } from '../src/document/DocumentManager';
import { defaultCommandBus } from '../src/history/CommandBus';
import { createDevelopDocument } from '../src/document/DevelopDocument';
import { getPlatformBridge } from '../src/platform';
import { useDevelopStore } from '../src/stores/useDevelopStore';

function readyDocument(name: string) {
  const doc = createDevelopDocument({ sourceUri: name, fileName: name, isRaw: true });
  doc.nativeAssetId = name;
  doc.rawState = 'ready';
  defaultDocumentManager.openDocument(doc);
  return doc;
}

function deferredSample() {
  let finish!: (samples: number[][]) => void;
  const promise = new Promise<number[][]>(resolve => { finish = resolve; });
  return { promise, finish: () => finish(Array.from({ length: 100 }, () => [.24, .2, .17])) };
}

beforeEach(() => {
  vi.spyOn(getPlatformBridge(), 'releaseRawAsset').mockResolvedValue(undefined);
  defaultDocumentManager.closeAll();
  defaultCommandBus.clear();
});
afterEach(() => {
  defaultDocumentManager.closeAll();
  vi.restoreAllMocks();
});

describe('automatic white balance UI request ownership', () => {
  it('keeps newer B busy and error-free when cancelled A finishes first', async () => {
    const doc = readyDocument('overlap.raw');
    const a = deferredSample(), b = deferredSample();
    vi.spyOn(getPlatformBridge(), 'getRawLinearSample')
      .mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = useDevelopStore.getState().setWhiteBalance(doc.id, { mode: 'auto' });
    const second = useDevelopStore.getState().setWhiteBalance(doc.id, { mode: 'auto' });
    a.finish();
    await first;
    expect(useDevelopStore.getState().whiteBalanceBusy).toBe(true);
    expect(useDevelopStore.getState().whiteBalanceError).toBeNull();
    expect(defaultCommandBus.canUndo()).toBe(false);
    b.finish();
    await second;
    expect(useDevelopStore.getState().whiteBalanceBusy).toBe(false);
    expect(useDevelopStore.getState().whiteBalanceError).toBeNull();
    expect(defaultDocumentManager.getDevelopDocument(doc.id)?.settings.whiteBalance.mode).toBe('auto');
  });

  it('resets status on activation and prevents an old request updating the new document status', async () => {
    const firstDoc = readyDocument('old.raw');
    const a = deferredSample(), b = deferredSample();
    vi.spyOn(getPlatformBridge(), 'getRawLinearSample')
      .mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const first = useDevelopStore.getState().setWhiteBalance(firstDoc.id, { mode: 'auto' });
    readyDocument('new.raw');
    expect(useDevelopStore.getState().whiteBalanceBusy).toBe(false);
    expect(useDevelopStore.getState().whiteBalanceError).toBeNull();
    const secondDoc = defaultDocumentManager.getActiveDocument()!;
    const second = useDevelopStore.getState().setWhiteBalance(secondDoc.id, { mode: 'auto' });
    a.finish();
    await first;
    expect(useDevelopStore.getState().whiteBalanceBusy).toBe(true);
    expect(useDevelopStore.getState().whiteBalanceError).toBeNull();
    b.finish();
    await second;
    expect(useDevelopStore.getState().whiteBalanceBusy).toBe(false);
  });

  it('clears errors and pending status when loadDocument selects another document', async () => {
    const old = readyDocument('load-old.raw');
    const next = createDevelopDocument({ sourceUri: 'load-next.raw', fileName: 'load-next.raw', isRaw: true });
    defaultDocumentManager.openDocument(next, false);
    vi.spyOn(getPlatformBridge(), 'getRawLinearSample').mockRejectedValueOnce(new Error('source unavailable'));
    await useDevelopStore.getState().setWhiteBalance(old.id, { mode: 'auto' });
    expect(useDevelopStore.getState().whiteBalanceError).toBe('source unavailable');
    useDevelopStore.getState().loadDocument(next);
    expect(useDevelopStore.getState().whiteBalanceError).toBeNull();
    expect(useDevelopStore.getState().whiteBalanceBusy).toBe(false);
  });
});
