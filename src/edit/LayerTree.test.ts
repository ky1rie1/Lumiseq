import { describe, expect, it } from 'vitest';
import { createEditDocument, createGroupLayer, createPaintLayer } from '../document/EditDocument';
import { hitTestLayerTree, isLayerLocked } from './LayerTree';

it('hit tests nested rotated layer pixels and maps document pointer motion into parent coordinates', async () => {
  const modulePath = './LayerTree'; const tree = await import(modulePath);
  const child = createPaintLayer({ id: 'pixels', rasterAssetId: 'pixel-asset', width: 20, height: 10, x: 30, y: 40 });
  const group = createGroupLayer({ children: [child] }); group.transform = { ...group.transform, x: 100, y: 10, rotation: 90, scaleX: 2, scaleY: 2 };
  const doc = createEditDocument({ layers: [group] });
  expect(tree.hitTestLayerTree).toBeTypeOf('function'); expect(tree.layerRasterPoint).toBeTypeOf('function'); expect(tree.documentDeltaToParent).toBeTypeOf('function');
  // Child local pixel(5,3): parentlocal(35,43) => world(14,80).
  expect(tree.hitTestLayerTree(doc, 14, 80)?.id).toBe(child.id);
  expect(tree.layerRasterPoint(doc, child.id, 14, 80).x).toBeCloseTo(5);
  expect(tree.layerRasterPoint(doc, child.id, 14, 80).y).toBeCloseTo(3);
  expect(tree.documentDeltaToParent(doc, child.id, 20, 0).x).toBeCloseTo(0);
  expect(tree.documentDeltaToParent(doc, child.id, 20, 0).y).toBeCloseTo(-10);
});

describe('explicit move selection hit testing', () => {
  it('hits the selected lower layer independently of an overlapping upper sibling', () => {
    const lower = createPaintLayer({ id: 'lower', rasterAssetId: 'lower-pixels', width: 20, height: 20 });
    const upper = createPaintLayer({ id: 'upper', rasterAssetId: 'upper-pixels', width: 20, height: 20 });
    const doc = createEditDocument({ layers: [lower, upper] });

    expect(hitTestLayerTree(doc, 10, 10)?.id).toBe('upper');
    expect(hitTestLayerTree(doc, 10, 10, lower.id)?.id).toBe('lower');
    expect(hitTestLayerTree(doc, 25, 10, lower.id)).toBeNull();
  });

  it('tests the selected nested layer through rotated, scaled and mirrored ancestor geometry', () => {
    const child = createPaintLayer({ id: 'nested', rasterAssetId: 'pixels', width: 20, height: 10, x: 30, y: 40 });
    child.transform = { ...child.transform, x: 50, scaleX: -1 };
    const group = createGroupLayer({ children: [child] });
    group.transform = { ...group.transform, x: 100, y: 10, rotation: 90, scaleX: 2, scaleY: 2 };
    const upper = createPaintLayer({ id: 'upper', rasterAssetId: 'upper-pixels', width: 40, height: 120 });
    const doc = createEditDocument({ layers: [group, upper] });
    // Child local (5,3) -> group (45,43) -> document (14,100).
    expect(hitTestLayerTree(doc, 14, 100)?.id).toBe('upper');
    expect(hitTestLayerTree(doc, 14, 100, child.id)?.id).toBe('nested');
    // Document (14,120) is outside the child's local rectangle.
    expect(hitTestLayerTree(doc, 14, 120, child.id)).toBeNull();
  });

  it('ignores selected descendants of hidden ancestors and hidden selected layers', () => {
    const child = createPaintLayer({ id: 'nested', rasterAssetId: 'pixels', width: 20, height: 20 });
    const group = createGroupLayer({ children: [child] });
    const doc = createEditDocument({ layers: [group] });
    group.visible = false;
    expect(hitTestLayerTree(doc, 10, 10, child.id)).toBeNull();
    group.visible = true;
    child.visible = false;
    expect(hitTestLayerTree(doc, 10, 10, child.id)).toBeNull();
  });

  it('keeps inherited lock rejection separate from selecting the covered layer', () => {
    const child = createPaintLayer({ id: 'nested', rasterAssetId: 'pixels', width: 20, height: 20 });
    const group = createGroupLayer({ children: [child] });
    group.locked = true;
    const upper = createPaintLayer({ id: 'upper', rasterAssetId: 'upper-pixels', width: 20, height: 20 });
    const doc = createEditDocument({ layers: [group, upper] });
    expect(hitTestLayerTree(doc, 10, 10, child.id)?.id).toBe('nested');
    expect(isLayerLocked(doc, child.id)).toBe(true);
    expect(isLayerLocked(doc, upper.id)).toBe(false);
  });

  it('preserves the selected group fallback outside its footprint while honoring ancestor visibility', () => {
    const selected = createGroupLayer({ id: 'selected', children: [] });
    const parent = createGroupLayer({ children: [selected] });
    const doc = createEditDocument({ layers: [parent] });
    expect(hitTestLayerTree(doc, 500, 500, selected.id)?.id).toBe('selected');
    parent.visible = false;
    expect(hitTestLayerTree(doc, 500, 500, selected.id)).toBeNull();
    expect(hitTestLayerTree(doc, 500, 500, 'missing')).toBeNull();
  });

  it('does not hit a selected layer whose transform is singular', () => {
    const selected = createPaintLayer({ id: 'singular', rasterAssetId: 'pixels', width: 20, height: 20 });
    selected.transform.scaleX = 0;
    const upper = createPaintLayer({ id: 'upper', rasterAssetId: 'upper-pixels', width: 20, height: 20 });
    const doc = createEditDocument({ layers: [selected, upper] });
    expect(hitTestLayerTree(doc, 10, 10, selected.id)).toBeNull();
  });
});
