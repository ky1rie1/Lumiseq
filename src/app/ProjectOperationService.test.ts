import { describe, expect, it, vi } from 'vitest';
import { createEditDocument } from '../document/EditDocument';
import { createDevelopDocument } from '../document/DevelopDocument';
import { ProjectOperationService } from './ProjectOperationService';
import { savedProjectPaths } from './projectPaths';

describe('ProjectOperationService', () => {
  it('serializes, writes and only then marks a document saved and records the project', async () => {
    const order: string[] = [];
    const service = new ProjectOperationService({
      serialize: async () => { order.push('serialize'); return '{"project":true}'; },
      write: async () => { order.push('write'); },
      markSaved: () => { order.push('saved'); },
      record: () => { order.push('recent'); },
    });
    await service.save(createEditDocument({ name: '画布' }), 'C:\\Work\\画布.aistudio');
    expect(order).toEqual(['serialize', 'write', 'saved', 'recent']);
  });

  it('leaves dirty state and recent projects alone when the disk write fails', async () => {
    const markSaved = vi.fn();
    const record = vi.fn();
    const service = new ProjectOperationService({
      serialize: async () => '{}', write: async () => { throw new Error('disk full'); },
      markSaved, record,
    });
    await expect(service.save(createEditDocument({ name: '画布' }), 'C:\\Work\\画布.aistudio')).rejects.toThrow('disk full');
    expect(markSaved).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    await expect(service.save(createEditDocument({ name: '画布' }), 'relative.aistudio')).rejects.toThrow('本地');
  });

  it('saves a RAW develop project through the same operation entry point', async () => {
    const order: string[] = [];
    const raw = createDevelopDocument({ fileName: 'photo.cr3', sourceUri: 'C:\\Work\\photo.cr3', isRaw: true });
    const service = new ProjectOperationService({
      serialize: async doc => { expect(doc.kind).toBe('develop'); order.push('serialize'); return '{}'; },
      write: async () => { order.push('write'); },
      markSaved: () => { order.push('saved'); },
      record: () => { order.push('recent'); },
    });
    await service.save(raw, 'C:\\Work\\photo.aistudio');
    expect(order).toEqual(['serialize', 'write', 'saved', 'recent']);
    expect(savedProjectPaths.get(raw.id)).toBe('C:\\Work\\photo.aistudio');
  });
});
