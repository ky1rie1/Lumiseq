import type { ObservationGeometry, ObservationRequest } from './observationTypes';

export function observationGeometry(request: ObservationRequest, sourceWidth: number, sourceHeight: number): ObservationGeometry {
  if (![sourceWidth, sourceHeight].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid document dimensions');
  if (!['overview', 'region', 'detail'].includes(request.mode)) throw new Error('Invalid observation mode');
  if (request.variant !== undefined && !['current', 'original'].includes(request.variant)) throw new Error('Invalid observation variant');
  if (request.maxDimension !== undefined && (!Number.isSafeInteger(request.maxDimension) || request.maxDimension < 1 || request.maxDimension > 1536)) {
    throw new Error('Observation maxDimension must be an integer from 1 to 1536');
  }
  let region = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  if (request.mode === 'region' && !request.region) throw new Error('Region observation requires a region');
  if (request.mode === 'overview' && request.region) throw new Error('Overview observes the complete document; use region mode');
  if (request.region) {
    const r = request.region;
    if (![r.x, r.y, r.width, r.height, r.x + r.width, r.y + r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) {
      throw new Error('Invalid observation region');
    }
    const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
    const right = Math.min(sourceWidth, Math.ceil(r.x + r.width)), bottom = Math.min(sourceHeight, Math.ceil(r.y + r.height));
    if (right <= x || bottom <= y) throw new Error('Observation region is outside the document');
    region = { x, y, width: right - x, height: bottom - y };
  }
  const limit = request.mode === 'overview' ? request.maxDimension ?? 1024 : request.maxDimension ?? 1536;
  if (request.mode === 'detail' && Math.max(region.width, region.height) > 1536) {
    throw new Error('Detail requires a region of at most 1536 pixels; request separate tiles or scaled region mode');
  }
  const scale = request.mode === 'detail' ? 1 : Math.min(1, limit / Math.max(region.width, region.height));
  const width = Math.max(1, Math.round(region.width * scale)), height = Math.max(1, Math.round(region.height * scale));
  return { mode: request.mode, region, width, height, mimeType: request.mode === 'overview' ? 'image/jpeg' : 'image/png',
    pixelToDocument: [region.width / width, 0, 0, region.height / height, region.x, region.y] };
}
