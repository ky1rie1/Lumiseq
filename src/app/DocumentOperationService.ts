import { DocumentManager, defaultDocumentManager } from '../document/DocumentManager';
import { createDevelopDocument } from '../document/DevelopDocument';
import { createEditDocument } from '../document/EditDocument';
import { useAppStore } from '../stores/useAppStore';
import { StudioDocument } from '../types/document';

export interface DocumentActionPort {
  activate(id: string): void;
  workspace(kind: 'edit' | 'develop'): void;
  status(message: string): void;
}

export interface CreateDocumentRequest {
  kind: 'edit' | 'develop';
  name: string;
  width: number;
  height: number;
  dpi?: number;
  backgroundColor?: string;
}

/** The same document operations are used by the workbench, search and AI tools. */
export class DocumentOperationService {
  constructor(private readonly manager: DocumentManager, private readonly port: DocumentActionPort) {}

  create(request: CreateDocumentRequest): StudioDocument {
    const { kind, name, width, height } = request;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384) {
      throw new Error('画布尺寸必须是 1 至 16384 像素之间的整数。');
    }
    if (!name.trim()) throw new Error('文档名称不能为空。');
    if (request.dpi !== undefined && (!Number.isInteger(request.dpi) || request.dpi < 1 || request.dpi > 1200)) {
      throw new Error('分辨率必须是 1 至 1200 PPI 之间的整数。');
    }
    if (request.backgroundColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(request.backgroundColor)) {
      throw new Error('画布背景色必须是有效的十六进制颜色。');
    }
    const doc = kind === 'develop'
      ? createDevelopDocument({ fileName: name.trim(), sourceUri: `memory://${encodeURIComponent(name.trim())}`, isRaw: false, width, height })
      : createEditDocument({ name: name.trim(), width, height, dpi: request.dpi, backgroundColor: request.backgroundColor, renderingVersion: 2 });
    this.manager.openDocument(doc, false);
    return this.activate(doc.id);
  }

  activate(id: string): StudioDocument {
    const doc = this.manager.getDocument(id);
    if (!doc) throw new Error(`文档不存在：${id}`);
    this.manager.setActiveDocument(id);
    this.port.activate(id);
    this.port.workspace(doc.kind);
    this.port.status(`已切换到 ${doc.kind === 'edit' ? doc.name : doc.fileName}`);
    return doc;
  }
}

export function createDocumentOperations(manager: DocumentManager): DocumentOperationService {
  const syncApp = manager === defaultDocumentManager;
  return new DocumentOperationService(manager, {
    activate: id => { if (syncApp) useAppStore.getState().setActiveDocumentId(id); },
    workspace: kind => { if (syncApp) useAppStore.getState().setWorkspace(kind); },
    status: message => { if (syncApp) useAppStore.getState().setStatusMessage(message); },
  });
}

export const defaultDocumentOperations = createDocumentOperations(defaultDocumentManager);
