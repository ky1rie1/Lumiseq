// src/types/document.ts
import { DevelopDocument } from './develop';
import { EditDocument } from './edit';

export type StudioDocument = DevelopDocument | EditDocument;
export type DocumentKind = 'develop' | 'edit';

export type DocumentEventListener = (event: DocumentEvent) => void;

export type DocumentEvent =
  | { type: 'opened'; document: StudioDocument }
  | { type: 'closed'; documentId: string }
  | { type: 'activated'; documentId: string | null }
  | { type: 'updated'; document: StudioDocument; changeSummary?: string };

export interface IDocumentManager {
  /** Get currently active document */
  getActiveDocument(): StudioDocument | null;

  /** Get document by ID */
  getDocument(id: string): StudioDocument | null;

  /** Get Develop document by ID with type guard */
  getDevelopDocument(id: string): DevelopDocument | null;

  /** Get Edit document by ID with type guard */
  getEditDocument(id: string): EditDocument | null;

  /** List all open documents */
  getOpenDocuments(): StudioDocument[];

  /** Open or register a new document */
  openDocument(doc: StudioDocument, setAsActive?: boolean): void;

  /** Close an open document */
  closeDocument(id: string): boolean;

  /** Close all open documents */
  closeAll(): void;

  /** Set active document */
  setActiveDocument(id: string | null): void;

  /** Update an existing document and notify listeners */
  updateDocument(doc: StudioDocument, changeSummary?: string, markDirty?: boolean): void;

  /** Subscribe to document lifecycle and change events */
  subscribe(listener: DocumentEventListener): () => void;
}
