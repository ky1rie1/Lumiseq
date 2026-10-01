import type { StudioDocument } from '../../types/document';

export interface ObservationRequest {
  documentId: string;
  mode: 'overview' | 'region' | 'detail';
  variant?: 'current' | 'original';
  region?: { x: number; y: number; width: number; height: number };
  maxDimension?: number;
  expectedRevision?: string;
}
export interface ObservationEvidence {
  observationId: string; documentId: string; revision: string;
  sourceWidth: number; sourceHeight: number;
  region: { x: number; y: number; width: number; height: number };
  width: number; height: number; mimeType: 'image/jpeg' | 'image/png';
  variant: 'current' | 'original'; colorSpace: 'srgb'; approximate: boolean;
  pixelToDocument: [number, number, number, number, number, number];
}
export interface DocumentObservation {
  evidence: ObservationEvidence;
  image: { mimeType: string; data: string };
}
export interface ObservationGeometry {
  mode: ObservationRequest['mode'];
  region: ObservationEvidence['region'];
  width: number; height: number; mimeType: ObservationEvidence['mimeType'];
  pixelToDocument: ObservationEvidence['pixelToDocument'];
}
/** A port owns and releases all temporary render resources before resolving/rejecting. */
export interface DocumentObservationRenderPort {
  render(document: StudioDocument, geometry: ObservationGeometry, variant: ObservationEvidence['variant'],
    signal: AbortSignal): Promise<{ data: string; mimeType: ObservationEvidence['mimeType']; approximate: boolean }>;
  dispose?(): void;
}
