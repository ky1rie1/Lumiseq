import { clampEditZoom } from '../../../tools/canvasZoom';

/** Map CSS pointer coordinates through the actual backing store and rendered viewport. */
export function editCanvasCoordinates(
  canvas: HTMLCanvasElement,
  doc: { width: number; height: number },
  viewport: { zoom: number; panX: number; panY: number },
  clientX: number,
  clientY: number,
) {
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) * canvas.width / rect.width;
  const py = (clientY - rect.top) * canvas.height / rect.height;
  const scale = Math.min(canvas.width / doc.width, canvas.height / doc.height) * viewport.zoom;
  const offsetX = (canvas.width - doc.width * scale) / 2 + viewport.panX;
  const offsetY = (canvas.height - doc.height * scale) / 2 + viewport.panY;
  return { docX: (px - offsetX) / scale, docY: (py - offsetY) / scale };
}

/** Preserve the document pixel beneath the pointer while changing zoom. */
export function zoomAtCanvasPoint(
  canvas: HTMLCanvasElement,
  doc: { width: number; height: number },
  viewport: { zoom: number; panX: number; panY: number },
  requestedZoom: number,
  clientX: number,
  clientY: number,
) {
  const zoom = clampEditZoom(requestedZoom);
  const point = editCanvasCoordinates(canvas, doc, viewport, clientX, clientY);
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) * canvas.width / rect.width;
  const py = (clientY - rect.top) * canvas.height / rect.height;
  const scale = Math.min(canvas.width / doc.width, canvas.height / doc.height) * zoom;
  return {
    zoom,
    panX: px - (canvas.width - doc.width * scale) / 2 - point.docX * scale,
    panY: py - (canvas.height - doc.height * scale) / 2 - point.docY * scale,
  };
}

export function documentPixelsPerCssPixel(canvas: HTMLCanvasElement, doc: { width: number; height: number }, zoom: number) {
  const rect = canvas.getBoundingClientRect();
  const backingPerCssPixel = canvas.width / rect.width;
  return backingPerCssPixel / (Math.min(canvas.width / doc.width, canvas.height / doc.height) * zoom);
}

/** Like the RAW viewport, 100% maps one document pixel to one CSS display pixel. */
export function editDisplayScale(canvas: HTMLCanvasElement, doc: { width: number; height: number }, zoom: number) {
  return 1 / documentPixelsPerCssPixel(canvas, doc, zoom);
}

export function editActualSizeZoom(canvas: HTMLCanvasElement, doc: { width: number; height: number }) {
  return clampEditZoom(1 / editDisplayScale(canvas, doc, 1));
}
