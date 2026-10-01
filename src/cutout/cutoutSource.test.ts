import { expect, it } from 'vitest';
import { createEditDocument, createGroupLayer, createImageLayer } from '../document/EditDocument';
import { cutoutSourceFingerprint } from './cutoutSource';
it('detects parent transform, source replacement and canvas changes while tolerating unrelated edits', () => {
  const layer = createImageLayer({ name: 'Photo', sourceAssetId: 'original', naturalWidth: 100, naturalHeight: 100 });
  const group = createGroupLayer({ children: [layer] });
  const doc = createEditDocument({ layers: [group] });
  const before = cutoutSourceFingerprint(doc, layer.id);
  group.name = 'renamed'; expect(cutoutSourceFingerprint(doc, layer.id)).toBe(before);
  group.transform.x = 20; expect(cutoutSourceFingerprint(doc, layer.id)).not.toBe(before);
  group.transform.x = 0; layer.sourceAssetId = 'replaced'; expect(cutoutSourceFingerprint(doc, layer.id)).not.toBe(before);
  layer.sourceAssetId = 'original'; doc.width += 1; expect(cutoutSourceFingerprint(doc, layer.id)).not.toBe(before);
});
