import { describe, expect, it } from 'vitest';
import { createEditDocument, createGroupLayer, createTextLayer } from '../document/EditDocument';
import { DocumentManager } from '../document/DocumentManager';
import { CommandBus } from '../history/CommandBus';
import { SetTextEffectsCommand } from '../commands/edit/SetTextEffectsCommand';
import { validateTextEffects } from './TextEffects';
import { drawTextLayer, textEffectInsets } from '../engine/drawTextLayer';
import { ProjectSerializer } from '../project/ProjectSerializer';
import { AssetManager } from '../assets/AssetManager';

describe('editable text effects', () => {
  it('pads masked text only for enabled bounded effects, including negative shadows', () => {
    const layer = { ...createTextLayer({ text: 'A' }), stroke: { enabled: true, color: '#ffffff', width: 10 }, shadow: { enabled: true, color: '#000000', opacity: 1, blur: 4, offsetX: -30, offsetY: 20 } };
    expect(textEffectInsets(layer)).toEqual({ left: 47, right: 5, top: 5, bottom: 37 });
    expect(textEffectInsets({ ...layer, stroke: { ...layer.stroke, enabled: false }, shadow: { ...layer.shadow, enabled: false } })).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
  it('round-trips optional nested styles in native project data and accepts legacy text', async () => {
    const text = { ...createTextLayer({ text: 'Portable' }), stroke: { enabled: true, color: '#abcdef', width: 4 } };
    const serializer = new ProjectSerializer();
    const doc = createEditDocument({ layers: [createGroupLayer({ name: 'group', children: [text] })] });
    const restored = await serializer.hydrate(await serializer.serialize(doc, new AssetManager()), new AssetManager());
    expect((restored.layers[0] as any).children[0].stroke).toEqual(text.stroke);
    const legacy = createEditDocument({ layers: [createTextLayer({ text: 'Legacy' })] });
    const reopened = await serializer.hydrate(await serializer.serialize(legacy, new AssetManager()), new AssetManager());
    expect(reopened.layers[0]).not.toHaveProperty('stroke');
  });
  it('updates nested text and restores absent effect fields through undo/redo', () => {
    const text = createTextLayer({ text: 'Hello', x: 0, y: 0 });
    const documents = new DocumentManager();
    const doc = createEditDocument({ layers: [createGroupLayer({ name: 'group', children: [text] })] });
    documents.openDocument(doc);
    const bus = new CommandBus(documents);
    const stroke = { enabled: true, color: '#ff0000', width: 4 };
    bus.execute(new SetTextEffectsCommand(doc.id, text.id, { stroke }, documents));
    const current = () => (documents.getEditDocument(doc.id)!.layers[0] as any).children[0];
    expect(current().stroke).toEqual(stroke);
    expect(documents.getEditDocument(doc.id)!.isDirty).toBe(true);
    bus.undo();
    expect(current()).not.toHaveProperty('stroke');
    bus.redo();
    expect(current().stroke).toEqual(stroke);
  });

  it('rejects nonfinite and out-of-range styles before recording history', () => {
    for (const width of [NaN, Infinity, -1, 257]) {
      expect(() => validateTextEffects({ stroke: { enabled: true, color: '#ffffff', width } })).toThrow();
    }
    expect(() => validateTextEffects({ shadow: { enabled: true, color: 'bad', opacity: 1, blur: 2, offsetX: 0, offsetY: 0 } })).toThrow();
    const text = createTextLayer({ text: 'Hello', x: 0, y: 0 });
    const documents = new DocumentManager();
    const doc = createEditDocument({ layers: [text] });
    documents.openDocument(doc);
    const bus = new CommandBus(documents);
    expect(() => bus.execute(new SetTextEffectsCommand(doc.id, text.id, { stroke: { enabled: true, color: '#ffffff', width: Infinity } }, documents))).toThrow();
    expect(bus.canUndo()).toBe(false);
    expect(documents.getEditDocument(doc.id)!.layers[0]).toEqual(text);
  });

  it('draws every shadow line before strokes and fills and honors typography', () => {
    const layer = { ...createTextLayer({ text: 'AB\nC', x: 0, y: 0 }), fontSize: 20, fontWeight: '700', fontStyle: 'italic' as const, lineHeight: 1.5,
      stroke: { enabled: true, color: '#ff0000', width: 3 }, shadow: { enabled: true, color: '#000000', opacity: 0.4, blur: 5, offsetX: -2, offsetY: 3 } };
    const calls: any[] = [];
    const ctx = { globalAlpha: 0.5, save() {}, restore() {}, measureText: (s: string) => ({ width: s.length * 10 }),
      fillText(s: string, x: number, y: number) { calls.push(['fill', s, x, y, (this as any).fillStyle, (this as any).globalAlpha]); },
      strokeText(s: string, x: number, y: number) { calls.push(['stroke', s, x, y]); } } as unknown as CanvasRenderingContext2D;
    drawTextLayer(ctx, layer);
    expect(calls.map(c => c[0])).toEqual(['fill', 'fill', 'stroke', 'stroke', 'fill', 'fill']);
    expect(calls[0]).toEqual(['fill', 'AB', -2, 3, '#000000', 0.2]);
    expect(calls[1][3]).toBe(33);
    expect(calls.at(-1)).toEqual(['fill', 'C', 0, 30, layer.color, 0.5]);
    expect(ctx.font).toContain('italic 700 20px');
  });
  it('positions centered letter-spaced glyphs and keeps disabled effects invisible', () => {
    const calls: Array<[string, number, number]> = [];
    const layer = { ...createTextLayer({ text: 'AB\nC' }), align: 'center' as const, letterSpacing: 2,
      stroke: { enabled: false, color: '#ff0000', width: 30 }, shadow: { enabled: false, color: '#000000', opacity: 1, blur: 8, offsetX: 20, offsetY: 20 } };
    const ctx = { globalAlpha: 1, save() {}, restore() {}, measureText: (s: string) => ({ width: s.length * 10 }),
      fillText: (s: string, x: number, y: number) => calls.push([s, x, y]), strokeText() { throw new Error('Disabled stroke rendered'); } } as unknown as CanvasRenderingContext2D;
    drawTextLayer(ctx, layer);
    expect(calls).toEqual([['A', 189, 0], ['B', 201, 0], ['C', 195, expect.closeTo(57.6)]]);
  });
});
