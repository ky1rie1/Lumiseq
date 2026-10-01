import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEditDocument } from '../../../document/EditDocument';
import type { EditDocument } from '../../../types/edit';
import { SelectionBar } from './SelectionBar';

const testState = vi.hoisted(() => ({ currentDoc: null as EditDocument | null }));
vi.mock('../../../stores/useEditStore', () => ({
  useEditStore: (selector: (state: typeof testState) => unknown) => selector(testState),
}));

afterEach(() => { testState.currentDoc = null; });

describe('selection toolbar', () => {
  it('keeps adjustment fields out of the primary action row', () => {
    const doc = createEditDocument({ name: 'Canvas', width: 800, height: 600 });
    testState.currentDoc = doc;

    const markup = renderToStaticMarkup(<SelectionBar activeTool="marquee" />);

    expect(markup).toContain('aria-label="新选区"');
    expect(markup).toContain('aria-label="羽化与扩缩"');
    expect(markup).not.toContain('aria-label="羽化半径（像素）"');
    expect(markup).not.toContain('overflow-x-auto');
  });

  it('offers one automatic cutout entry for a selected image layer without a selection tool', () => {
    testState.currentDoc = createEditDocument({ name: 'Canvas', width: 800, height: 600 });
    const markup = renderToStaticMarkup(<SelectionBar activeTool="move" canAutoCutout onAutoCutout={() => {}} />);
    expect(markup).toContain('自动抠图');
    expect(markup).not.toContain('选择主体与边缘精修');
  });
});
