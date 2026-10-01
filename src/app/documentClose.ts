import type { StudioDocument } from '../types/document';

/** An imported image has no durable editable copy until its first project save. */
export function documentsNeedingSave(documents: StudioDocument[], savedPaths: ReadonlyMap<string, string>): StudioDocument[] {
  return documents.filter(doc => doc.isDirty || !savedPaths.has(doc.id));
}
