import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LayersPanel } from './LayersPanel';
import { createEditDocument, createGroupLayer, createTextLayer } from '../../../document/EditDocument';
import { useEditStore } from '../../../stores/useEditStore';
import { defaultDocumentManager } from '../../../document/DocumentManager';

it('renders recursive accessible tree rows with independent controls and total count', () => {
  const child = createTextLayer({ id: 'text-child', text: 'Nested title' });
  const doc = createEditDocument({ id: 'tree-ui', layers: [createGroupLayer({ id: 'folder', children: [child] })] });
  const html = renderToStaticMarkup(<LayersPanel document={doc} selectedLayer={child} selectedLayerId={child.id} newTextPrompt="Text" onChangeNewTextPrompt={() => {}} onAddImageLayer={() => {}} onShowProperties={() => {}} />);
  expect(html).toContain('role="tree"'); expect(html.match(/role="treeitem"/g)).toHaveLength(2);
  expect(html).toContain('图层 (2)'); expect(html).toContain('Nested title');
  const buttonTags = html.match(/<\/?button\b[^>]*>/g) ?? [];
  let depth = 0;
  for (const tag of buttonTags) { depth += tag.startsWith('</') ? -1 : 1; expect(depth).toBeLessThanOrEqual(1); }
});

it.each([false, true])('selects a nested layer without changing dirty state (%s) or timestamp', dirty => {
  const child = createTextLayer({ id: 'selection-child', text: 'Select me' });
  const doc = createEditDocument({ id: `select-${dirty}`, layers: [createGroupLayer({ children: [child] })] });
  doc.isDirty = dirty; doc.updatedAt = 123;
  defaultDocumentManager.openDocument(doc); useEditStore.getState().loadDocument(doc);
  useEditStore.getState().selectLayer(child.id);
  const selected = defaultDocumentManager.getEditDocument(doc.id)!;
  expect(selected.selectedLayerId).toBe(child.id); expect(selected.isDirty).toBe(dirty); expect(selected.updatedAt).toBe(123);
  defaultDocumentManager.closeDocument(doc.id);
});

it('keeps expansion preferences per document without a document edit or history entry', () => {
  const store = useEditStore.getState() as any;
  expect(store.toggleLayerExpanded).toBeTypeOf('function');
  const doc = createEditDocument({ id: 'expansion-doc', layers: [createGroupLayer({ id: 'folder' })] });
  store.loadDocument(doc); store.toggleLayerExpanded(doc.id, 'folder');
  expect(useEditStore.getState().currentDoc).toBe(doc); expect(doc.isDirty).toBe(false);
  expect((useEditStore.getState() as any).collapsedLayerIds[doc.id]).toEqual(['folder']);
  store.loadDocument(createEditDocument({ id: 'other-doc' })); store.loadDocument(doc);
  expect((useEditStore.getState() as any).collapsedLayerIds[doc.id]).toEqual(['folder']);
});
