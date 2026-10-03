import type { StudioDocument } from '../types/document';
import { defaultProjectSerializer } from '../project/ProjectSerializer';
import { defaultDevelopProjectSerializer } from '../project/DevelopProjectSerializer';
import { defaultAssetManager } from '../assets/AssetManager';
import { defaultDocumentManager } from '../document/DocumentManager';
import { defaultRecentProjectsStore } from './recentProjects';
import { getPlatformBridge } from '../platform';
import { savedProjectPaths } from './projectPaths';

const pendingWrites = new Map<string, Promise<unknown>>();
export function serializeWrites<T>(keys: string[], write: () => Promise<T>): Promise<T> {
  const operation = Promise.all(keys.map(key => pendingWrites.get(key)?.catch(() => undefined))).then(write);
  for (const key of keys) pendingWrites.set(key, operation);
  void operation.finally(() => { for (const key of keys) if (pendingWrites.get(key) === operation) pendingWrites.delete(key); }).catch(() => undefined);
  return operation;
}

export interface ProjectSavePorts {
  serialize(document: StudioDocument): Promise<string | Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  markSaved(documentId: string, snapshot?: StudioDocument): void;
  record(path: string): void;
}

/** Shared, UI-independent save operation. Both manual controls and future AI tools can call it. */
export class ProjectOperationService {
  constructor(private readonly ports: ProjectSavePorts) {}

  async save(document: StudioDocument, path: string): Promise<{ recentRecorded: boolean }> {
    if (!/\.(aistudio|lsq|lumiseq)$/i.test(path) || !(/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/'))) {
      throw new Error('请选择本地 .lsq 或 .aistudio 项目文件。');
    }
    const snapshot = structuredClone(document);
    return serializeWrites([document.id, path.toLowerCase()], async () => {
    const payload = await this.ports.serialize({ ...snapshot, isDirty: false });
    await this.ports.write(path, typeof payload === 'string' ? new TextEncoder().encode(payload) : payload);
    this.ports.markSaved(document.id, snapshot);
    savedProjectPaths.set(document.id, path);
    try {
      this.ports.record(path);
      return { recentRecorded: true };
    } catch {
      // An unavailable recent-list store must not report a completed disk save as failed.
      return { recentRecorded: false };
    }
    });
  }
}

export const defaultProjectOperations = new ProjectOperationService({
  serialize: document => document.kind === 'edit'
    ? document.renderingVersion === 2
      ? defaultProjectSerializer.serializeBinary(document, defaultAssetManager)
      : defaultProjectSerializer.serialize(document, defaultAssetManager)
    : defaultDevelopProjectSerializer.serialize(document, defaultAssetManager),
  write: (path, bytes) => getPlatformBridge().writeBinaryFile(path, bytes),
  markSaved: (id, snapshot) => defaultDocumentManager.markSaved(id, snapshot),
  record: path => { defaultRecentProjectsStore.record(path); },
});
