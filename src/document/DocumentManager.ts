// src/document/DocumentManager.ts
import {
  DocumentEvent,
  DocumentEventListener,
  IDocumentManager,
  StudioDocument
} from '../types/document';
import { DevelopDocument } from '../types/develop';
import { EditDocument } from '../types/edit';

const DEVELOP_RUNTIME_KEYS = [
  'rawState', 'rawProgress', 'rawError', 'activeJobId', 'nativeAssetId',
  'previewAssetId', 'sourceAssetId', 'rawEngineAttached', 'pipelineState',
  'width', 'height', 'exif',
] as const;
export type DevelopRuntimePatch = Partial<Pick<DevelopDocument, typeof DEVELOP_RUNTIME_KEYS[number]>> & {
  cameraMultipliers?: DevelopDocument['settings']['whiteBalance']['cameraMultipliers'];
};

/** Restore editable state without rewinding decoder jobs or their current resources. */
export function restoreDocumentSnapshot(documents: IDocumentManager, snapshot: StudioDocument, changeSummary?: string): void {
  const restored = structuredClone(snapshot);
  const current = documents.getDevelopDocument(restored.id);
  if (restored.kind === 'develop' && current) {
    const runtime = Object.fromEntries(DEVELOP_RUNTIME_KEYS.map(key => [key, current[key]]));
    Object.assign(restored, structuredClone(runtime));
    restored.settings.whiteBalance.cameraMultipliers = current.settings.whiteBalance.cameraMultipliers
      ? [...current.settings.whiteBalance.cameraMultipliers]
      : undefined;
  }
  documents.updateDocument(restored, changeSummary);
}

export class DocumentManager implements IDocumentManager {
  private documents: Map<string, StudioDocument> = new Map();
  private activeId: string | null = null;
  private listeners: Set<DocumentEventListener> = new Set();

  getActiveDocument(): StudioDocument | null {
    if (!this.activeId) return null;
    return this.documents.get(this.activeId) || null;
  }

  getDocument(id: string): StudioDocument | null {
    return this.documents.get(id) || null;
  }

  getDevelopDocument(id: string): DevelopDocument | null {
    const doc = this.documents.get(id);
    if (doc && doc.kind === 'develop') {
      return doc as DevelopDocument;
    }
    return null;
  }

  getEditDocument(id: string): EditDocument | null {
    const doc = this.documents.get(id);
    if (doc && doc.kind === 'edit') {
      return doc as EditDocument;
    }
    return null;
  }

  getOpenDocuments(): StudioDocument[] {
    return Array.from(this.documents.values());
  }

  openDocument(doc: StudioDocument, setAsActive: boolean = true): void {
    this.documents.set(doc.id, doc);
    this.emit({ type: 'opened', document: doc });

    if (setAsActive) {
      this.setActiveDocument(doc.id);
    }
  }

  closeDocument(id: string): boolean {
    if (!this.documents.has(id)) return false;

    this.documents.delete(id);
    this.emit({ type: 'closed', documentId: id });

    if (this.activeId === id) {
      const remaining = Array.from(this.documents.keys());
      this.setActiveDocument(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    }

    return true;
  }

  closeAll(): void {
    const ids = Array.from(this.documents.keys());
    for (const id of ids) {
      this.closeDocument(id);
    }
  }

  setActiveDocument(id: string | null): void {
    if (id !== null && !this.documents.has(id)) {
      throw new Error(`Document with ID "${id}" does not exist in DocumentManager.`);
    }

    if (this.activeId !== id) {
      this.activeId = id;
      this.emit({ type: 'activated', documentId: id });
    }
  }

  updateDocument(doc: StudioDocument, changeSummary?: string, markDirty = true): void {
    if (!markDirty && doc.kind === 'develop') {
      this.updateDevelopRuntime(doc.id, doc, changeSummary);
      return;
    }
    const current = this.documents.get(doc.id);
    if (!current) {
      throw new Error(`Cannot update document "${doc.id}": not found in DocumentManager.`);
    }
    const updatedDoc: StudioDocument = {
      ...doc,
      isDirty: markDirty ? true : current.isDirty,
      updatedAt: markDirty ? Date.now() : current.updatedAt,
    };

    this.documents.set(doc.id, updatedDoc);
    this.emit({ type: 'updated', document: updatedDoc, changeSummary });
  }

  /** Decoder publications may change only derived/runtime fields on the latest document. */
  updateDevelopRuntime(id: string, patch: DevelopRuntimePatch, changeSummary?: string, expectedJobId?: string): boolean {
    const current = this.getDevelopDocument(id);
    if (!current || (expectedJobId !== undefined && current.activeJobId !== expectedJobId)) return false;
    const runtime = Object.fromEntries(DEVELOP_RUNTIME_KEYS
      .filter(key => Object.prototype.hasOwnProperty.call(patch, key))
      .map(key => [key, patch[key]]));
    const updated: DevelopDocument = { ...current, ...runtime };
    if (patch.exif) updated.exif = { ...current.exif, ...patch.exif };
    if (patch.cameraMultipliers) {
      updated.settings = { ...current.settings, whiteBalance: {
        ...current.settings.whiteBalance, cameraMultipliers: [...patch.cameraMultipliers],
      } };
    }
    this.documents.set(id, updated);
    this.emit({ type: 'updated', document: updated, changeSummary });
    return true;
  }

  markSaved(id: string, snapshot?: StudioDocument): void {
    const doc = this.documents.get(id);
    if (!doc) {
      if (snapshot) return;
      throw new Error(`Document with ID "${id}" does not exist in DocumentManager.`);
    }
    if (snapshot && JSON.stringify({ ...doc, isDirty: false }) !== JSON.stringify({ ...snapshot, isDirty: false })) return;
    const saved = { ...doc, isDirty: false } as StudioDocument;
    this.documents.set(id, saved);
    this.emit({ type: 'updated', document: saved, changeSummary: 'saved' });
  }

  subscribe(listener: DocumentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: DocumentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in DocumentEventListener:', err);
      }
    }
  }
}

export const defaultDocumentManager = new DocumentManager();
