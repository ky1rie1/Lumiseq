import { expect, it } from 'vitest';
import { documentPixelsPerCssPixel, editCanvasCoordinates, editDisplayScale, editActualSizeZoom, zoomAtCanvasPoint } from './editCanvasCoordinates';

it('maps a click through Windows 200% scaling, zoom, and pan to document pixels', () => {
  const canvas = { width: 800, height: 600, getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }) } as HTMLCanvasElement;
  const result = editCanvasCoordinates(canvas, { width: 400, height: 200 }, { zoom: 1.5, panX: 40, panY: -20 }, 171.8, 104.05);
  expect(result.docX).toBeCloseTo(101.2);
  expect(result.docY).toBeCloseTo(42.7);
});

it('keeps the same document point under a zoomed pointer at 200% display scaling', () => {
  const canvas = { width: 800, height: 600, getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }) } as HTMLCanvasElement;
  const doc = { width: 400, height: 200 };
  const before = editCanvasCoordinates(canvas, doc, { zoom: 1, panX: 17, panY: -13 }, 250, 170);
  const next = zoomAtCanvasPoint(canvas, doc, { zoom: 1, panX: 17, panY: -13 }, 2, 250, 170);
  const after = editCanvasCoordinates(canvas, doc, next, 250, 170);
  expect(after.docX).toBeCloseTo(before.docX);
  expect(after.docY).toBeCloseTo(before.docY);
  expect(next.zoom).toBe(2);
});

it('clamps zoom before computing pointer-centered pan', () => {
  const canvas = { width: 800, height: 600, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement;
  expect(zoomAtCanvasPoint(canvas, { width: 800, height: 600 }, { zoom: 4.5, panX: 0, panY: 0 }, 256, 200, 200).zoom).toBe(128);
});

it('converts eight CSS pixels to document pixels independently of display scaling', () => {
  const canvas = { width: 800, height: 600, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) } as HTMLCanvasElement;
  const doc = { width: 400, height: 200 };
  expect(documentPixelsPerCssPixel(canvas, doc, 1)).toBeCloseTo(1);
  expect(documentPixelsPerCssPixel(canvas, doc, 2)).toBeCloseTo(0.5);
});

it('reports the rendered image scale rather than the fit-relative zoom factor', () => {
  const canvas = { width: 2400, height: 1800, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 900 }) } as HTMLCanvasElement;
  const doc = { width: 600, height: 400 };
  expect(editDisplayScale(canvas, doc, 1)).toBeCloseTo(2);
  const zoom = editActualSizeZoom(canvas, doc);
  expect(zoom).toBeCloseTo(0.5);
  expect(editDisplayScale(canvas, doc, zoom)).toBeCloseTo(1);
});

it('reaches actual size for a large image beyond the former five-times-fit limit', () => {
  const canvas = { width: 1200, height: 900, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement;
  const doc = { width: 12000, height: 8000 };
  const zoom = editActualSizeZoom(canvas, doc);
  expect(zoom).toBeCloseTo(15);
  expect(zoomAtCanvasPoint(canvas, doc, { zoom: 1, panX: 0, panY: 0 }, zoom, 400, 300).zoom).toBeCloseTo(15);
  expect(editDisplayScale(canvas, doc, zoom)).toBeCloseTo(1);
});
