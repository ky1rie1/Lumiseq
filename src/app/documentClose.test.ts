import { describe, expect, it } from 'vitest';
import { createEditDocument } from '../document/EditDocument';
import { createDevelopDocument } from '../document/DevelopDocument';
import { documentsNeedingSave } from './documentClose';

describe('document close protection', () => {
  it('prompts for an imported image even before its first edit, then stops after save', () => {
    const image = createEditDocument({ name: 'photo.jpg' });
    expect(documentsNeedingSave([image], new Map())).toEqual([image]);
    expect(documentsNeedingSave([image], new Map([[image.id, 'C:\\Work\\photo.psd']]))).toEqual([]);
    image.isDirty = true;
    expect(documentsNeedingSave([image], new Map([[image.id, 'C:\\Work\\photo.psd']]))).toEqual([image]);
  });

  it('prompts for an unsaved RAW project and stops after save', () => {
    const raw = createDevelopDocument({ fileName: 'photo.cr3', sourceUri: 'C:\\photo.cr3', isRaw: true, width: 10, height: 10 });
    expect(documentsNeedingSave([raw], new Map())).toEqual([raw]);
    expect(documentsNeedingSave([raw], new Map([[raw.id, 'C:\\Work\\photo.aistudio']]))).toEqual([]);
    raw.isDirty = true;
    expect(documentsNeedingSave([raw], new Map([[raw.id, 'C:\\Work\\photo.aistudio']]))).toEqual([raw]);
  });
});
