import type { StudioDocument } from '../../types/document';
import type { DocumentRegion } from './TaskPolicy';
import type { TaskKind } from './TaskPolicy';
import type { IAssetManager } from '../../types/asset';
import type { CapabilityRouter } from '../capabilities/CapabilityRouter';
import type { ImageInput } from '../types';
import type { DocumentObservationService } from '../vision/DocumentObservationService';
import type { ObservationEvidence } from '../vision/observationTypes';
import { flattenLayerTree } from '../../document/EditDocument';
import { HarnessStop, type RunBudget } from './RunBudget';

export type PreparedCreativeReference = ImageInput & { evidence?: ObservationEvidence };

export interface CreativeReference {
  assetId: string;
  source: 'user-upload' | 'document';
  label?: string;
  region?: DocumentRegion;
}

export interface CreativeBrief {
  domain: 'photo' | 'layout';
  goal: string;
  preserveIntent: true;
  intensity: 'subtle' | 'moderate';
  assumptions: string[];
  needsClarification: boolean;
  references: CreativeReference[];
  photo?: {
    subject?: string; exposure?: string; skin?: string; whiteBalance?: string;
    palette?: string; composition?: string; texture?: string;
  };
  layout?: {
    content?: string[]; hierarchy?: string; font?: string; alignment?: string;
    spacing?: string; color?: string; blend?: string; outputSize?: { width: number; height: number };
  };
}

export const CREATIVE_EXEMPLARS = [
  { domain: 'photo', prompt: 'Keep the subject natural; lift shadows gently without shifting skin color.', relationship: 'Local shadow lift stays subordinate to skin fidelity.' },
  { domain: 'layout', prompt: 'Keep the supplied headline exact; increase its contrast with the background and align it to the image edge.', relationship: 'Hierarchy comes from contrast and alignment while source copy stays exact.' },
] as const;

function documentAssetIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
    if (/assetId$/i.test(key) && typeof entry === 'string') ids.add(entry);
    else documentAssetIds(entry, ids);
  }
  return ids;
}

export async function prepareCreativeReferences(references: CreativeReference[], assets: IAssetManager, router: CapabilityRouter,
  providerId: string, document?: StudioDocument, observer?: DocumentObservationService, signal?: AbortSignal, budget?: RunBudget): Promise<PreparedCreativeReference[]> {
  const checkCancelled = () => { if (signal?.aborted) throw Object.assign(new Error('Reference preparation cancelled'), { name: 'AbortError' }); };
  checkCancelled();
  if (!references.length) return [];
  if (references.length > 4 || new Set(references.map(item => item.assetId)).size !== references.length) throw new Error('Reference image limit exceeded');
  for (const reference of references) {
    if (!['user-upload', 'document'].includes(reference.source) || !assets.hasAsset(reference.assetId)
      || (reference.source === 'document' && (!document || !documentAssetIds(document).has(reference.assetId))))
      throw new Error('Reference image provenance is invalid');
    if (reference.region && (reference.source !== 'document' || !observer)) throw new Error('Reference regions require document observation');
  }
  // Reserve the entire reference set before rendering or requesting upload consent.
  budget?.checkTime();
  if (budget && budget.state.images + references.length > budget.limits.maxImages) throw new HarnessStop('maxImages_exhausted', true);
  const documentObservations = references.filter(reference => reference.source === 'document' && document && observer).length;
  if (budget && budget.state.toolCalls + documentObservations > budget.limits.maxToolCalls) throw new HarnessStop('maxToolCalls_exhausted', true);
  await router.authorizeVisionUpload(providerId);
  checkCancelled();
  const images: PreparedCreativeReference[] = [];
  const retain = (image: PreparedCreativeReference) => {
    checkCancelled();
    budget?.take('images');
    if (budget) budget.state.imageBytes += image.data.length / 4 * 3 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);
    images.push(image);
  };
  for (const reference of references) {
    checkCancelled();
    if (reference.source === 'document' && document && observer) {
      budget?.take('toolCalls');
      const observation = await observer.observe({ documentId: document.id, mode: reference.region ? 'region' : 'overview',
        region: reference.region, maxDimension: 1024, expectedRevision: observer.revision(document.id) }, signal);
      try {
        checkCancelled();
        retain({ ...observation.image, observationId: observation.evidence.observationId, evidence: observation.evidence });
      } finally { observer.release(observation.evidence.observationId); }
      continue;
    }
    const preview = await assets.requestPreview({ assetId: reference.assetId, maxDimension: 1024 });
    if (!preview) throw new Error('Reference image is unavailable');
    try {
      checkCancelled();
      const blob = await assets.getBlob(preview.id);
      if (!blob || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 4 * 1024 * 1024)
        throw new Error('Reference image exceeds upload bounds');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      checkCancelled();
      let encoded = '';
      for (let index = 0; index < bytes.length; index += 8192) encoded += String.fromCharCode(...bytes.subarray(index, index + 8192));
      retain({ mimeType: blob.type, data: btoa(encoded), observationId: `reference:${reference.assetId}` });
    } finally { assets.releaseAsset(preview.id); }
  }
  return images;
}

const stated = (prompt: string, pattern: RegExp): string | undefined => prompt.match(pattern)?.[1]?.trim();

/** A brief records stated intent and document evidence, never imagined scene content. */
export function buildCreativeBrief(prompt: string, document: StudioDocument, options: { references?: CreativeReference[]; taskKind?: TaskKind; domain?: 'photo' | 'layout' } = {}): CreativeBrief {
  const goal = prompt.trim().slice(0, 1000);
  const references = (options.references ?? []).slice(0, 4).map(reference => ({ ...reference }));
  const common = { goal, preserveIntent: true as const, intensity: /strong|bold|大胆|强烈/i.test(goal) ? 'moderate' as const : 'subtle' as const, references };
  const domain = options.domain ?? (options.taskKind === 'layout' ? 'layout' : options.taskKind === 'photo' || options.taskKind === 'local-detail' ? 'photo' : document.kind === 'develop' ? 'photo' : 'layout');
  if (domain === 'photo') {
    const photo: NonNullable<CreativeBrief['photo']> = {};
    photo.subject = stated(goal, /(?:subject|主体)[：:\s]+([^,，。;；]+)/i);
    if (/natural skin|skin.*natural|自然肤色|肤色自然/i.test(goal)) photo.skin = 'natural';
    else photo.skin = stated(goal, /(?:skin|肤色)[：:\s]+([^,，。;；]+)/i);
    if (/warm.*white balance|white balance.*warm|白平衡.*暖|暖.*白平衡/i.test(goal)) photo.whiteBalance = /slight|微|稍/.test(goal) ? 'warm slightly' : 'warm';
    else photo.whiteBalance = stated(goal, /(?:white balance|白平衡)[：:\s]+([^,，。;；]+)/i);
    for (const [key, expression] of [
      ['exposure', /(?:exposure|曝光)[：:\s]+([^,，。;；]+)/i],
      ['palette', /(?:palette|色彩|色调)[：:\s]+([^,，。;；]+)/i],
      ['composition', /(?:composition|构图)[：:\s]+([^,，。;；]+)/i],
      ['texture', /(?:texture|质感)[：:\s]+([^,，。;；]+)/i],
    ] as const) photo[key] = stated(goal, expression);
    return { ...common, domain: 'photo', photo, assumptions: ['Preserve the source subject and natural detail.'], needsClarification: false };
  }
  const layout: NonNullable<CreativeBrief['layout']> = {};
  const quoted = [...goal.matchAll(/[“"「]([^”"」]{1,160})[”"」]/g)].map(match => match[1]);
  const existing = document.kind === 'edit' ? flattenLayerTree(document.layers).flatMap(layer => layer.type === 'text' ? [layer.text] : []) : [];
  if (quoted.length || existing.length) layout.content = [...existing, ...quoted].slice(0, 24);
  layout.hierarchy = stated(goal, /(?:hierarchy|层级)[：:\s]+([^,，。;；]+)/i);
  layout.font = stated(goal, /(?:font|字体)[：:\s]+([^,，。;；]+)/i);
  layout.alignment = stated(goal, /(?:align(?:ment)?|对齐)[：:\s]+([^,，。;；]+)/i);
  layout.spacing = stated(goal, /(?:spacing|间距)[：:\s]+([^,，。;；]+)/i);
  layout.color = stated(goal, /(?:color|颜色)[：:\s]+([^,，。;；]+)/i);
  layout.blend = stated(goal, /(?:blend|混合)[：:\s]+([^,，。;；]+)/i);
  const size = goal.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})\s*(?:px|像素)?/i);
  if (size) layout.outputSize = { width: Number(size[1]), height: Number(size[2]) };
  const needsNewCopy = /(?:create|make|design|add|new|创建|制作|设计|添加|新建).*?(?:poster|海报|headline|title|标题|文案)|(?:headline|title|标题|文案)\s*(?:needed|required|缺少|需要)/i.test(goal);
  const needsClarification = needsNewCopy && !layout.content?.length;
  return { ...common, domain: 'layout', layout, assumptions: ['Preserve existing content and hierarchy.'], needsClarification };
}
