import { describe, expect, it, vi } from 'vitest';
import { DocumentManager } from '../document/DocumentManager';
import { DocumentOperationService } from './DocumentOperationService';

describe('DocumentOperationService', () => {
  const setup = () => {
    const manager = new DocumentManager();
    const activate = vi.fn();
    const workspace = vi.fn();
    const status = vi.fn();
    const service = new DocumentOperationService(manager, { activate, workspace, status });
    return { manager, activate, workspace, status, service };
  };

  it('creates a canvas and activates it through one operation path', () => {
    const { service, manager, activate, workspace } = setup();
    const doc = service.create({ kind: 'edit', name: '封面', width: 1200, height: 800 });
    expect(manager.getDocument(doc.id)).toBe(doc);
    expect(activate).toHaveBeenCalledWith(doc.id);
    expect(workspace).toHaveBeenCalledWith('edit');
  });

  it('activates an existing document and rejects missing document ids', () => {
    const { service, manager, workspace } = setup();
    const doc = service.create({ kind: 'edit', name: 'A', width: 400, height: 300 });
    expect(service.activate(doc.id)).toBe(doc);
    expect(workspace).toHaveBeenCalledWith('edit');
    expect(() => service.activate('missing')).toThrow('文档不存在');
    expect(manager.getActiveDocument()?.id).toBe(doc.id);
  });

  it('rejects invalid dimensions before creating a document', () => {
    const { service, manager } = setup();
    expect(() => service.create({ kind: 'edit', name: 'bad', width: -1, height: 300 })).toThrow();
    expect(() => service.create({ kind: 'edit', name: 'bad', width: 999999, height: 300 })).toThrow();
    expect(manager.getOpenDocuments()).toHaveLength(0);
  });

  it('creates a named document with chosen resolution and background through the shared operation', () => {
    const { service } = setup();
    const doc = service.create({ kind: 'edit', name: ' 印刷海报 ', width: 2480, height: 3508, dpi: 300, backgroundColor: '#ffffff' });
    expect(doc.kind).toBe('edit');
    if (doc.kind === 'edit') {
      expect(doc.name).toBe('印刷海报');
      expect(doc.dpi).toBe(300);
      expect(doc.backgroundColor).toBe('#ffffff');
    }
    expect(() => service.create({ kind: 'edit', name: 'bad', width: 200, height: 200, dpi: 0 })).toThrow();
  });
});
