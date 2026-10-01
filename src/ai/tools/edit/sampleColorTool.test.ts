import { afterEach, expect, it, vi } from 'vitest';
import { SampleColorTool } from './professionalTools';
import { sampleDocumentColor } from '../../../tools/sampleDocumentColor';
import { createEditDocument } from '../../../document/EditDocument';
import { DocumentManager } from '../../../document/DocumentManager';
import { defaultCommandBus } from '../../../history/CommandBus';

vi.mock('../../../tools/sampleDocumentColor', () => ({ sampleDocumentColor: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const doc = createEditDocument({ width: 10, height: 10 });
const documents = new DocumentManager();
documents.openDocument(doc, true);
const context = { documentManager: documents, commandBus: defaultCommandBus, currentWorkspace: 'edit' as const };

it('reports the actual document sample instead of a white placeholder', async () => {
  vi.mocked(sampleDocumentColor).mockResolvedValue({ x: 3, y: 4, sampleSize: 1, rgb: { r: 17, g: 103, b: 231 }, hex: '#1167e7', hsl: { h: 216, s: 86, l: 49 } });
  const result = await new SampleColorTool().execute(context, { x: 3.8, y: 4.1 }, 'sample');
  expect(result.success).toBe(true);
  expect(result.after.hex).toBe('#1167e7');
  expect(sampleDocumentColor).toHaveBeenCalledWith(doc, 3.8, 4.1, 1);
});
it('reports a read failure instead of fabricating a successful color', async () => {
  vi.mocked(sampleDocumentColor).mockRejectedValue(new Error('Canvas is unavailable'));
  const result = await new SampleColorTool().execute(context, { x: 3, y: 4 }, 'sample');
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain('Canvas is unavailable');
});
