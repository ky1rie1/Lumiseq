import type { StudioDocument } from '../types/document';
import { documentsNeedingSave } from './documentClose';
/** Cleanup is asynchronous: edits occurring during it still need a save decision. */
export async function prepareWindowClose(getDocuments: () => StudioDocument[], paths: ReadonlyMap<string, string>, discardedIds: readonly string[], cleanup: () => Promise<void>): Promise<StudioDocument[]> {
    const pending = () => documentsNeedingSave(getDocuments(), paths).filter(doc => !discardedIds.includes(doc.id));
    const before = pending();
    if (before.length)
        return before;
    await cleanup();
    return pending();
}
