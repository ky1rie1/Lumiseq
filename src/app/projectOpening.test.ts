import { describe, expect, it } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { createEditDocument } from '../document/EditDocument';
import { findOpenProjectDocumentId } from './projectOpening';

describe('findOpenProjectDocumentId', () => {
  it('reuses an open project path across Windows case and separator differences', () => {
    const documents = new DocumentManager();
    const doc = createEditDocument({ name: '作品', width: 500, height: 500 });
    documents.openDocument(doc);
    const paths = new Map([[doc.id, 'C:\\Work\\作品.aistudio']]);
    expect(findOpenProjectDocumentId('c:/work/作品.aistudio', paths, documents)).toBe(doc.id);
    documents.closeDocument(doc.id);
    expect(findOpenProjectDocumentId('C:\\Work\\作品.aistudio', paths, documents)).toBeNull();
  });
});
